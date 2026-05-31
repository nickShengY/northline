import { Hono } from "hono";
import { z } from "zod";
import type { AuthContext, Env } from "../types";
import { withTenant } from "../lib/db";
import { appendServerEvent } from "../lib/server-events";
import { requireRole } from "../lib/rbac";
import { writeAuditLog } from "../lib/audit";
import { validateOptionalQueryParam, validateRouteParam } from "../lib/route-params";

const pointSchema = z.object({ lat: z.number().gte(-90).lte(90), lon: z.number().gte(-180).lte(180) });

const stationCreateSchema = z.object({
  station_id: z.string().min(3),
  trip_id: z.string().min(3),
  name: z.string().min(2),
  hole_count: z.number().int().min(0).default(0),
  tipup_count: z.number().int().min(0).default(0),
  location: pointSchema,
  notes: z.string().max(500).optional()
});

const stationUpdateSchema = z.object({
  station_id: z.string().min(3),
  name: z.string().min(2).optional(),
  hole_count: z.number().int().min(0).optional(),
  tipup_count: z.number().int().min(0).optional(),
  location: pointSchema.optional(),
  notes: z.string().max(500).optional()
});

const tipupSchema = z.object({
  tipup_id: z.string().min(3),
  trip_id: z.string().min(3),
  station_id: z.string().min(3),
  tipup_type: z.string().min(2),
  bait: z.string().optional(),
  depth_m: z.number().positive().optional(),
  check_interval_min: z.number().int().positive().default(15),
  location: pointSchema.optional()
});

const tipupTransitionSchema = z.object({
  tipup_id: z.string().min(3),
  trip_id: z.string().min(3),
  transition: z.enum(["CHECKED", "REBAITED", "REMOVED", "OVERDUE"]),
  note: z.string().max(500).optional()
});

export const stationRouter = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

stationRouter.post("/create", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = stationCreateSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      insert into station_state (
        station_id, tenant_id, trip_id, name, status, hole_count, tipup_count, location, notes, created_by
      ) values (
        ${parsed.data.station_id}, ${auth.tenantId}, ${parsed.data.trip_id}, ${parsed.data.name}, ${"ACTIVE"},
        ${parsed.data.hole_count}, ${parsed.data.tipup_count},
        ${JSON.stringify(parsed.data.location)}::jsonb, ${parsed.data.notes ?? null}, ${auth.actorId}
      )
      on conflict (station_id) do update
      set name = excluded.name,
          hole_count = excluded.hole_count,
          tipup_count = excluded.tipup_count,
          location = excluded.location,
          notes = excluded.notes,
          updated_at = now()
    `;
  });

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "GROUP",
    subject_id: parsed.data.trip_id,
    actor_id: auth.actorId,
    event_type: "STATION_CREATED",
    payload_json: {
      station_id: parsed.data.station_id,
      trip_id: parsed.data.trip_id,
      name: parsed.data.name,
      hole_count: parsed.data.hole_count,
      tipup_count: parsed.data.tipup_count,
      location: parsed.data.location
    }
  });

  return c.json({ ok: true, station_id: parsed.data.station_id, emitted_event_id: emitted.event_id });
});

stationRouter.post("/update", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = stationUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      update station_state
      set name = coalesce(${parsed.data.name ?? null}, name),
          hole_count = coalesce(${parsed.data.hole_count ?? null}, hole_count),
          tipup_count = coalesce(${parsed.data.tipup_count ?? null}, tipup_count),
          location = coalesce(${parsed.data.location ? JSON.stringify(parsed.data.location) : null}::jsonb, location),
          notes = coalesce(${parsed.data.notes ?? null}, notes),
          updated_at = now()
      where tenant_id = ${auth.tenantId} and station_id = ${parsed.data.station_id}
      returning station_id, trip_id, name, hole_count, tipup_count
    `;
  });

  if (!rows.length) {
    return c.json({ ok: false, reason: "station_not_found" }, 404);
  }

  const row = rows[0] as { station_id: string; trip_id: string; name: string };
  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "GROUP",
    subject_id: row.trip_id,
    actor_id: auth.actorId,
    event_type: "STATION_UPDATED",
    payload_json: {
      station_id: parsed.data.station_id,
      trip_id: row.trip_id,
      updates: parsed.data
    }
  });

  return c.json({ ok: true, station: row, emitted_event_id: emitted.event_id });
});

