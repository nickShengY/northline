import { Hono } from "hono";
import { z } from "zod";
import type { AuthContext, Env } from "../types";
import { withTenant } from "../lib/db";
import { readJsonBody } from "../lib/request";
import { appendServerEvent } from "../lib/server-events";
import { requireRole } from "../lib/rbac";
import { writeAuditLog } from "../lib/audit";
import { validateOptionalQueryParam } from "../lib/route-params";

const pointSchema = z.object({ lat: z.number().gte(-90).lte(90), lon: z.number().gte(-180).lte(180) });

const catchRecordSchema = z.object({
  catch_id: z.string().min(3),
  trip_id: z.string().min(3),
  cycle_id: z.string().optional(),
  mode: z.enum(["OFFSHORE", "ICE"]),
  species: z.string().min(2),
  kept: z.boolean().default(true),
  release_reason: z.string().optional(),
  length_cm: z.number().positive().optional(),
  weight_kg: z.number().positive().optional(),
  station_id: z.string().optional(),
  gear_id: z.string().optional(),
  method: z.string().optional(),
  location: pointSchema.optional(),
  photo_refs: z.array(z.string()).max(20).optional(),
  measurement_confidence: z.number().min(0).max(1).optional(),
  qa_flagged: z.boolean().default(false),
  qa_reason: z.string().optional()
});

const catchCorrectionFieldsSchema = z.object({
  species: z.string().min(2).optional(),
  kept: z.boolean().optional(),
  release_reason: z.string().optional(),
  length_cm: z.number().positive().optional(),
  weight_kg: z.number().positive().optional(),
  station_id: z.string().optional(),
  gear_id: z.string().optional(),
  method: z.string().optional(),
  measurement_confidence: z.number().min(0).max(1).optional(),
  qa_flagged: z.boolean().optional(),
  qa_reason: z.string().optional()
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "at least one correction field is required"
});

const catchCorrectSchema = z.object({
  catch_id: z.string().min(3),
  corrections: catchCorrectionFieldsSchema
});

const catchMeasurementSchema = z.object({
  catch_id: z.string().min(3),
  length_cm: z.number().positive().optional(),
  weight_kg: z.number().positive().optional(),
  confidence: z.number().min(0).max(1).optional(),
  photo_ref: z.string().optional()
});

const catchQASchema = z.object({
  catch_id: z.string().min(3),
  flagged: z.boolean(),
  reason: z.string().min(3)
});

export const catchRouter = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

