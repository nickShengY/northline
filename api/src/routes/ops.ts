import { Hono } from "hono";
import { replay, type OpsEvent } from "@northline/shared";
import type { AuthContext, Env } from "../types";
import { eventsSinceCursor } from "../lib/events";
import { runComplianceValidation } from "../services/compliance";
import { withTenant } from "../lib/db";
import { appendServerEvent } from "../lib/server-events";
import { requireRole } from "../lib/rbac";
import { writeAuditLog } from "../lib/audit";
import { parseBoundedIntegerQueryParam, validateOptionalQueryParam } from "../lib/route-params";

export const opsRouter = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

opsRouter.get("/dashboard", async (c) => {
  const auth = c.get("auth");
  const [tripSummary, offshoreGearSummary, iceGearSummary, hazardSummary] = await withTenant(c.env, auth.tenantId, async (sql) => {
    const trips = await sql`
      select
        count(*) filter (where status = 'ACTIVE')::int as active_trips,
        coalesce(sum(compliance_open_issues), 0)::int as compliance_issues_open,
        count(*) filter (where compliance_open_issues = 0)::int as compliance_signed,
        count(*) filter (where compliance_open_issues > 0)::int as compliance_pending,
        count(*) filter (where latest_risk_tier = 'LOW')::int as low_risk,
        count(*) filter (where latest_risk_tier = 'MODERATE')::int as moderate_risk,
        count(*) filter (where latest_risk_tier = 'HIGH')::int as high_risk,
        count(*) filter (where latest_risk_tier = 'CRITICAL')::int as critical_risk
      from trip_state
      where tenant_id = ${auth.tenantId}
    `;

    const offshoreGear = await sql`
      select
        count(*)::int as total_gear,
        count(*) filter (where status = 'MISSING')::int as missing_gear
      from gear_state_offshore
      where tenant_id = ${auth.tenantId}
    `;

    const iceGear = await sql`
      select
        count(*)::int as total_gear,
        count(*) filter (where status = 'MISSING')::int as missing_gear
      from gear_state_ice
      where tenant_id = ${auth.tenantId}
    `;

    const hazards = await sql`
      select count(*)::int as hazard_count
      from hazard_layer_state
      where tenant_id = ${auth.tenantId}
    `;

    return [trips[0] ?? {}, offshoreGear[0] ?? {}, iceGear[0] ?? {}, hazards[0] ?? {}];
  });

  const totalGear = Number(offshoreGearSummary.total_gear ?? 0) + Number(iceGearSummary.total_gear ?? 0);
  const missingGear = Number(offshoreGearSummary.missing_gear ?? 0) + Number(iceGearSummary.missing_gear ?? 0);

  return c.json({
    active_trips: Number(tripSummary.active_trips ?? 0),
    missing_gear: missingGear,
    total_gear: totalGear,
    compliance_issues_open: Number(tripSummary.compliance_issues_open ?? 0),
    hazard_count: Number(hazardSummary.hazard_count ?? 0),
    risk_distribution: {
      LOW: Number(tripSummary.low_risk ?? 0),
      MODERATE: Number(tripSummary.moderate_risk ?? 0),
      HIGH: Number(tripSummary.high_risk ?? 0),
      CRITICAL: Number(tripSummary.critical_risk ?? 0)
    },
    compliance_status: {
      signed: Number(tripSummary.compliance_signed ?? 0),
      pending: Number(tripSummary.compliance_pending ?? 0)
    },
    gear_health_score: totalGear > 0 ? Math.round(((totalGear - missingGear) / totalGear) * 100) : 100,
    last_updated: new Date().toISOString()
  });
});

opsRouter.get("/trip/:tripId/state", async (c) => {
  const auth = c.get("auth");
  const tripId = c.req.param("tripId");
  const events = (await eventsSinceCursor(c.env, auth.tenantId, undefined, 5000)) as OpsEvent[];
  const tripEvents = events.filter((e) => {
    const payload = e.payload_json as Record<string, unknown>;
    return payload.trip_id === tripId;
  });

  const state = replay(tripEvents);
  const compliance = runComplianceValidation(tripEvents);

  return c.json({
    trip: state.trips[tripId] ?? null,
    gear: Object.values(state.gear).filter((g) => g.trip_id === tripId),
    hazards: state.hazards,
    compliance
  });
});

opsRouter.get("/trip/:tripId/compliance/summary", async (c) => {
  const auth = c.get("auth");
  const tripId = c.req.param("tripId");
  const events = (await eventsSinceCursor(c.env, auth.tenantId, undefined, 5000)) as OpsEvent[];
  const tripEvents = events.filter((event) => {
    const payload = event.payload_json as Record<string, unknown>;
    return payload.trip_id === tripId;
  });

  const compliance = runComplianceValidation(tripEvents);
  return c.json({ trip_id: tripId, compliance });
});

