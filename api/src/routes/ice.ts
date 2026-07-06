import { Hono } from "hono";
import { z } from "zod";
import type { AuthContext, Env } from "../types";
import { withTenant } from "../lib/db";
import { readJsonBody } from "../lib/request";
import { appendServerEvent } from "../lib/server-events";
import { fitsJsonByteLimit } from "../lib/json-size";
import { requireRole } from "../lib/rbac";
import { writeAuditLog } from "../lib/audit";
import { validateRouteParam } from "../lib/route-params";

const pointSchema = z.object({ lat: z.number().gte(-90).lte(90), lon: z.number().gte(-180).lte(180) });

const iceThicknessSchema = z.object({
  log_id: z.string().min(3),
  trip_id: z.string().min(3),
  station_id: z.string().optional(),
  thickness_cm: z.number().positive(),
  confidence: z.number().min(0).max(1).default(0.5),
  location: pointSchema,
  photo_ref: z.string().optional(),
  notes: z.string().max(500).optional()
});

const routePointSchema = z.object({
  point_id: z.string().min(3),
  trip_id: z.string().min(3),
  sequence: z.number().int().min(0),
  point_type: z.enum(["WAYPOINT", "HAZARD_AVOID", "STATION", "ACCESS_POINT", "SHELTER"]),
  location: pointSchema,
  notes: z.string().max(500).optional()
});

const returnPlanSchema = z.object({
  plan_id: z.string().min(3),
  trip_id: z.string().min(3),
  return_by: z.string().datetime(),
  access_point: z.string().optional(),
  route_summary: z.record(z.unknown()).refine(
    fitsJsonByteLimit(8 * 1024),
    "route_summary must be 8192 bytes or less"
  ).optional(),
  escalation_contacts: z.array(z.object({
    name: z.string(),
    phone: z.string().optional(),
    relation: z.string().optional()
  })).max(10).default([])
});

export const iceRouter = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

// Ice thickness logging
iceRouter.post("/thickness", requireRole("ORG_ADMIN", "OWNER", "CAPTAIN", "CREW", "GUIDE"), async (c) => {
  const auth = c.get("auth");
  const bodyResult = await readJsonBody(c);
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;
  const parsed = iceThicknessSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      insert into ice_thickness_log (
        log_id, tenant_id, trip_id, station_id, thickness_cm, confidence, location, photo_ref, notes, logged_by
      ) values (
        ${parsed.data.log_id}, ${auth.tenantId}, ${parsed.data.trip_id}, ${parsed.data.station_id ?? null},
        ${parsed.data.thickness_cm}, ${parsed.data.confidence},
        ${JSON.stringify(parsed.data.location)}::jsonb, ${parsed.data.photo_ref ?? null},
        ${parsed.data.notes ?? null}, ${auth.actorId}
      )
    `;
  });

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "GROUP",
    subject_id: parsed.data.trip_id,
    actor_id: auth.actorId,
    event_type: "ICE_THICKNESS_LOGGED",
    payload_json: {
      log_id: parsed.data.log_id,
      trip_id: parsed.data.trip_id,
      station_id: parsed.data.station_id,
      thickness_cm: parsed.data.thickness_cm,
      confidence: parsed.data.confidence,
      location: parsed.data.location
    }
  });

  return c.json({ ok: true, log_id: parsed.data.log_id, emitted_event_id: emitted.event_id });
});

iceRouter.get("/thickness/:tripId", async (c) => {
  const auth = c.get("auth");
  const tripId = c.req.param("tripId");

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select log_id, trip_id, station_id, thickness_cm, confidence::float, location, photo_ref, notes, logged_by, logged_at::text
      from ice_thickness_log
      where tenant_id = ${auth.tenantId} and trip_id = ${tripId}
      order by logged_at desc
      limit 200
    `;
  });

  return c.json({ trip_id: tripId, logs: rows });
});

