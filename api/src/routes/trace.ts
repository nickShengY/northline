import { Hono } from "hono";
import { z } from "zod";
import type { AuthContext, Env } from "../types";
import { generateCertificate } from "../services/certificate";
import { withTenant } from "../lib/db";
import { appendServerEvent } from "../lib/server-events";
import { detectScanMismatch, mergeSpeciesTotals } from "../services/trace";
import { requireRole } from "../lib/rbac";
import { writeAuditLog } from "../lib/audit";
import { fitsJsonByteLimit } from "../lib/json-size";
import { validateOptionalQueryParam } from "../lib/route-params";

const speciesTotalsSchema = z.record(
  z.string().min(1).max(80),
  z.number().nonnegative()
).refine(
  (totals) => Object.keys(totals).length <= 100,
  "species_totals must contain 100 species or fewer"
).refine(
  fitsJsonByteLimit(8 * 1024),
  "species_totals must be 8192 bytes or less"
);

const lotCreateSchema = z.object({
  lot_id: z.string().min(3),
  trip_id: z.string().min(3),
  mode: z.enum(["OFFSHORE", "ICE"]),
  species_totals: speciesTotalsSchema.default({}),
  quality_json: z.record(z.unknown()).default({}).refine(
    fitsJsonByteLimit(16 * 1024),
    "quality_json must be 16384 bytes or less"
  )
});

const lotScanAttachSchema = z.object({
  lot_id: z.string().min(3),
  trip_id: z.string().min(3),
  batch_id: z.string().min(3),
  source: z.enum(["API", "CSV", "JSON", "MANUAL"]),
  species_totals: speciesTotalsSchema.default({})
});

const certificateRequestSchema = z.object({
  lot_id: z.string(),
  trip_id: z.string(),
  vessel_or_group: z.string(),
  event_ids: z.array(z.string()).min(1).max(500),
  stats: z.record(z.any()).default({}).refine(fitsJsonByteLimit(16 * 1024), "stats must be 16384 bytes or less")
});

export const traceRouter = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