catchRouter.post("/record", requireRole("ORG_ADMIN", "OWNER", "CAPTAIN", "CREW", "GUIDE"), async (c) => {
  const auth = c.get("auth");
  const bodyResult = await readJsonBody(c);
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;
  const parsed = catchRecordSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      insert into catch_record (
        catch_id, tenant_id, trip_id, cycle_id, mode, species, kept, release_reason,
        length_cm, weight_kg, station_id, gear_id, method, location, photo_refs,
        measurement_confidence, qa_flagged, qa_reason, recorded_by
      ) values (
        ${parsed.data.catch_id}, ${auth.tenantId}, ${parsed.data.trip_id}, ${parsed.data.cycle_id ?? null},
        ${parsed.data.mode}, ${parsed.data.species}, ${parsed.data.kept}, ${parsed.data.release_reason ?? null},
        ${parsed.data.length_cm ?? null}, ${parsed.data.weight_kg ?? null}, ${parsed.data.station_id ?? null},
        ${parsed.data.gear_id ?? null}, ${parsed.data.method ?? null},
        ${parsed.data.location ? JSON.stringify(parsed.data.location) : null}::jsonb,
        ${parsed.data.photo_refs ? JSON.stringify(parsed.data.photo_refs) : null}::jsonb,
        ${parsed.data.measurement_confidence ?? null}, ${parsed.data.qa_flagged}, ${parsed.data.qa_reason ?? null},
        ${auth.actorId}
      )
      on conflict (tenant_id, catch_id) do update
      set species = excluded.species,
          kept = excluded.kept,
          release_reason = excluded.release_reason,
          length_cm = coalesce(excluded.length_cm, catch_record.length_cm),
          weight_kg = coalesce(excluded.weight_kg, catch_record.weight_kg),
          station_id = coalesce(excluded.station_id, catch_record.station_id),
          gear_id = coalesce(excluded.gear_id, catch_record.gear_id),
          method = coalesce(excluded.method, catch_record.method),
          location = coalesce(excluded.location, catch_record.location),
          measurement_confidence = coalesce(excluded.measurement_confidence, catch_record.measurement_confidence),
          qa_flagged = excluded.qa_flagged,
          qa_reason = excluded.qa_reason
    `;
  });

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: parsed.data.mode === "OFFSHORE" ? "VESSEL" : "GROUP",
    subject_id: parsed.data.trip_id,
    actor_id: auth.actorId,
    event_type: "CATCH_RECORDED",
    payload_json: {
      catch_id: parsed.data.catch_id,
      trip_id: parsed.data.trip_id,
      cycle_id: parsed.data.cycle_id,
      mode: parsed.data.mode,
      species: parsed.data.species,
      kept: parsed.data.kept,
      release_reason: parsed.data.release_reason,
      length_cm: parsed.data.length_cm,
      weight_kg: parsed.data.weight_kg,
      station_id: parsed.data.station_id,
      gear_id: parsed.data.gear_id
    }
  });

  return c.json({ ok: true, catch_id: parsed.data.catch_id, emitted_event_id: emitted.event_id });
});

catchRouter.post("/correct", requireRole("ORG_ADMIN", "OWNER", "CAPTAIN", "PROCESSOR"), async (c) => {
  const auth = c.get("auth");
  const bodyResult = await readJsonBody(c);
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;
  const parsed = catchCorrectSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const corrections = parsed.data.corrections;
  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      update catch_record
      set species = coalesce(${corrections.species ?? null}, species),
          kept = coalesce(${corrections.kept ?? null}, kept),
          release_reason = coalesce(${corrections.release_reason ?? null}, release_reason),
          length_cm = coalesce(${corrections.length_cm ?? null}, length_cm),
          weight_kg = coalesce(${corrections.weight_kg ?? null}, weight_kg),
          station_id = coalesce(${corrections.station_id ?? null}, station_id),
          gear_id = coalesce(${corrections.gear_id ?? null}, gear_id),
          method = coalesce(${corrections.method ?? null}, method),
          measurement_confidence = coalesce(${corrections.measurement_confidence ?? null}, measurement_confidence),
          qa_flagged = coalesce(${corrections.qa_flagged ?? null}, qa_flagged),
          qa_reason = coalesce(${corrections.qa_reason ?? null}, qa_reason),
          corrected_at = now()
      where tenant_id = ${auth.tenantId} and catch_id = ${parsed.data.catch_id}
      returning catch_id, trip_id, species, kept, length_cm, weight_kg
    `;
  });

  if (!rows.length) {
    return c.json({ ok: false, reason: "catch_not_found" }, 404);
  }

  const row = rows[0] as { catch_id: string; trip_id: string; species: string; kept: boolean; length_cm: number | null; weight_kg: number | null };
  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "ORG",
    subject_id: row.trip_id,
    actor_id: auth.actorId,
    event_type: "CATCH_CORRECTED",
    payload_json: {
      catch_id: parsed.data.catch_id,
      trip_id: row.trip_id,
      corrections: parsed.data.corrections
    }
  });

  await writeAuditLog(c.env, {
    auth,
    action: "catch.correct",
    subjectType: "CATCH",
    subjectId: parsed.data.catch_id,
    outcome: "SUCCESS",
    requestId: c.req.header("x-request-id"),
    metadata: {
      trip_id: row.trip_id,
      corrected_fields: Object.keys(parsed.data.corrections),
      emitted_event_id: emitted.event_id
    }
  });

  return c.json({ ok: true, catch_id: parsed.data.catch_id, emitted_event_id: emitted.event_id });
});

