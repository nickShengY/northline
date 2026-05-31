import { Hono } from "hono";
import { z } from "zod";
import type { AuthContext, Env } from "../types";
import { computeRisk } from "../services/risk";
import { withTenant } from "../lib/db";
import { appendServerEvent } from "../lib/server-events";
import { requireRole } from "../lib/rbac";
import { writeAuditLog } from "../lib/audit";
import { fitsJsonByteLimit } from "../lib/json-size";
import { validateOptionalQueryParam, validateRouteParam } from "../lib/route-params";

const pointSchema = z.object({ lat: z.number().gte(-90).lte(90), lon: z.number().gte(-180).lte(180) });

const riskInputSchema = z.object({
  mode: z.enum(["OFFSHORE", "ICE"]),
  workloadIntensity: z.number().min(0).max(100),
  weatherSeverity: z.number().min(0).max(100),
  nearMissCount: z.number().int().min(0),
  daylightHoursLeft: z.number().min(0).max(24),
  soloOperator: z.boolean().optional(),
  checkinMisses: z.number().int().min(0).optional()
});

const incidentSchema = z.object({
  case_id: z.string(),
  trip_id: z.string(),
  category: z.enum(["MOB", "INJURY", "EQUIPMENT", "NEAR_MISS", "EXPOSURE"]),
  severity: z.number().int().min(1).max(5),
  summary: z.string().min(10),
  action_taken: z.string().optional()
});

const hazardSchema = z.object({
  hazard_id: z.string().min(3),
  trip_id: z.string().optional(),
  hazard_type: z.enum(["CRACK", "SLUSH", "RIDGE", "OPEN_WATER", "WEATHER", "GEAR_RISK"]),
  severity: z.number().int().min(1).max(5),
  confidence: z.number().min(0).max(1),
  sharing_scope: z.enum(["PRIVATE", "GROUP", "ORG", "DELAYED_PUBLIC", "PUBLIC"]),
  location: z.object({ lat: z.number().gte(-90).lte(90), lon: z.number().gte(-180).lte(180) })
});

const checkinScheduleSchema = z.object({
  checkin_id: z.string().min(3),
  trip_id: z.string().min(3),
  due_at: z.string().datetime(),
  location: z.object({ lat: z.number().gte(-90).lte(90), lon: z.number().gte(-180).lte(180) }).optional()
});

const checkinStatusSchema = z.object({
  checkin_id: z.string().min(3),
  trip_id: z.string().min(3),
  location: z.object({ lat: z.number().gte(-90).lte(90), lon: z.number().gte(-180).lte(180) }).optional()
});

const shelterHeaterFlagSchema = z.object({
  trip_id: z.string().min(3),
  shelter_id: z.string().max(100).optional(),
  reason: z.string().max(500).optional()
});

const shelterCoReminderAckSchema = z.object({
  trip_id: z.string().min(3),
  shelter_id: z.string().max(100).optional()
});

export const safetyRouter = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

safetyRouter.post("/risk/score", async (c) => {
  const body = await c.req.json();
  const parsed = riskInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const result = computeRisk(parsed.data);
  return c.json(result);
});

safetyRouter.post("/incident", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = incidentSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      insert into safety_case (
        case_id, tenant_id, trip_id, category, severity, status, summary, action_taken, opened_by, opened_at
      ) values (
        ${parsed.data.case_id}, ${auth.tenantId}, ${parsed.data.trip_id}, ${parsed.data.category}, ${parsed.data.severity},
        ${"OPEN"}, ${parsed.data.summary}, ${parsed.data.action_taken ?? null}, ${auth.actorId}, now()
      )
      on conflict (case_id) do update
      set category = excluded.category,
          severity = excluded.severity,
          summary = excluded.summary,
          action_taken = excluded.action_taken
    `;
  });

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "ORG",
    subject_id: parsed.data.trip_id,
    actor_id: auth.actorId,
    event_type: "INCIDENT_OPENED",
    payload_json: {
      case_id: parsed.data.case_id,
      trip_id: parsed.data.trip_id,
      category: parsed.data.category,
      severity: parsed.data.severity,
      summary: parsed.data.summary,
      action_taken: parsed.data.action_taken
    }
  });

  return c.json({
    ok: true,
    incident: {
      ...parsed.data,
      tenant_id: auth.tenantId,
      actor_id: auth.actorId,
      created_at: new Date().toISOString()
    },
    emitted_event_id: emitted.event_id
  });
});

safetyRouter.get("/incident/:caseId", async (c) => {
  const auth = c.get("auth");
  const caseId = c.req.param("caseId");

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select case_id, trip_id, category, severity, status, summary, action_taken, opened_by, opened_at::text, closed_at::text
      from safety_case
      where tenant_id = ${auth.tenantId} and case_id = ${caseId}
      limit 1
    `;
  });

  if (!rows.length) {
    return c.json({ found: false, reason: "case_not_found" }, 404);
  }

  return c.json({ found: true, incident: rows[0] });
});