opsRouter.post("/trip/:tripId/compliance/sign", requireRole("ORG_ADMIN", "OWNER", "CAPTAIN"), async (c) => {
  const auth = c.get("auth");
  const tripId = c.req.param("tripId");
  const body = await c.req.json().catch(() => ({}));
  const pkgId = typeof body?.pkg_id === "string" && body.pkg_id.trim().length > 0 ? body.pkg_id : `pkg_${tripId}`;

  const events = (await eventsSinceCursor(c.env, auth.tenantId, undefined, 5000)) as OpsEvent[];
  const tripEvents = events.filter((event) => {
    const payload = event.payload_json as Record<string, unknown>;
    return payload.trip_id === tripId;
  });
  const compliance = runComplianceValidation(tripEvents);

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      insert into compliance_state (
        pkg_id, tenant_id, trip_id, completion_meter, open_errors, warnings, status, details_json, signed_by, signed_at, updated_at
      ) values (
        ${pkgId}, ${auth.tenantId}, ${tripId}, ${compliance.completion_meter}, ${compliance.errors.length}, ${compliance.warnings.length},
        ${compliance.errors.length > 0 ? "NEEDS_ATTENTION" : "SIGNED"},
        ${JSON.stringify(compliance)}::jsonb, ${auth.actorId}, now(), now()
      )
      on conflict (tenant_id, pkg_id) do update
      set completion_meter = excluded.completion_meter,
          open_errors = excluded.open_errors,
          warnings = excluded.warnings,
          status = excluded.status,
          details_json = excluded.details_json,
          signed_by = excluded.signed_by,
          signed_at = excluded.signed_at,
          updated_at = now()
    `;
  });

  const validationEvent = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "ORG",
    subject_id: tripId,
    actor_id: auth.actorId,
    event_type: "COMPLIANCE_VALIDATION_RAN",
    payload_json: {
      trip_id: tripId,
      pkg_id: pkgId,
      completion_meter: compliance.completion_meter,
      issues: [...compliance.errors, ...compliance.warnings]
    }
  });

  const signedEvent = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "ORG",
    subject_id: tripId,
    actor_id: auth.actorId,
    event_type: "COMPLIANCE_SIGNED",
    payload_json: {
      trip_id: tripId,
      pkg_id: pkgId,
      completion_meter: compliance.completion_meter,
      open_errors: compliance.errors.length,
      warnings: compliance.warnings.length
    }
  });

  await writeAuditLog(c.env, {
    auth,
    action: "compliance.sign",
    subjectType: "TRIP",
    subjectId: tripId,
    outcome: "SUCCESS",
    requestId: c.req.header("x-request-id"),
    metadata: {
      pkg_id: pkgId,
      completion_meter: compliance.completion_meter,
      errors: compliance.errors.length,
      warnings: compliance.warnings.length
    }
  });

  return c.json({
    ok: true,
    pkg_id: pkgId,
    compliance,
    validation_event_id: validationEvent.event_id,
    signed_event_id: signedEvent.event_id
  });
});

opsRouter.get("/trip/:tripId/timeline", async (c) => {
  const auth = c.get("auth");
  const tripId = c.req.param("tripId");
  const limitResult = parseBoundedIntegerQueryParam("limit", c.req.query("limit"), {
    defaultValue: 500,
    min: 1,
    max: 5000
  });
  if (!limitResult.ok) return c.json(limitResult.error, 400);
  const limit = limitResult.value;

  const events = (await eventsSinceCursor(c.env, auth.tenantId, undefined, Math.max(limit * 2, 1000))) as OpsEvent[];
  const timeline = events
    .filter((event) => {
      const payload = event.payload_json as Record<string, unknown>;
      return payload.trip_id === tripId;
    })
    .slice(-limit)
    .sort((a, b) => a.ts_device.localeCompare(b.ts_device));

  return c.json({ trip_id: tripId, count: timeline.length, timeline });
});

opsRouter.get("/trips", async (c) => {
  const auth = c.get("auth");
  const statusResult = validateOptionalQueryParam("status", c.req.query("status"));
  const modeResult = validateOptionalQueryParam("mode", c.req.query("mode"));
  if (!statusResult.ok) return c.json(statusResult.error, 400);
  if (!modeResult.ok) return c.json(modeResult.error, 400);
  const status = statusResult.value;
  const mode = modeResult.value;

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select trip_id, tenant_id, mode, owner_id, status, started_at::text, ended_at::text, location_name,
             completion_meter, compliance_open_issues, latest_risk_tier, updated_at::text
      from trip_state
      where tenant_id = ${auth.tenantId}
        and (${status ?? null}::text is null or status = ${status ?? null})
        and (${mode ?? null}::text is null or mode = ${mode ?? null})
      order by updated_at desc
      limit 500
    `;
  });

  return c.json({ trips: rows.map((row) => ({ ...row })) });
});

