import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import { withTenant } from "../lib/db";
import { rebuildAllProjections, rebuildTripState, rebuildGearStateOffshore, rebuildCatchRollups } from "../services/projection";
import { appendServerEvent } from "../lib/server-events";

const rebuildSchema = z.object({
  trip_id: z.string().min(3),
  projection_types: z.array(z.enum(["trip_state", "gear_state", "catch_rollups", "all"])).optional()
});

export const projectionRouter = new Hono<{ Bindings: Env; Variables: { auth: { tenantId: string; actorId: string } } }>();

projectionRouter.post("/rebuild", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = rebuildSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const tripId = parsed.data.trip_id;
  const types = parsed.data.projection_types || ["all"];

  try {
    if (types.includes("all")) {
      const results = await rebuildAllProjections(c.env, auth.tenantId, tripId);
      return c.json({ ok: true, trip_id: tripId, results });
    }

    // Fetch events for selective rebuild
    const events = await withTenant(c.env, auth.tenantId, async (sql) => {
      return sql`
        select *
        from ops_event
        where tenant_id = ${auth.tenantId}
          and (payload_json->>'trip_id' = ${tripId} or subject_id = ${tripId})
        order by ts_device asc
      `;
    }) as unknown[];

    const results: Record<string, unknown> = {};

    if (types.includes("trip_state")) {
      results.trip_state = await rebuildTripState(c.env, auth.tenantId, tripId, events as Parameters<typeof rebuildTripState>[3]);
    }

    if (types.includes("gear_state")) {
      results.gear_state = await rebuildGearStateOffshore(c.env, auth.tenantId, tripId, events as Parameters<typeof rebuildGearStateOffshore>[3]);
    }

    if (types.includes("catch_rollups")) {
      results.catch_rollups = await rebuildCatchRollups(c.env, auth.tenantId, tripId, events as Parameters<typeof rebuildCatchRollups>[3]);
    }

    return c.json({ ok: true, trip_id: tripId, results });
  } catch (err) {
    return c.json({
      ok: false,
      error: err instanceof Error ? err.message : "rebuild_failed"
    }, 500);
  }
});

projectionRouter.post("/rebuild/batch", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = z.object({
    trip_ids: z.array(z.string().min(3)).max(50)
  }).safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const results: Record<string, unknown> = {};

  for (const tripId of parsed.data.trip_ids) {
    try {
      results[tripId] = await rebuildAllProjections(c.env, auth.tenantId, tripId);
    } catch (err) {
      results[tripId] = {
        ok: false,
        error: err instanceof Error ? err.message : "rebuild_failed"
      };
    }
  }

  return c.json({ ok: true, results });
});

projectionRouter.get("/status/:tripId", async (c) => {
  const auth = c.get("auth");
  const tripId = c.req.param("tripId");

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select trip_id, status, completion_meter, compliance_open_issues, latest_risk_tier
      from trip_state
      where tenant_id = ${auth.tenantId} and trip_id = ${tripId}
      limit 1
    `;
  });

  if (!rows.length) {
    return c.json({ found: false, reason: "trip_not_found" }, 404);
  }

  // Get event count for this trip
  const eventRows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select count(*) as event_count
      from ops_event
      where tenant_id = ${auth.tenantId}
        and (payload_json->>'trip_id' = ${tripId} or subject_id = ${tripId})
    `;
  });

  return c.json({
    found: true,
    trip_state: rows[0],
    event_count: (eventRows[0] as { event_count: string }).event_count
  });
});