safetyRouter.get("/incidents/open", async (c) => {
  const auth = c.get("auth");

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select case_id, trip_id, category, severity, status, summary, opened_by, opened_at::text
      from safety_case
      where tenant_id = ${auth.tenantId} and status = 'OPEN'
      order by opened_at desc
      limit 200
    `;
  });

  return c.json({ incidents: rows.map((row) => ({ ...row })) });
});

safetyRouter.post("/hazard/report", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = hazardSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      insert into hazard_layer_state (
        hazard_id, tenant_id, type, severity, confidence, location, sharing_scope, reported_by, ts_last_update
      ) values (
        ${parsed.data.hazard_id}, ${auth.tenantId}, ${parsed.data.hazard_type}, ${parsed.data.severity}, ${parsed.data.confidence},
        ${JSON.stringify(parsed.data.location)}::jsonb, ${parsed.data.sharing_scope}, ${auth.actorId}, now()
      )
      on conflict (hazard_id) do update
      set severity = excluded.severity,
          confidence = excluded.confidence,
          location = excluded.location,
          sharing_scope = excluded.sharing_scope,
          ts_last_update = now()
    `;
  });

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "GROUP",
    subject_id: parsed.data.trip_id ?? `hazard_${parsed.data.hazard_id}`,
    actor_id: auth.actorId,
    event_type: "HAZARD_REPORTED",
    payload_json: parsed.data
  });

  return c.json({ ok: true, hazard_id: parsed.data.hazard_id, emitted_event_id: emitted.event_id });
});

safetyRouter.post("/hazard/:hazardId/confirm", async (c) => {
  const auth = c.get("auth");
  const hazardId = c.req.param("hazardId");

  const updated = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      update hazard_layer_state
      set confirmed_count = confirmed_count + 1,
          confidence = least(1, confidence + 0.15),
          ts_last_update = now()
      where tenant_id = ${auth.tenantId} and hazard_id = ${hazardId}
      returning hazard_id, confidence::float, confirmed_count
    `;
  });

  if (!updated.length) {
    return c.json({ ok: false, reason: "hazard_not_found" }, 404);
  }

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "GROUP",
    subject_id: `hazard_${hazardId}`,
    actor_id: auth.actorId,
    event_type: "HAZARD_CONFIRMED",
    payload_json: { hazard_id: hazardId }
  });

  return c.json({ ok: true, hazard: updated[0], emitted_event_id: emitted.event_id });
});

safetyRouter.get("/hazards", async (c) => {
  const auth = c.get("auth");
  const scopeResult = validateOptionalQueryParam("scope", c.req.query("scope"));
  if (!scopeResult.ok) return c.json(scopeResult.error, 400);
  const scope = scopeResult.value;
  if (scope !== undefined && !["PRIVATE", "GROUP", "ORG", "DELAYED_PUBLIC", "PUBLIC"].includes(scope)) {
    return c.json({
      error: "invalid_query_param",
      param: "scope",
      message: "scope must be PRIVATE, GROUP, ORG, DELAYED_PUBLIC, or PUBLIC"
    }, 400);
  }

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return scope
      ? sql`
          select hazard_id, type, severity, confidence::float, location, sharing_scope, confirmed_count, ts_last_update::text
          from hazard_layer_state
          where tenant_id = ${auth.tenantId} and sharing_scope = ${scope}
          order by ts_last_update desc
          limit 300
        `
      : sql`
          select hazard_id, type, severity, confidence::float, location, sharing_scope, confirmed_count, ts_last_update::text
          from hazard_layer_state
          where tenant_id = ${auth.tenantId}
          order by ts_last_update desc
          limit 300
        `;
  });

  return c.json({ hazards: rows });
});

safetyRouter.post("/checkin/schedule", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = checkinScheduleSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      insert into checkin_state (
        checkin_id, tenant_id, trip_id, due_at, status, location_json, updated_at
      ) values (
        ${parsed.data.checkin_id}, ${auth.tenantId}, ${parsed.data.trip_id}, ${parsed.data.due_at}::timestamptz,
        ${"SCHEDULED"}, ${JSON.stringify(parsed.data.location ?? null)}::jsonb, now()
      )
      on conflict (checkin_id) do update
      set due_at = excluded.due_at,
          status = excluded.status,
          location_json = excluded.location_json,
          updated_at = now()
    `;
  });

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "GROUP",
    subject_id: parsed.data.trip_id,
    actor_id: auth.actorId,
    event_type: "CHECKIN_SCHEDULED",
    payload_json: {
      checkin_id: parsed.data.checkin_id,
      trip_id: parsed.data.trip_id,
      due_at: parsed.data.due_at,
      status: "SCHEDULED",
      location: parsed.data.location
    }
  });

  return c.json({ ok: true, checkin_id: parsed.data.checkin_id, emitted_event_id: emitted.event_id });
});