traceRouter.post("/lot/create", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = lotCreateSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      insert into lot_state (
        lot_id, tenant_id, trip_id, mode, totals_json, quality_json
      ) values (
        ${parsed.data.lot_id}, ${auth.tenantId}, ${parsed.data.trip_id}, ${parsed.data.mode},
        ${JSON.stringify(parsed.data.species_totals)}::jsonb, ${JSON.stringify(parsed.data.quality_json)}::jsonb
      )
      on conflict (lot_id) do update
      set trip_id = excluded.trip_id,
          mode = excluded.mode,
          totals_json = excluded.totals_json,
          quality_json = excluded.quality_json,
          updated_at = now()
    `;
  });

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "ORG",
    subject_id: parsed.data.trip_id,
    actor_id: auth.actorId,
    event_type: "LOT_CREATED",
    payload_json: {
      lot_id: parsed.data.lot_id,
      trip_id: parsed.data.trip_id,
      mode: parsed.data.mode,
      species_totals: parsed.data.species_totals
    }
  });

  return c.json({ ok: true, lot_id: parsed.data.lot_id, emitted_event_id: emitted.event_id });
});

traceRouter.post("/lot/scan-attach", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = lotScanAttachSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const lotRows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select lot_id, trip_id, totals_json
      from lot_state
      where tenant_id = ${auth.tenantId} and lot_id = ${parsed.data.lot_id}
      limit 1
    `;
  });

  if (!lotRows.length) {
    return c.json({ ok: false, reason: "lot_not_found" }, 404);
  }

  const lot = lotRows[0] as { lot_id: string; trip_id: string; totals_json: Record<string, number> };
  const mismatch = detectScanMismatch(
    { species_totals: (lot.totals_json as Record<string, number>) ?? {} },
    {
      batch_id: parsed.data.batch_id,
      source: parsed.data.source,
      species_totals: parsed.data.species_totals
    }
  );

  const mergedTotals = mergeSpeciesTotals((lot.totals_json as Record<string, number>) ?? {}, parsed.data.species_totals);

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      update lot_state
      set totals_json = ${JSON.stringify(mergedTotals)}::jsonb,
          updated_at = now()
      where tenant_id = ${auth.tenantId} and lot_id = ${parsed.data.lot_id}
    `;

    await sql`
      insert into lot_scan_batch (
        batch_id, tenant_id, lot_id, trip_id, source, species_totals,
        mismatch_rate, expected_total, observed_total, requires_review
      ) values (
        ${parsed.data.batch_id}, ${auth.tenantId}, ${parsed.data.lot_id}, ${parsed.data.trip_id}, ${parsed.data.source},
        ${JSON.stringify(parsed.data.species_totals)}::jsonb,
        ${mismatch.mismatch_rate}, ${Math.round(mismatch.expected_total)}, ${Math.round(mismatch.observed_total)}, ${mismatch.requires_review}
      )
      on conflict (batch_id) do update
      set source = excluded.source,
          species_totals = excluded.species_totals,
          mismatch_rate = excluded.mismatch_rate,
          expected_total = excluded.expected_total,
          observed_total = excluded.observed_total,
          requires_review = excluded.requires_review
    `;
  });

  const attachedEvent = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "ORG",
    subject_id: parsed.data.trip_id,
    actor_id: auth.actorId,
    event_type: "LOT_SCAN_ATTACHED",
    payload_json: {
      lot_id: parsed.data.lot_id,
      trip_id: parsed.data.trip_id,
      batch_id: parsed.data.batch_id,
      source: parsed.data.source,
      species_totals: parsed.data.species_totals
    }
  });

  let mismatchEventId: string | undefined;
  if (mismatch.requires_review) {
    const mismatchEvent = await appendServerEvent(c.env, auth.tenantId, {
      subject_type: "ORG",
      subject_id: parsed.data.trip_id,
      actor_id: auth.actorId,
      event_type: "LOT_SCAN_MISMATCH_FLAGGED",
      payload_json: {
        lot_id: parsed.data.lot_id,
        trip_id: parsed.data.trip_id,
        batch_id: parsed.data.batch_id,
        mismatch_rate: mismatch.mismatch_rate,
        expected_total: mismatch.expected_total,
        observed_total: mismatch.observed_total
      }
    });
    mismatchEventId = mismatchEvent.event_id;
  }

  return c.json({
    ok: true,
    lot_id: parsed.data.lot_id,
    batch_id: parsed.data.batch_id,
    mismatch,
    emitted_event_id: attachedEvent.event_id,
    mismatch_event_id: mismatchEventId
  });
});

traceRouter.get("/lot/:lotId", async (c) => {
  const auth = c.get("auth");
  const lotId = c.req.param("lotId");

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select lot_id, trip_id, mode, totals_json, quality_json, created_at::text, updated_at::text
      from lot_state
      where tenant_id = ${auth.tenantId} and lot_id = ${lotId}
      limit 1
    `;
  });

  if (!rows.length) {
    return c.json({ found: false, reason: "lot_not_found" }, 404);
  }

  return c.json({ found: true, lot: rows[0] });
});

traceRouter.get("/lots", async (c) => {
  const auth = c.get("auth");
  const tripIdResult = validateOptionalQueryParam("trip_id", c.req.query("trip_id"));
  if (!tripIdResult.ok) return c.json(tripIdResult.error, 400);
  const tripId = tripIdResult.value;

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return tripId
      ? sql`
          select lot_id, trip_id, mode, totals_json, quality_json, created_at::text, updated_at::text
          from lot_state
          where tenant_id = ${auth.tenantId}
            and trip_id = ${tripId}
          order by updated_at desc
          limit 200
        `
      : sql`
          select lot_id, trip_id, mode, totals_json, quality_json, created_at::text, updated_at::text
          from lot_state
          where tenant_id = ${auth.tenantId}
          order by updated_at desc
          limit 200
        `;
  });

  return c.json({ lots: rows });
});