opsRouter.post("/trip/:tripId/rebuild", requireRole("ORG_ADMIN", "OWNER", "CAPTAIN"), async (c) => {
  const auth = c.get("auth");
  const tripId = c.req.param("tripId");

  const events = (await eventsSinceCursor(c.env, auth.tenantId, undefined, 20000)) as OpsEvent[];
  const tripEvents = events.filter((event) => {
    const payload = event.payload_json as Record<string, unknown>;
    return payload.trip_id === tripId;
  });

  if (!tripEvents.length) {
    return c.json({ ok: false, reason: "trip_events_not_found" }, 404);
  }

  const projected = replay(tripEvents);
  const trip = projected.trips[tripId];
  const compliance = runComplianceValidation(tripEvents);

  if (!trip) {
    return c.json({ ok: false, reason: "trip_projection_not_found" }, 404);
  }

  const tripGear = Object.values(projected.gear).filter((gear) => gear.trip_id === tripId);

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      insert into trip_state (
        trip_id, tenant_id, mode, owner_id, status, started_at, ended_at, location_name,
        completion_meter, compliance_open_issues, latest_risk_tier, updated_at
      ) values (
        ${trip.trip_id}, ${auth.tenantId}, ${trip.mode}, ${trip.owner_id}, ${trip.status},
        ${trip.started_at ?? null}::timestamptz, ${trip.ended_at ?? null}::timestamptz, ${trip.location_name ?? null},
        ${compliance.completion_meter}, ${compliance.errors.length}, ${trip.latest_risk_tier}, now()
      )
      on conflict (tenant_id, trip_id) do update
      set mode = excluded.mode,
          owner_id = excluded.owner_id,
          status = excluded.status,
          started_at = excluded.started_at,
          ended_at = excluded.ended_at,
          location_name = excluded.location_name,
          completion_meter = excluded.completion_meter,
          compliance_open_issues = excluded.compliance_open_issues,
          latest_risk_tier = excluded.latest_risk_tier,
          updated_at = now()
    `;

    await sql`delete from gear_state_offshore where tenant_id = ${auth.tenantId} and trip_id = ${tripId}`;
    await sql`delete from gear_state_ice where tenant_id = ${auth.tenantId} and trip_id = ${tripId}`;

    for (const gear of tripGear) {
      if (gear.mode === "OFFSHORE") {
        await sql`
          insert into gear_state_offshore (
            gear_id, tenant_id, trip_id, status, last_position, updated_at
          ) values (
            ${gear.gear_id}, ${auth.tenantId}, ${tripId}, ${gear.status}, ${JSON.stringify(gear.last_position ?? null)}::jsonb, now()
          )
          on conflict (tenant_id, gear_id) do update
          set trip_id = excluded.trip_id,
              status = excluded.status,
              last_position = excluded.last_position,
              updated_at = now()
        `;
      } else {
        await sql`
          insert into gear_state_ice (
            gear_id, tenant_id, trip_id, status, last_position, updated_at
          ) values (
            ${gear.gear_id}, ${auth.tenantId}, ${tripId}, ${gear.status}, ${JSON.stringify(gear.last_position ?? null)}::jsonb, now()
          )
          on conflict (tenant_id, gear_id) do update
          set trip_id = excluded.trip_id,
              status = excluded.status,
              last_position = excluded.last_position,
              updated_at = now()
        `;
      }
    }

    await sql`
      insert into compliance_state (
        pkg_id, tenant_id, trip_id, completion_meter, open_errors, warnings, status, details_json, signed_by, signed_at, updated_at
      ) values (
        ${`pkg_${tripId}`}, ${auth.tenantId}, ${tripId}, ${compliance.completion_meter}, ${compliance.errors.length}, ${compliance.warnings.length},
        ${compliance.errors.length > 0 ? "NEEDS_ATTENTION" : "DRAFT"}, ${JSON.stringify(compliance)}::jsonb,
        ${auth.actorId}, now(), now()
      )
      on conflict (tenant_id, pkg_id) do update
      set completion_meter = excluded.completion_meter,
          open_errors = excluded.open_errors,
          warnings = excluded.warnings,
          status = excluded.status,
          details_json = excluded.details_json,
          signed_by = excluded.signed_by,
          signed_at = excluded.signed_at,
          updated_at = now()
    `;
  });

  await writeAuditLog(c.env, {
    auth,
    action: "ops.trip_rebuild",
    subjectType: "TRIP",
    subjectId: tripId,
    outcome: "SUCCESS",
    requestId: c.req.header("x-request-id"),
    metadata: {
      event_count: tripEvents.length,
      gear_rows: tripGear.length,
      compliance_meter: compliance.completion_meter
    }
  });

  return c.json({
    ok: true,
    trip_id: tripId,
    rebuilt: {
      trip_state: true,
      gear_rows: tripGear.length,
      compliance_meter: compliance.completion_meter,
      errors: compliance.errors.length,
      warnings: compliance.warnings.length
    }
  });
});