safetyRouter.post("/checkin/complete", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = checkinStatusSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      update checkin_state
      set status = 'COMPLETED',
          completed_at = now(),
          location_json = ${JSON.stringify(parsed.data.location ?? null)}::jsonb,
          updated_at = now()
      where tenant_id = ${auth.tenantId} and checkin_id = ${parsed.data.checkin_id}
      returning checkin_id, trip_id
    `;
  });

  if (!rows.length) return c.json({ ok: false, reason: "checkin_not_found" }, 404);

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "GROUP",
    subject_id: parsed.data.trip_id,
    actor_id: auth.actorId,
    event_type: "CHECKIN_COMPLETED",
    payload_json: {
      checkin_id: parsed.data.checkin_id,
      trip_id: parsed.data.trip_id,
      status: "COMPLETED",
      location: parsed.data.location
    }
  });

  return c.json({ ok: true, checkin_id: parsed.data.checkin_id, emitted_event_id: emitted.event_id });
});

safetyRouter.post("/checkin/missed", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = checkinStatusSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      update checkin_state
      set status = 'MISSED',
          updated_at = now()
      where tenant_id = ${auth.tenantId} and checkin_id = ${parsed.data.checkin_id}
    `;
  });

  const missed = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "GROUP",
    subject_id: parsed.data.trip_id,
    actor_id: auth.actorId,
    event_type: "CHECKIN_MISSED",
    payload_json: {
      checkin_id: parsed.data.checkin_id,
      trip_id: parsed.data.trip_id,
      status: "MISSED",
      location: parsed.data.location
    }
  });

  const escalated = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "GROUP",
    subject_id: parsed.data.trip_id,
    actor_id: auth.actorId,
    event_type: "CHECKIN_ESCALATED",
    payload_json: {
      checkin_id: parsed.data.checkin_id,
      trip_id: parsed.data.trip_id,
      status: "ESCALATED",
      location: parsed.data.location
    }
  });

  return c.json({
    ok: true,
    checkin_id: parsed.data.checkin_id,
    missed_event_id: missed.event_id,
    escalated_event_id: escalated.event_id
  });
});