iceRouter.get("/thickness/:tripId/latest", async (c) => {
  const auth = c.get("auth");
  const tripId = c.req.param("tripId");

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select log_id, station_id, thickness_cm, confidence::float, location, logged_at::text
      from ice_thickness_log
      where tenant_id = ${auth.tenantId} and trip_id = ${tripId}
      order by logged_at desc
      limit 10
    `;
  });

  // Calculate average and min for safety assessment
  const thicknesses = rows.map((r) => (r as { thickness_cm: number }).thickness_cm);
  const avgThickness = thicknesses.length > 0 ? thicknesses.reduce((a, b) => a + b, 0) / thicknesses.length : null;
  const minThickness = thicknesses.length > 0 ? Math.min(...thicknesses) : null;

  return c.json({
    trip_id: tripId,
    latest: rows,
    summary: {
      count: rows.length,
      avg_thickness_cm: avgThickness ? Math.round(avgThickness * 100) / 100 : null,
      min_thickness_cm: minThickness
    }
  });
});

// Route point logging
iceRouter.post("/route-point", requireRole("ORG_ADMIN", "OWNER", "CAPTAIN", "CREW", "GUIDE"), async (c) => {
  const auth = c.get("auth");
  const bodyResult = await readJsonBody(c);
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;
  const parsed = routePointSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      insert into route_point (
        point_id, tenant_id, trip_id, sequence, point_type, location, notes, logged_by
      ) values (
        ${parsed.data.point_id}, ${auth.tenantId}, ${parsed.data.trip_id}, ${parsed.data.sequence},
        ${parsed.data.point_type}, ${JSON.stringify(parsed.data.location)}::jsonb,
        ${parsed.data.notes ?? null}, ${auth.actorId}
      )
      on conflict (tenant_id, point_id) do update
      set sequence = excluded.sequence,
          point_type = excluded.point_type,
          location = excluded.location,
          notes = excluded.notes
    `;
  });

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "GROUP",
    subject_id: parsed.data.trip_id,
    actor_id: auth.actorId,
    event_type: "ROUTE_POINT_LOGGED",
    payload_json: {
      point_id: parsed.data.point_id,
      trip_id: parsed.data.trip_id,
      sequence: parsed.data.sequence,
      point_type: parsed.data.point_type,
      location: parsed.data.location
    }
  });

  return c.json({ ok: true, point_id: parsed.data.point_id, emitted_event_id: emitted.event_id });
});

iceRouter.get("/route/:tripId", async (c) => {
  const auth = c.get("auth");
  const tripId = c.req.param("tripId");

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select point_id, trip_id, sequence, point_type, location, notes, logged_by, logged_at::text
      from route_point
      where tenant_id = ${auth.tenantId} and trip_id = ${tripId}
      order by sequence asc
    `;
  });

  return c.json({ trip_id: tripId, route: rows });
});

iceRouter.delete("/route-point/:pointId", requireRole("ORG_ADMIN", "OWNER", "CAPTAIN"), async (c) => {
  const auth = c.get("auth");
  const parsedPointId = validateRouteParam("pointId", c.req.param("pointId"));
  if (!parsedPointId.ok) {
    return c.json(parsedPointId.error, 400);
  }
  const pointId = parsedPointId.value;

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      delete from route_point
      where tenant_id = ${auth.tenantId} and point_id = ${pointId}
      returning point_id, trip_id
    `;
  });

  if (!rows.length) {
    return c.json({ ok: false, reason: "point_not_found" }, 404);
  }

  const row = rows[0] as { point_id: string; trip_id: string };
  await writeAuditLog(c.env, {
    auth,
    action: "ice.route_point_delete",
    subjectType: "TRIP",
    subjectId: row.trip_id,
    outcome: "SUCCESS",
    requestId: c.req.header("x-request-id"),
    metadata: { point_id: row.point_id }
  });

  return c.json({ ok: true, point_id: pointId });
});