stationRouter.post("/remove/:stationId", requireRole("ORG_ADMIN", "OWNER", "CAPTAIN"), async (c) => {
  const auth = c.get("auth");
  const parsedStationId = validateRouteParam("stationId", c.req.param("stationId"));
  if (!parsedStationId.ok) {
    return c.json(parsedStationId.error, 400);
  }
  const stationId = parsedStationId.value;

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      update station_state
      set status = 'REMOVED',
          updated_at = now()
      where tenant_id = ${auth.tenantId} and station_id = ${stationId}
      returning station_id, trip_id, name
    `;
  });

  if (!rows.length) {
    return c.json({ ok: false, reason: "station_not_found" }, 404);
  }

  const row = rows[0] as { station_id: string; trip_id: string; name: string };
  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "GROUP",
    subject_id: row.trip_id,
    actor_id: auth.actorId,
    event_type: "STATION_REMOVED",
    payload_json: {
      station_id: row.station_id,
      trip_id: row.trip_id
    }
  });

  await writeAuditLog(c.env, {
    auth,
    action: "station.remove",
    subjectType: "TRIP",
    subjectId: row.trip_id,
    outcome: "SUCCESS",
    requestId: c.req.header("x-request-id"),
    metadata: {
      station_id: row.station_id,
      emitted_event_id: emitted.event_id
    }
  });

  return c.json({ ok: true, station_id: row.station_id, emitted_event_id: emitted.event_id });
});

stationRouter.get("/trip/:tripId", async (c) => {
  const auth = c.get("auth");
  const tripId = c.req.param("tripId");

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select station_id, trip_id, name, status, hole_count, tipup_count, location, notes, created_by, created_at::text, updated_at::text
      from station_state
      where tenant_id = ${auth.tenantId}
        and trip_id = ${tripId}
        and status != 'REMOVED'
      order by created_at asc
    `;
  });

  return c.json({ trip_id: tripId, stations: rows });
});