safetyRouter.get("/checkins/:tripId", async (c) => {
  const auth = c.get("auth");
  const tripId = c.req.param("tripId");

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select checkin_id, trip_id, status, due_at::text, completed_at::text, location_json, updated_at::text
      from checkin_state
      where tenant_id = ${auth.tenantId} and trip_id = ${tripId}
      order by updated_at desc
      limit 200
    `;
  });

  return c.json({ trip_id: tripId, checkins: rows });
});

// MOB (Man Overboard) workflow endpoints
const mobStartSchema = z.object({
  workflow_id: z.string().min(3),
  trip_id: z.string().min(3),
  victim_id: z.string().optional(),
  last_known_location: pointSchema.optional()
});

const mobUpdateSchema = z.object({
  workflow_id: z.string().min(3),
  checklist_json: z.record(z.unknown()).refine(
    fitsJsonByteLimit(32 * 1024),
    "checklist_json must be 32768 bytes or less"
  ).optional(),
  roles_assigned: z.record(z.string()).refine(
    fitsJsonByteLimit(8 * 1024),
    "roles_assigned must be 8192 bytes or less"
  ).optional(),
  last_known_location: pointSchema.optional(),
  notes: z.string().max(1000).optional()
});

safetyRouter.post("/mob/start", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = mobStartSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      insert into mob_workflow_state (
        workflow_id, tenant_id, trip_id, status, victim_id, last_known_location, started_by, checklist_json, roles_assigned
      ) values (
        ${parsed.data.workflow_id}, ${auth.tenantId}, ${parsed.data.trip_id}, ${"ACTIVE"},
        ${parsed.data.victim_id ?? null},
        ${parsed.data.last_known_location ? JSON.stringify(parsed.data.last_known_location) : null}::jsonb,
        ${auth.actorId}, ${"{}"}::jsonb, ${"{}"}::jsonb
      )
    `;
  });

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "VESSEL",
    subject_id: parsed.data.trip_id,
    actor_id: auth.actorId,
    event_type: "MOB_WORKFLOW_STARTED",
    payload_json: {
      workflow_id: parsed.data.workflow_id,
      trip_id: parsed.data.trip_id,
      victim_id: parsed.data.victim_id,
      last_known_location: parsed.data.last_known_location
    }
  });

  return c.json({ ok: true, workflow_id: parsed.data.workflow_id, emitted_event_id: emitted.event_id });
});

safetyRouter.post("/mob/update", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = mobUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      update mob_workflow_state
      set checklist_json = coalesce(${parsed.data.checklist_json ? JSON.stringify(parsed.data.checklist_json) : null}::jsonb, checklist_json),
          roles_assigned = coalesce(${parsed.data.roles_assigned ? JSON.stringify(parsed.data.roles_assigned) : null}::jsonb, roles_assigned),
          last_known_location = coalesce(${parsed.data.last_known_location ? JSON.stringify(parsed.data.last_known_location) : null}::jsonb, last_known_location),
          notes = coalesce(${parsed.data.notes ?? null}, notes)
      where tenant_id = ${auth.tenantId} and workflow_id = ${parsed.data.workflow_id}
      returning workflow_id, trip_id, status
    `;
  });

  if (!rows.length) {
    return c.json({ ok: false, reason: "workflow_not_found" }, 404);
  }

  const row = rows[0] as { workflow_id: string; trip_id: string; status: string };

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "VESSEL",
    subject_id: row.trip_id,
    actor_id: auth.actorId,
    event_type: "INCIDENT_UPDATED",
    payload_json: {
      workflow_id: parsed.data.workflow_id,
      trip_id: row.trip_id,
      updates: parsed.data
    }
  });

  await writeAuditLog(c.env, {
    auth,
    action: "safety.mob_update",
    subjectType: "SAFETY",
    subjectId: row.workflow_id,
    outcome: "SUCCESS",
    requestId: c.req.header("x-request-id"),
    metadata: {
      trip_id: row.trip_id,
      status: row.status,
      emitted_event_id: emitted.event_id
    }
  });

  return c.json({ ok: true, workflow: row, emitted_event_id: emitted.event_id });
});

safetyRouter.post("/mob/:workflowId/complete", requireRole("ORG_ADMIN", "OWNER", "CAPTAIN"), async (c) => {
  const auth = c.get("auth");
  const parsedWorkflowId = validateRouteParam("workflowId", c.req.param("workflowId"));
  if (!parsedWorkflowId.ok) {
    return c.json(parsedWorkflowId.error, 400);
  }
  const workflowId = parsedWorkflowId.value;

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      update mob_workflow_state
      set status = 'RESCUED',
          resolved_at = now(),
          resolved_by = ${auth.actorId}
      where tenant_id = ${auth.tenantId} and workflow_id = ${workflowId}
      returning workflow_id, trip_id, status
    `;
  });

  if (!rows.length) {
    return c.json({ ok: false, reason: "workflow_not_found" }, 404);
  }

  const row = rows[0] as { workflow_id: string; trip_id: string; status: string };

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "VESSEL",
    subject_id: row.trip_id,
    actor_id: auth.actorId,
    event_type: "MOB_WORKFLOW_COMPLETED",
    payload_json: {
      workflow_id: row.workflow_id,
      trip_id: row.trip_id,
      status: "RESCUED"
    }
  });

  await writeAuditLog(c.env, {
    auth,
    action: "safety.mob_complete",
    subjectType: "SAFETY",
    subjectId: row.workflow_id,
    outcome: "SUCCESS",
    requestId: c.req.header("x-request-id"),
    metadata: {
      trip_id: row.trip_id,
      status: row.status,
      emitted_event_id: emitted.event_id
    }
  });

  return c.json({ ok: true, workflow: row, emitted_event_id: emitted.event_id });
});