traceRouter.post("/certificate/issue", requireRole("ORG_ADMIN", "OWNER", "CAPTAIN", "PROCESSOR"), async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = certificateRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const certificate = await generateCertificate({
    ...parsed.data,
    tenant_id: auth.tenantId,
    issued_by: auth.actorId
  });

  const key = `certificates/${auth.tenantId}/${certificate.certificate_id}.json`;
  await c.env.R2_BUCKET.put(key, JSON.stringify(certificate, null, 2), {
    httpMetadata: { contentType: "application/json" }
  });

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      insert into lot_certificate (
        certificate_id, tenant_id, lot_id, trip_id, hash, artifact_key, issued_by, issued_at, provenance_event_ids
      ) values (
        ${certificate.certificate_id}, ${auth.tenantId}, ${parsed.data.lot_id}, ${parsed.data.trip_id},
        ${certificate.hash}, ${key}, ${auth.actorId}, ${certificate.issued_at}::timestamptz,
        ${JSON.stringify(parsed.data.event_ids)}::jsonb
      )
      on conflict (certificate_id) do nothing
    `;

    await sql`
      insert into artifact_registry (
        artifact_id, tenant_id, artifact_kind, object_key, content_hash, provenance_event_ids, metadata_json
      ) values (
        ${certificate.certificate_id}, ${auth.tenantId}, ${"LOT_CERTIFICATE"}, ${key}, ${certificate.hash},
        ${JSON.stringify(parsed.data.event_ids)}::jsonb,
        ${JSON.stringify({
          lot_id: parsed.data.lot_id,
          trip_id: parsed.data.trip_id,
          issued_by: auth.actorId,
          issued_at: certificate.issued_at
        })}::jsonb
      )
      on conflict (artifact_id) do update
      set object_key = excluded.object_key,
          content_hash = excluded.content_hash,
          provenance_event_ids = excluded.provenance_event_ids,
          metadata_json = excluded.metadata_json
    `;
  });

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "ORG",
    subject_id: parsed.data.trip_id,
    actor_id: auth.actorId,
    event_type: "LOT_CERTIFICATE_ISSUED",
    payload_json: {
      certificate_id: certificate.certificate_id,
      lot_id: parsed.data.lot_id,
      trip_id: parsed.data.trip_id,
      hash: certificate.hash,
      artifact_key: key,
      event_ids: parsed.data.event_ids
    }
  });

  await writeAuditLog(c.env, {
    auth,
    action: "certificate.issue",
    subjectType: "CERTIFICATE",
    subjectId: certificate.certificate_id,
    outcome: "SUCCESS",
    requestId: c.req.header("x-request-id"),
    metadata: {
      lot_id: parsed.data.lot_id,
      trip_id: parsed.data.trip_id,
      hash: certificate.hash,
      event_count: parsed.data.event_ids.length
    }
  });

  return c.json({ ok: true, certificate, artifact_key: key, emitted_event_id: emitted.event_id });
});

traceRouter.get("/certificates", async (c) => {
  const auth = c.get("auth");
  const lotIdResult = validateOptionalQueryParam("lot_id", c.req.query("lot_id"));
  if (!lotIdResult.ok) return c.json(lotIdResult.error, 400);
  const tripIdResult = validateOptionalQueryParam("trip_id", c.req.query("trip_id"));
  if (!tripIdResult.ok) return c.json(tripIdResult.error, 400);
  const lotId = lotIdResult.value;
  const tripId = tripIdResult.value;

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    if (lotId) {
      return sql`
        select certificate_id, lot_id, trip_id, hash, artifact_key, issued_by, issued_at::text
        from lot_certificate
        where tenant_id = ${auth.tenantId}
          and lot_id = ${lotId}
        order by issued_at desc
        limit 200
      `;
    }

    if (tripId) {
      return sql`
        select certificate_id, lot_id, trip_id, hash, artifact_key, issued_by, issued_at::text
        from lot_certificate
        where tenant_id = ${auth.tenantId}
          and trip_id = ${tripId}
        order by issued_at desc
        limit 200
      `;
    }

    return sql`
      select certificate_id, lot_id, trip_id, hash, artifact_key, issued_by, issued_at::text
      from lot_certificate
      where tenant_id = ${auth.tenantId}
      order by issued_at desc
      limit 200
    `;
  });

  return c.json({ certificates: rows });
});

traceRouter.get("/certificate/:certificateId/verify", async (c) => {
  const auth = c.get("auth");
  const certificateId = c.req.param("certificateId");

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select certificate_id, lot_id, trip_id, hash, artifact_key, issued_at::text, provenance_event_ids
      from lot_certificate
      where tenant_id = ${auth.tenantId} and certificate_id = ${certificateId}
      limit 1
    `;
  });

  if (!rows.length) {
    return c.json({ verified: false, reason: "not_found" }, 404);
  }

  const row = rows[0] as {
    certificate_id: string;
    lot_id: string;
    trip_id: string;
    hash: string;
    artifact_key: string;
    issued_at: string;
    provenance_event_ids: string[];
  };

  return c.json({ verified: true, certificate: row });
});
