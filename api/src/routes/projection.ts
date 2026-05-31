import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AuthContext, Env } from "../types";
import { withTenant } from "../lib/db";
import { rebuildAllProjections, rebuildTripState, rebuildGearStateOffshore, rebuildCatchRollups } from "../services/projection";
import { requireRole } from "../lib/rbac";
import { writeAuditLog } from "../lib/audit";

const projectionTypeSchema = z.enum(["trip_state", "gear_state", "catch_rollups", "all"]);

const rebuildSchema = z.object({
  trip_id: z.string().min(3),
  projection_types: z.array(projectionTypeSchema).min(1).max(4).optional()
});

const batchRebuildSchema = z.object({
  trip_ids: z.array(z.string().min(3)).min(1).max(50)
});

type ProjectionContext = Context<{ Bindings: Env; Variables: { auth: AuthContext } }>;

async function readProjectionJson(c: ProjectionContext) {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

type ProjectionType = z.infer<typeof projectionTypeSchema>;

function normalizeProjectionTypes(types: ProjectionType[] | undefined): ProjectionType[] {
  if (!types?.length || types.includes("all")) return ["all"];
  return [...new Set(types)];
}

export function summarizeProjectionBatchResults(results: Record<string, unknown>) {
  const failed_count = Object.values(results).filter((result) => {
    return countProjectionErrors(result) > 0;
  }).length;

  return {
    total_count: Object.keys(results).length,
    succeeded_count: Object.keys(results).length - failed_count,
    failed_count
  };
}

export function countProjectionErrors(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  if ("ok" in value && value.ok === false) return 1;

  let count = 0;
  if ("errors" in value && Array.isArray(value.errors)) {
    count += value.errors.length;
  }

  for (const item of Object.values(value)) {
    if (item && typeof item === "object") {
      count += countProjectionErrors(item);
    }
  }

  return count;
}

export const projectionRouter = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

projectionRouter.post("/rebuild", requireRole("ORG_ADMIN", "OWNER", "CAPTAIN"), async (c) => {
  const auth = c.get("auth");
  const body = await readProjectionJson(c);
  if (body === undefined) {
    return c.json({ error: "invalid_payload", message: "request body must be valid JSON" }, 400);
  }

  const parsed = rebuildSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const tripId = parsed.data.trip_id;
  const types = normalizeProjectionTypes(parsed.data.projection_types);

  try {
    if (types.includes("all")) {
      const results = await rebuildAllProjections(c.env, auth.tenantId, tripId);
      const errorCount = countProjectionErrors(results);
      await writeAuditLog(c.env, {
        auth,
        action: "projection.rebuild",
        subjectType: "TRIP",
        subjectId: tripId,
        outcome: errorCount > 0 ? "FAILED" : "SUCCESS",
        requestId: c.req.header("x-request-id"),
        metadata: { projection_types: types, error_count: errorCount }
      });
      return c.json({ ok: errorCount === 0, trip_id: tripId, error_count: errorCount, results }, errorCount > 0 ? 500 : 200);
    }

    // Fetch events for selective rebuild
    const events = await withTenant(c.env, auth.tenantId, async (sql) => {
      return sql`
        select *
        from ops_event
        where tenant_id = ${auth.tenantId}
          and (payload_json->>'trip_id' = ${tripId} or subject_id = ${tripId})
        order by ts_server asc, event_id asc
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

    const errorCount = countProjectionErrors(results);
    await writeAuditLog(c.env, {
      auth,
      action: "projection.rebuild",
      subjectType: "TRIP",
      subjectId: tripId,
      outcome: errorCount > 0 ? "FAILED" : "SUCCESS",
      requestId: c.req.header("x-request-id"),
      metadata: { projection_types: types, error_count: errorCount }
    });

    return c.json({ ok: errorCount === 0, trip_id: tripId, error_count: errorCount, results }, errorCount > 0 ? 500 : 200);
  } catch (err) {
    await writeAuditLog(c.env, {
      auth,
      action: "projection.rebuild",
      subjectType: "TRIP",
      subjectId: tripId,
      outcome: "FAILED",
      requestId: c.req.header("x-request-id"),
      metadata: { projection_types: types, error: err instanceof Error ? err.message : "rebuild_failed" }
    });
    return c.json({
      ok: false,
      error: err instanceof Error ? err.message : "rebuild_failed"
    }, 500);
  }
});

projectionRouter.post("/rebuild/batch", requireRole("ORG_ADMIN", "OWNER", "CAPTAIN"), async (c) => {
  const auth = c.get("auth");
  const body = await readProjectionJson(c);
  if (body === undefined) {
    return c.json({ error: "invalid_payload", message: "request body must be valid JSON" }, 400);
  }

  const parsed = batchRebuildSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const tripIds = [...new Set(parsed.data.trip_ids)];
  const results: Record<string, unknown> = {};

  for (const tripId of tripIds) {
    try {
      results[tripId] = await rebuildAllProjections(c.env, auth.tenantId, tripId);
    } catch (err) {
      results[tripId] = {
        ok: false,
        error: err instanceof Error ? err.message : "rebuild_failed"
      };
    }
  }

  const summary = summarizeProjectionBatchResults(results);
  await writeAuditLog(c.env, {
    auth,
    action: "projection.rebuild_batch",
    subjectType: "TRIP",
    subjectId: tripIds.join(","),
    outcome: summary.failed_count > 0 ? "FAILED" : "SUCCESS",
    requestId: c.req.header("x-request-id"),
    metadata: {
      trip_count: tripIds.length,
      ...summary
    }
  });

  return c.json({ ok: summary.failed_count === 0, ...summary, results });
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