catchRouter.post("/measurement", requireRole("ORG_ADMIN", "OWNER", "CAPTAIN", "CREW", "GUIDE", "PROCESSOR"), async (c) => {
  const auth = c.get("auth");
  const bodyResult = await readJsonBody(c);
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;
  const parsed = catchMeasurementSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      update catch_record
      set length_cm = coalesce(${parsed.data.length_cm ?? null}, length_cm),
          weight_kg = coalesce(${parsed.data.weight_kg ?? null}, weight_kg),
          measurement_confidence = coalesce(${parsed.data.confidence ?? null}, measurement_confidence)
      where tenant_id = ${auth.tenantId} and catch_id = ${parsed.data.catch_id}
      returning catch_id, trip_id, species, length_cm, weight_kg
    `;
  });

  if (!rows.length) {
    return c.json({ ok: false, reason: "catch_not_found" }, 404);
  }

  const row = rows[0] as { catch_id: string; trip_id: string; species: string; length_cm: number | null; weight_kg: number | null };
  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "ORG",
    subject_id: row.trip_id,
    actor_id: auth.actorId,
    event_type: "CATCH_MEASUREMENT_ATTACHED",
    payload_json: {
      catch_id: parsed.data.catch_id,
      trip_id: row.trip_id,
      length_cm: parsed.data.length_cm,
      weight_kg: parsed.data.weight_kg,
      confidence: parsed.data.confidence,
      photo_ref: parsed.data.photo_ref
    }
  });

  return c.json({ ok: true, catch: row, emitted_event_id: emitted.event_id });
});

catchRouter.post("/qa", requireRole("ORG_ADMIN", "OWNER", "CAPTAIN", "PROCESSOR"), async (c) => {
  const auth = c.get("auth");
  const bodyResult = await readJsonBody(c);
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;
  const parsed = catchQASchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      update catch_record
      set qa_flagged = ${parsed.data.flagged},
          qa_reason = ${parsed.data.flagged ? parsed.data.reason : null}
      where tenant_id = ${auth.tenantId} and catch_id = ${parsed.data.catch_id}
      returning catch_id, trip_id, species, qa_flagged, qa_reason
    `;
  });

  if (!rows.length) {
    return c.json({ ok: false, reason: "catch_not_found" }, 404);
  }

  const row = rows[0] as { catch_id: string; trip_id: string; species: string; qa_flagged: boolean; qa_reason: string | null };
  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "ORG",
    subject_id: row.trip_id,
    actor_id: auth.actorId,
    event_type: parsed.data.flagged ? "CATCH_QA_FLAGGED" : "CATCH_QA_RESOLVED",
    payload_json: {
      catch_id: parsed.data.catch_id,
      trip_id: row.trip_id,
      flagged: parsed.data.flagged,
      reason: parsed.data.reason
    }
  });

  await writeAuditLog(c.env, {
    auth,
    action: parsed.data.flagged ? "catch.qa_flag" : "catch.qa_resolve",
    subjectType: "CATCH",
    subjectId: parsed.data.catch_id,
    outcome: "SUCCESS",
    requestId: c.req.header("x-request-id"),
    metadata: {
      trip_id: row.trip_id,
      flagged: parsed.data.flagged,
      emitted_event_id: emitted.event_id
    }
  });

  return c.json({ ok: true, catch: row, emitted_event_id: emitted.event_id });
});

catchRouter.get("/trip/:tripId", async (c) => {
  const auth = c.get("auth");
  const tripId = c.req.param("tripId");
  const speciesResult = validateOptionalQueryParam("species", c.req.query("species"), { maxLength: 80 });
  if (!speciesResult.ok) return c.json(speciesResult.error, 400);
  const species = speciesResult.value;

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    if (species) {
      return sql`
        select catch_id, trip_id, cycle_id, mode, species, kept, release_reason,
               length_cm, weight_kg, station_id, gear_id, method, location,
               measurement_confidence, qa_flagged, qa_reason, recorded_by, recorded_at::text
        from catch_record
        where tenant_id = ${auth.tenantId}
          and trip_id = ${tripId}
          and species = ${species}
        order by recorded_at desc
        limit 500
      `;
    }
    return sql`
      select catch_id, trip_id, cycle_id, mode, species, kept, release_reason,
             length_cm, weight_kg, station_id, gear_id, method, location,
             measurement_confidence, qa_flagged, qa_reason, recorded_by, recorded_at::text
      from catch_record
      where tenant_id = ${auth.tenantId} and trip_id = ${tripId}
      order by recorded_at desc
      limit 500
    `;
  });

  return c.json({ trip_id: tripId, catches: rows });
});

catchRouter.get("/cycle/:cycleId", async (c) => {
  const auth = c.get("auth");
  const cycleId = c.req.param("cycleId");

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select catch_id, trip_id, cycle_id, mode, species, kept, release_reason,
             length_cm, weight_kg, gear_id, method, location,
             measurement_confidence, qa_flagged, recorded_by, recorded_at::text
      from catch_record
      where tenant_id = ${auth.tenantId} and cycle_id = ${cycleId}
      order by recorded_at desc
      limit 500
    `;
  });

  return c.json({ cycle_id: cycleId, catches: rows });
});

catchRouter.get("/summary/:tripId", async (c) => {
  const auth = c.get("auth");
  const tripId = c.req.param("tripId");

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select species,
             count(*) filter (where kept = true)::int as kept_count,
             count(*) filter (where kept = false)::int as released_count,
             coalesce(sum(weight_kg), 0)::float as total_weight_kg,
             coalesce(avg(length_cm), 0)::float as avg_length_cm,
             count(*) filter (where qa_flagged = true)::int as qa_flagged_count
      from catch_record
      where tenant_id = ${auth.tenantId} and trip_id = ${tripId}
      group by species
      order by species
    `;
  });

  return c.json({ trip_id: tripId, summary: rows });
});