safetyRouter.get("/mob/:tripId/active", async (c) => {
  const auth = c.get("auth");
  const tripId = c.req.param("tripId");

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select workflow_id, trip_id, status, victim_id, last_known_location, started_by, started_at::text,
             checklist_json, roles_assigned, resolved_at::text, resolved_by, notes
      from mob_workflow_state
      where tenant_id = ${auth.tenantId}
        and trip_id = ${tripId}
        and status = 'ACTIVE'
      order by started_at desc
      limit 1
    `;
  });

  if (!rows.length) {
    return c.json({ found: false, reason: "no_active_mob" }, 404);
  }

  return c.json({ found: true, workflow: rows[0] });
});

// Stop-work endpoints
const stopWorkSchema = z.object({
  stop_id: z.string().min(3),
  trip_id: z.string().min(3),
  reason: z.string().min(3),
  severity: z.number().int().min(1).max(5)
});

safetyRouter.post("/stop-work/trigger", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = stopWorkSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      insert into stop_work_state (
        stop_id, tenant_id, trip_id, reason, severity, status, initiated_by
      ) values (
        ${parsed.data.stop_id}, ${auth.tenantId}, ${parsed.data.trip_id},
        ${parsed.data.reason}, ${parsed.data.severity}, ${"ACTIVE"}, ${auth.actorId}
      )
    `;
  });

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "VESSEL",
    subject_id: parsed.data.trip_id,
    actor_id: auth.actorId,
    event_type: "STOP_WORK_TRIGGERED",
    payload_json: {
      stop_id: parsed.data.stop_id,
      trip_id: parsed.data.trip_id,
      reason: parsed.data.reason,
      severity: parsed.data.severity
    }
  });

  return c.json({ ok: true, stop_id: parsed.data.stop_id, emitted_event_id: emitted.event_id });
});