// Return plan management
iceRouter.post("/return-plan", requireRole("ORG_ADMIN", "OWNER", "CAPTAIN", "CREW", "GUIDE"), async (c) => {
  const auth = c.get("auth");
  const bodyResult = await readJsonBody(c);
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;
  const parsed = returnPlanSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      insert into return_plan (
        plan_id, tenant_id, trip_id, return_by, access_point, route_summary, escalation_contacts, status, set_by
      ) values (
        ${parsed.data.plan_id}, ${auth.tenantId}, ${parsed.data.trip_id}, ${parsed.data.return_by}::timestamptz,
        ${parsed.data.access_point ?? null},
        ${parsed.data.route_summary ? JSON.stringify(parsed.data.route_summary) : null}::jsonb,
        ${JSON.stringify(parsed.data.escalation_contacts)}::jsonb, ${"SET"}, ${auth.actorId}
      )
      on conflict (tenant_id, plan_id) do update
      set return_by = excluded.return_by,
          access_point = excluded.access_point,
          route_summary = excluded.route_summary,
          escalation_contacts = excluded.escalation_contacts,
          status = 'SET',
          set_at = now()
    `;
  });

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "GROUP",
    subject_id: parsed.data.trip_id,
    actor_id: auth.actorId,
    event_type: "TRIP_RETURN_PLAN_SET",
    payload_json: {
      plan_id: parsed.data.plan_id,
      trip_id: parsed.data.trip_id,
      return_by: parsed.data.return_by,
      access_point: parsed.data.access_point,
      escalation_count: parsed.data.escalation_contacts.length
    }
  });

  return c.json({ ok: true, plan_id: parsed.data.plan_id, emitted_event_id: emitted.event_id });
});

iceRouter.post("/return-plan/:planId/escalate", async (c) => {
  const auth = c.get("auth");
  const parsedPlanId = validateRouteParam("planId", c.req.param("planId"));
  if (!parsedPlanId.ok) {
    return c.json(parsedPlanId.error, 400);
  }
  const planId = parsedPlanId.value;

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      update return_plan
      set status = 'ESCALATED',
          escalated_at = now()
      where tenant_id = ${auth.tenantId} and plan_id = ${planId}
      returning plan_id, trip_id, return_by::text, escalation_contacts
    `;
  });

  if (!rows.length) {
    return c.json({ ok: false, reason: "plan_not_found" }, 404);
  }

  const row = rows[0] as { plan_id: string; trip_id: string; return_by: string; escalation_contacts: unknown[] };

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "GROUP",
    subject_id: row.trip_id,
    actor_id: auth.actorId,
    event_type: "TRIP_RETURN_PLAN_ESCALATED",
    payload_json: {
      plan_id: row.plan_id,
      trip_id: row.trip_id,
      return_by: row.return_by,
      escalation_contacts: row.escalation_contacts
    }
  });

  await writeAuditLog(c.env, {
    auth,
    action: "ice.return_plan_escalate",
    subjectType: "TRIP",
    subjectId: row.trip_id,
    outcome: "SUCCESS",
    requestId: c.req.header("x-request-id"),
    metadata: {
      plan_id: row.plan_id,
      return_by: row.return_by,
      emitted_event_id: emitted.event_id
    }
  });

  return c.json({ ok: true, plan: row, emitted_event_id: emitted.event_id });
});

iceRouter.post("/return-plan/:planId/complete", async (c) => {
  const auth = c.get("auth");
  const parsedPlanId = validateRouteParam("planId", c.req.param("planId"));
  if (!parsedPlanId.ok) {
    return c.json(parsedPlanId.error, 400);
  }
  const planId = parsedPlanId.value;

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      update return_plan
      set status = 'COMPLETED',
          completed_at = now()
      where tenant_id = ${auth.tenantId} and plan_id = ${planId}
      returning plan_id, trip_id
    `;
  });

  if (!rows.length) {
    return c.json({ ok: false, reason: "plan_not_found" }, 404);
  }

  const row = rows[0] as { plan_id: string; trip_id: string };

  await writeAuditLog(c.env, {
    auth,
    action: "ice.return_plan_complete",
    subjectType: "TRIP",
    subjectId: row.trip_id,
    outcome: "SUCCESS",
    requestId: c.req.header("x-request-id"),
    metadata: { plan_id: row.plan_id }
  });

  return c.json({ ok: true, plan_id: row.plan_id, trip_id: row.trip_id });
});

iceRouter.get("/return-plan/:tripId", async (c) => {
  const auth = c.get("auth");
  const tripId = c.req.param("tripId");

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select plan_id, trip_id, return_by::text, access_point, route_summary, escalation_contacts,
             status, set_by, set_at::text, escalated_at::text, completed_at::text
      from return_plan
      where tenant_id = ${auth.tenantId} and trip_id = ${tripId}
      order by set_at desc
      limit 1
    `;
  });

  if (!rows.length) {
    return c.json({ found: false, reason: "no_return_plan" }, 404);
  }

  return c.json({ found: true, plan: rows[0] });
});
