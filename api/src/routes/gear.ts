import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import { withTenant } from "../lib/db";
import { appendServerEvent } from "../lib/server-events";
import { requireRole } from "../lib/rbac";
import { validateOptionalQueryParam } from "../lib/route-params";

const transitionSchema = z.object({
  trip_id: z.string().min(3),
  gear_id: z.string().min(2),
  mode: z.enum(["OFFSHORE", "ICE"]),
  transition: z.enum(["SET", "CHECKED", "HAULED", "MISSING", "RECOVERED", "REMOVED"]),
  position: z
    .object({
      lat: z.number().gte(-90).lte(90),
      lon: z.number().gte(-180).lte(180)
    })
    .optional(),
  note: z.string().max(1000).optional()
});

const sweepSchema = z.object({
  trip_id: z.string().min(3),
  mode: z.enum(["OFFSHORE", "ICE"]),
  outstanding_gear_ids: z.array(z.string().min(2)).max(500).default([])
});

const eventTypeByTransition = {
  SET: "GEAR_SET",
  CHECKED: "GEAR_CHECKED",
  HAULED: "GEAR_HAULED",
  MISSING: "GEAR_MARKED_MISSING",
  RECOVERED: "GEAR_RECOVERED",
  REMOVED: "GEAR_REMOVED"
} as const;

const dbStatusByTransition = {
  SET: "SET",
  CHECKED: "CHECKED",
  HAULED: "HAULED",
  MISSING: "MISSING",
  RECOVERED: "RECOVERED",
  REMOVED: "REMOVED"
} as const;

export const gearRouter = new Hono<{ Bindings: Env; Variables: { auth: { tenantId: string; actorId: string } } }>();

gearRouter.post("/transition", requireRole("ORG_ADMIN", "OWNER", "CAPTAIN", "CREW", "GUIDE"), async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = transitionSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const { trip_id, gear_id, mode, transition, position, note } = parsed.data;

  await withTenant(c.env, auth.tenantId, async (sql) => {
    if (mode === "OFFSHORE") {
      await sql`
        insert into gear_state_offshore (
          gear_id, tenant_id, trip_id, status, last_position
        ) values (
          ${gear_id}, ${auth.tenantId}, ${trip_id}, ${dbStatusByTransition[transition]}, ${position ? JSON.stringify(position) : null}::jsonb
        )
        on conflict (tenant_id, gear_id) do update
        set trip_id = excluded.trip_id,
            status = excluded.status,
            last_position = coalesce(excluded.last_position, gear_state_offshore.last_position),
            updated_at = now()
      `;
    } else {
      await sql`
        insert into gear_state_ice (
          gear_id, tenant_id, trip_id, status, last_position
        ) values (
          ${gear_id}, ${auth.tenantId}, ${trip_id}, ${dbStatusByTransition[transition]}, ${position ? JSON.stringify(position) : null}::jsonb
        )
        on conflict (tenant_id, gear_id) do update
        set trip_id = excluded.trip_id,
            status = excluded.status,
            last_position = coalesce(excluded.last_position, gear_state_ice.last_position),
            updated_at = now()
      `;
    }
  });

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: mode === "OFFSHORE" ? "VESSEL" : "GROUP",
    subject_id: trip_id,
    actor_id: auth.actorId,
    event_type: eventTypeByTransition[transition],
    payload_json: {
      trip_id,
      gear_id,
      mode,
      position,
      note
    }
  });

  return c.json({ ok: true, gear_id, trip_id, transition, emitted_event_id: emitted.event_id });
});

gearRouter.post("/sweep-check", requireRole("ORG_ADMIN", "OWNER", "CAPTAIN", "CREW", "GUIDE"), async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = sweepSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const blocked = parsed.data.outstanding_gear_ids.length > 0;

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: parsed.data.mode === "OFFSHORE" ? "VESSEL" : "GROUP",
    subject_id: parsed.data.trip_id,
    actor_id: auth.actorId,
    event_type: blocked ? "GEAR_SWEEP_BLOCKED" : "GEAR_SWEEP_CONFIRMED",
    payload_json: {
      trip_id: parsed.data.trip_id,
      mode: parsed.data.mode,
      outstanding_gear_ids: parsed.data.outstanding_gear_ids
    }
  });

  return c.json({
    ok: !blocked,
    blocked,
    outstanding_count: parsed.data.outstanding_gear_ids.length,
    outstanding_gear_ids: parsed.data.outstanding_gear_ids,
    emitted_event_id: emitted.event_id
  });
});

gearRouter.get("/trip/:tripId", async (c) => {
  const auth = c.get("auth");
  const tripId = c.req.param("tripId");
  const modeResult = validateOptionalQueryParam("mode", c.req.query("mode"));
  if (!modeResult.ok) return c.json(modeResult.error, 400);
  const mode = modeResult.value;
  if (mode !== undefined && mode !== "OFFSHORE" && mode !== "ICE") {
    return c.json({ error: "invalid_query_param", param: "mode", message: "mode must be OFFSHORE or ICE" }, 400);
  }

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    if (mode === "OFFSHORE") {
      return sql`
        select gear_id, trip_id, status, buoy_label, pot_count, line_length_m, target_depth_m, set_time::text, last_position, updated_at::text
        from gear_state_offshore
        where tenant_id = ${auth.tenantId} and trip_id = ${tripId}
        order by updated_at desc
      `;
    }

    if (mode === "ICE") {
      return sql`
        select gear_id, trip_id, status, station_id, tipup_type, bait, depth_m, check_interval_min, last_position, updated_at::text
        from gear_state_ice
        where tenant_id = ${auth.tenantId} and trip_id = ${tripId}
        order by updated_at desc
      `;
    }

    return sql`
      select gear_id, trip_id, status, 'OFFSHORE'::text as source, last_position, updated_at::text
      from gear_state_offshore
      where tenant_id = ${auth.tenantId} and trip_id = ${tripId}
      union all
      select gear_id, trip_id, status, 'ICE'::text as source, last_position, updated_at::text
      from gear_state_ice
      where tenant_id = ${auth.tenantId} and trip_id = ${tripId}
    `;
  });

  return c.json({ trip_id: tripId, mode: mode ?? "ALL", gear: rows });
});