safetyRouter.post("/stop-work/:stopId/acknowledge", async (c) => {
  const auth = c.get("auth");
  const parsedStopId = validateRouteParam("stopId", c.req.param("stopId"));
  if (!parsedStopId.ok) {
    return c.json(parsedStopId.error, 400);
  }
  const stopId = parsedStopId.value;

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      update stop_work_state
      set acknowledged_by = ${auth.actorId},
          acknowledged_at = now()
      where tenant_id = ${auth.tenantId} and stop_id = ${stopId}
      returning stop_id, trip_id, reason, severity
    `;
  });

  if (!rows.length) {
    return c.json({ ok: false, reason: "stop_not_found" }, 404);
  }

  const row = rows[0] as { stop_id: string; trip_id: string; reason: string; severity: number };

  await writeAuditLog(c.env, {
    auth,
    action: "safety.stop_work_acknowledge",
    subjectType: "SAFETY",
    subjectId: row.stop_id,
    outcome: "SUCCESS",
    requestId: c.req.header("x-request-id"),
    metadata: {
      trip_id: row.trip_id,
      severity: row.severity
    }
  });

  return c.json({ ok: true, stop: row });
});

safetyRouter.post("/stop-work/:stopId/clear", requireRole("ORG_ADMIN", "OWNER", "CAPTAIN"), async (c) => {
  const auth = c.get("auth");
  const parsedStopId = validateRouteParam("stopId", c.req.param("stopId"));
  if (!parsedStopId.ok) {
    return c.json(parsedStopId.error, 400);
  }
  const stopId = parsedStopId.value;
  const body = await c.req.json().catch(() => ({}));
  const resolutionNotes = (body as { notes?: string }).notes;

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      update stop_work_state
      set status = 'CLEARED',
          cleared_by = ${auth.actorId},
          cleared_at = now(),
          resolution_notes = ${resolutionNotes ?? null}
      where tenant_id = ${auth.tenantId} and stop_id = ${stopId}
      returning stop_id, trip_id, reason, severity
    `;
  });

  if (!rows.length) {
    return c.json({ ok: false, reason: "stop_not_found" }, 404);
  }

  const row = rows[0] as { stop_id: string; trip_id: string; reason: string; severity: number };

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "VESSEL",
    subject_id: row.trip_id,
    actor_id: auth.actorId,
    event_type: "STOP_WORK_CLEARED",
    payload_json: {
      stop_id: row.stop_id,
      trip_id: row.trip_id,
      reason: row.reason,
      resolution_notes: resolutionNotes
    }
  });

  await writeAuditLog(c.env, {
    auth,
    action: "safety.stop_work_clear",
    subjectType: "SAFETY",
    subjectId: row.stop_id,
    outcome: "SUCCESS",
    requestId: c.req.header("x-request-id"),
    metadata: {
      trip_id: row.trip_id,
      severity: row.severity,
      emitted_event_id: emitted.event_id
    }
  });

  return c.json({ ok: true, stop: row, emitted_event_id: emitted.event_id });
});

safetyRouter.get("/stop-work/:tripId/active", async (c) => {
  const auth = c.get("auth");
  const tripId = c.req.param("tripId");

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select stop_id, trip_id, reason, severity, status, initiated_by, initiated_at::text,
             acknowledged_by, acknowledged_at::text
      from stop_work_state
      where tenant_id = ${auth.tenantId}
        and trip_id = ${tripId}
        and status = 'ACTIVE'
      order by initiated_at desc
    `;
  });

  return c.json({ trip_id: tripId, active_stops: rows });
});

// Safety briefing endpoints
const briefingSchema = z.object({
  briefing_id: z.string().min(3),
  trip_id: z.string().min(3),
  mode: z.enum(["OFFSHORE", "ICE"]),
  briefing_type: z.enum(["PRE_TRIP", "TOOLBOX_TALK", "STORM_PREP", "HAZARD_ALERT"]),
  checklist_json: z.record(z.unknown()).refine(
    fitsJsonByteLimit(32 * 1024),
    "checklist_json must be 32768 bytes or less"
  )
});

safetyRouter.post("/briefing", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = briefingSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      insert into safety_briefing (
        briefing_id, tenant_id, trip_id, mode, briefing_type, checklist_json, delivered_by
      ) values (
        ${parsed.data.briefing_id}, ${auth.tenantId}, ${parsed.data.trip_id},
        ${parsed.data.mode}, ${parsed.data.briefing_type},
        ${JSON.stringify(parsed.data.checklist_json)}::jsonb, ${auth.actorId}
      )
    `;
  });

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: parsed.data.mode === "OFFSHORE" ? "VESSEL" : "GROUP",
    subject_id: parsed.data.trip_id,
    actor_id: auth.actorId,
    event_type: "SAFETY_BRIEFING_COMPLETED",
    payload_json: {
      briefing_id: parsed.data.briefing_id,
      trip_id: parsed.data.trip_id,
      mode: parsed.data.mode,
      briefing_type: parsed.data.briefing_type
    }
  });

  return c.json({ ok: true, briefing_id: parsed.data.briefing_id, emitted_event_id: emitted.event_id });
});