// Tip-up management
stationRouter.post("/tipup/set", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = tipupSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      insert into gear_state_ice (
        gear_id, tenant_id, trip_id, station_id, status, tipup_type, bait, depth_m, check_interval_min, last_position
      ) values (
        ${parsed.data.tipup_id}, ${auth.tenantId}, ${parsed.data.trip_id}, ${parsed.data.station_id},
        ${"SET"}, ${parsed.data.tipup_type}, ${parsed.data.bait ?? null}, ${parsed.data.depth_m ?? null},
        ${parsed.data.check_interval_min},
        ${parsed.data.location ? JSON.stringify(parsed.data.location) : null}::jsonb
      )
      on conflict (gear_id) do update
      set station_id = excluded.station_id,
          status = 'SET',
          tipup_type = excluded.tipup_type,
          bait = excluded.bait,
          depth_m = excluded.depth_m,
          check_interval_min = excluded.check_interval_min,
          last_position = coalesce(excluded.last_position, gear_state_ice.last_position),
          updated_at = now()
    `;

    // Update station tipup count
    await sql`
      update station_state
      set tipup_count = tipup_count + 1,
          updated_at = now()
      where tenant_id = ${auth.tenantId} and station_id = ${parsed.data.station_id}
    `;
  });

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "GROUP",
    subject_id: parsed.data.trip_id,
    actor_id: auth.actorId,
    event_type: "TIPUP_SET",
    payload_json: {
      tipup_id: parsed.data.tipup_id,
      trip_id: parsed.data.trip_id,
      station_id: parsed.data.station_id,
      tipup_type: parsed.data.tipup_type,
      bait: parsed.data.bait,
      depth_m: parsed.data.depth_m,
      check_interval_min: parsed.data.check_interval_min
    }
  });

  return c.json({ ok: true, tipup_id: parsed.data.tipup_id, emitted_event_id: emitted.event_id });
});

stationRouter.post("/tipup/transition", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = tipupTransitionSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const eventTypeMap: Record<string, string> = {
    CHECKED: "TIPUP_CHECKED",
    REBAITED: "TIPUP_REBAITED",
    REMOVED: "TIPUP_REMOVED",
    OVERDUE: "TIPUP_OVERDUE_FLAGGED"
  };

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      update gear_state_ice
      set status = ${parsed.data.transition},
          updated_at = now()
      where tenant_id = ${auth.tenantId} and gear_id = ${parsed.data.tipup_id}
      returning gear_id, trip_id, station_id, status
    `;
  });

  if (!rows.length) {
    return c.json({ ok: false, reason: "tipup_not_found" }, 404);
  }

  const row = rows[0] as { gear_id: string; trip_id: string; station_id: string; status: string };

  // If removed, decrement station tipup count
  if (parsed.data.transition === "REMOVED") {
    await withTenant(c.env, auth.tenantId, async (sql) => {
      await sql`
        update station_state
        set tipup_count = greatest(0, tipup_count - 1),
            updated_at = now()
        where tenant_id = ${auth.tenantId} and station_id = ${row.station_id}
      `;
    });
  }

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "GROUP",
    subject_id: row.trip_id,
    actor_id: auth.actorId,
    event_type: eventTypeMap[parsed.data.transition] ?? "TIPUP_CHECKED",
    payload_json: {
      tipup_id: parsed.data.tipup_id,
      trip_id: row.trip_id,
      station_id: row.station_id,
      transition: parsed.data.transition,
      note: parsed.data.note ?? null
    }
  });

  return c.json({ ok: true, tipup: row, emitted_event_id: emitted.event_id });
});

stationRouter.get("/tipups/:tripId", async (c) => {
  const auth = c.get("auth");
  const tripId = c.req.param("tripId");
  const stationIdResult = validateOptionalQueryParam("station_id", c.req.query("station_id"));
  if (!stationIdResult.ok) return c.json(stationIdResult.error, 400);
  const stationId = stationIdResult.value;

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    if (stationId) {
      return sql`
        select gear_id as tipup_id, trip_id, station_id, status, tipup_type, bait, depth_m, check_interval_min, last_position, updated_at::text
        from gear_state_ice
        where tenant_id = ${auth.tenantId}
          and trip_id = ${tripId}
          and station_id = ${stationId}
        order by updated_at desc
      `;
    }
    return sql`
      select gear_id as tipup_id, trip_id, station_id, status, tipup_type, bait, depth_m, check_interval_min, last_position, updated_at::text
      from gear_state_ice
      where tenant_id = ${auth.tenantId} and trip_id = ${tripId}
      order by station_id, updated_at desc
    `;
  });

  return c.json({ trip_id: tripId, tipups: rows });
});

stationRouter.post("/sweep/:tripId", async (c) => {
  const auth = c.get("auth");
  const tripId = c.req.param("tripId");

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select gear_id as tipup_id, station_id, status
      from gear_state_ice
      where tenant_id = ${auth.tenantId}
        and trip_id = ${tripId}
        and status != 'REMOVED'
    `;
  });

  const outstanding = rows.filter((r) => (r as { status: string }).status !== "REMOVED");
  const complete = outstanding.length === 0;

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "GROUP",
    subject_id: tripId,
    actor_id: auth.actorId,
    event_type: complete ? "ICE_SWEEP_CONFIRMED" : "GEAR_SWEEP_BLOCKED",
    payload_json: {
      trip_id: tripId,
      outstanding_count: outstanding.length,
      outstanding_tipups: outstanding.map((r) => (r as { tipup_id: string }).tipup_id)
    }
  });

  return c.json({
    ok: complete,
    sweep_complete: complete,
    outstanding_count: outstanding.length,
    outstanding_tipups: outstanding,
    emitted_event_id: emitted.event_id
  });
});