safetyRouter.post("/briefing/:briefingId/acknowledge", async (c) => {
  const auth = c.get("auth");
  const briefingId = c.req.param("briefingId");

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      update safety_briefing
      set acknowledged_by = acknowledged_by || ${JSON.stringify([auth.actorId])}::jsonb,
          acknowledged_at = now()
      where tenant_id = ${auth.tenantId} and briefing_id = ${briefingId}
      returning briefing_id, trip_id, briefing_type, acknowledged_by
    `;
  });

  if (!rows.length) {
    return c.json({ ok: false, reason: "briefing_not_found" }, 404);
  }

  const row = rows[0] as { briefing_id: string; trip_id: string; briefing_type: string; acknowledged_by: unknown[] };

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "ORG",
    subject_id: row.trip_id,
    actor_id: auth.actorId,
    event_type: row.briefing_type === "TOOLBOX_TALK" ? "TOOLBOX_TALK_ACKED" : "SAFETY_PROMPT_ACKED",
    payload_json: {
      briefing_id: row.briefing_id,
      trip_id: row.trip_id,
      actor_id: auth.actorId
    }
  });

  return c.json({ ok: true, briefing: row, emitted_event_id: emitted.event_id });
});

safetyRouter.get("/briefings/:tripId", async (c) => {
  const auth = c.get("auth");
  const tripId = c.req.param("tripId");

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select briefing_id, trip_id, mode, briefing_type, checklist_json, acknowledged_by,
             delivered_by, delivered_at::text, acknowledged_at::text
      from safety_briefing
      where tenant_id = ${auth.tenantId} and trip_id = ${tripId}
      order by delivered_at desc
      limit 50
    `;
  });

  return c.json({ trip_id: tripId, briefings: rows });
});

// Shelter heater/CO reminder endpoints
safetyRouter.post("/shelter/heater-flag", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = shelterHeaterFlagSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "GROUP",
    subject_id: parsed.data.trip_id,
    actor_id: auth.actorId,
    event_type: "SHELTER_HEATER_FLAGGED",
    payload_json: {
      trip_id: parsed.data.trip_id,
      shelter_id: parsed.data.shelter_id,
      reason: parsed.data.reason,
      flagged_at: new Date().toISOString()
    }
  });

  return c.json({ ok: true, emitted_event_id: emitted.event_id });
});

safetyRouter.post("/shelter/co-reminder-ack", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = shelterCoReminderAckSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "GROUP",
    subject_id: parsed.data.trip_id,
    actor_id: auth.actorId,
    event_type: "SHELTER_CO_REMINDER_ACKED",
    payload_json: {
      trip_id: parsed.data.trip_id,
      shelter_id: parsed.data.shelter_id,
      acked_at: new Date().toISOString()
    }
  });

  return c.json({ ok: true, emitted_event_id: emitted.event_id });
});

// Near-miss recording
safetyRouter.post("/near-miss", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = z.object({
    near_miss_id: z.string().min(3),
    trip_id: z.string().min(3),
    category: z.enum(["PINCH_POINT", "LINE_TENSION", "SLIP", "FALL", "EQUIPMENT", "OTHER"]),
    description: z.string().min(10),
    location: pointSchema.optional(),
    witnesses: z.array(z.string()).max(20).optional()
  }).safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "ORG",
    subject_id: parsed.data.trip_id,
    actor_id: auth.actorId,
    event_type: "NEAR_MISS_RECORDED",
    payload_json: {
      near_miss_id: parsed.data.near_miss_id,
      trip_id: parsed.data.trip_id,
      category: parsed.data.category,
      description: parsed.data.description,
      location: parsed.data.location,
      witnesses: parsed.data.witnesses
    }
  });

  return c.json({ ok: true, near_miss_id: parsed.data.near_miss_id, emitted_event_id: emitted.event_id });
});

// Safety playbook trigger
safetyRouter.post("/playbook/trigger", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = z.object({
    playbook_id: z.string().min(2),
    trip_id: z.string().min(3),
    trigger_reason: z.string().min(3),
    context_json: z.record(z.unknown()).refine(
      fitsJsonByteLimit(16 * 1024),
      "context_json must be 16384 bytes or less"
    ).optional()
  }).safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "ORG",
    subject_id: parsed.data.trip_id,
    actor_id: auth.actorId,
    event_type: "SAFETY_PLAYBOOK_TRIGGERED",
    payload_json: {
      playbook_id: parsed.data.playbook_id,
      trip_id: parsed.data.trip_id,
      trigger_reason: parsed.data.trigger_reason,
      context: parsed.data.context_json
    }
  });

  return c.json({ ok: true, playbook_id: parsed.data.playbook_id, emitted_event_id: emitted.event_id });
});
