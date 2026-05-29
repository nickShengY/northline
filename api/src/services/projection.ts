import type { Env } from "../types";
import { withTenant } from "../lib/db";
import type { OpsEvent } from "@northline/shared";

export interface ProjectionRebuildResult {
  projection_type: string;
  rebuilt_count: number;
  errors: Array<{ id: string; error: string }>;
  started_at: string;
  completed_at: string;
  duration_ms: number;
}

export interface ProjectionState {
  trip_state?: Record<string, unknown>;
  gear_state?: Record<string, unknown>;
  compliance_state?: Record<string, unknown>;
  catch_rollups?: Record<string, unknown>;
  safety_risk_series?: Record<string, unknown>;
}

/**
 * Rebuild trip_state projection from event stream
 */
export async function rebuildTripState(
  env: Env,
  tenantId: string,
  tripId: string,
  events: OpsEvent[]
): Promise<ProjectionRebuildResult> {
  const startedAt = new Date();
  const errors: Array<{ id: string; error: string }> = [];
  let rebuiltCount = 0;

  try {
    // Sort events by device timestamp
    const sortedEvents = [...events].sort((a, b) =>
      new Date(a.ts_device).getTime() - new Date(b.ts_device).getTime()
    );

    // Build trip state from events
    const tripState: Record<string, unknown> = {
      trip_id: tripId,
      tenant_id: tenantId,
      status: "PLANNED",
      completion_meter: 0,
      compliance_open_issues: 0,
      latest_risk_tier: "LOW"
    };

    for (const event of sortedEvents) {
      try {
        const payload = event.payload_json as Record<string, unknown>;

        switch (event.event_type) {
          case "TRIP_PLANNED":
            tripState.status = "PLANNED";
            tripState.location_name = payload.location_name;
            tripState.owner_id = event.actor_id;
            break;

          case "TRIP_STARTED":
            tripState.status = "ACTIVE";
            tripState.started_at = event.ts_device;
            break;

          case "TRIP_ENDED":
            tripState.status = "ENDED";
            tripState.ended_at = event.ts_device;
            break;

          case "TRIP_CANCELLED":
            tripState.status = "CANCELLED";
            break;

          case "CATCH_RECORDED":
            tripState.completion_meter = Math.min(100, (tripState.completion_meter as number) + 2);
            break;

          case "COMPLIANCE_SIGNED":
            tripState.completion_meter = Math.min(100, (tripState.completion_meter as number) + 10);
            break;

          case "INCIDENT_OPENED":
            tripState.latest_risk_tier = "HIGH";
            break;

          case "NEAR_MISS_RECORDED":
            tripState.latest_risk_tier = "MODERATE";
            break;
        }

        rebuiltCount++;
      } catch (err) {
        errors.push({
          id: event.event_id,
          error: err instanceof Error ? err.message : "Unknown error"
        });
      }
    }

    // Persist the rebuilt state
    await withTenant(env, tenantId, async (sql) => {
      await sql`
        insert into trip_state (
          trip_id, tenant_id, mode, owner_id, status, started_at, ended_at,
          location_name, completion_meter, compliance_open_issues, latest_risk_tier
        ) values (
          ${tripId}, ${tenantId}, ${tripState.mode ?? "OFFSHORE"}, ${tripState.owner_id as string},
          ${tripState.status as string}, ${tripState.started_at as string ?? null}::timestamptz,
          ${tripState.ended_at as string ?? null}::timestamptz,
          ${tripState.location_name as string ?? null},
          ${tripState.completion_meter as number}, ${tripState.compliance_open_issues as number},
          ${tripState.latest_risk_tier as string}
        )
        on conflict (trip_id) do update
        set status = excluded.status,
            started_at = excluded.started_at,
            ended_at = excluded.ended_at,
            location_name = excluded.location_name,
            completion_meter = excluded.completion_meter,
            compliance_open_issues = excluded.compliance_open_issues,
            latest_risk_tier = excluded.latest_risk_tier
      `;
    });

    const completedAt = new Date();

    return {
      projection_type: "trip_state",
      rebuilt_count: rebuiltCount,
      errors,
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      duration_ms: completedAt.getTime() - startedAt.getTime()
    };
  } catch (err) {
    const completedAt = new Date();
    return {
      projection_type: "trip_state",
      rebuilt_count: 0,
      errors: [{ id: "rebuild_error", error: err instanceof Error ? err.message : "Unknown error" }],
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      duration_ms: completedAt.getTime() - startedAt.getTime()
    };
  }
}

/**
 * Rebuild gear_state_offshore projection from event stream
 */
export async function rebuildGearStateOffshore(
  env: Env,
  tenantId: string,
  tripId: string,
  events: OpsEvent[]
): Promise<ProjectionRebuildResult> {
  const startedAt = new Date();
  const errors: Array<{ id: string; error: string }> = [];
  let rebuiltCount = 0;

  const gearStates = new Map<string, Record<string, unknown>>();

  const gearEvents = events.filter(e =>
    ["GEAR_REGISTERED", "GEAR_SET", "GEAR_CHECKED", "GEAR_HAULED", "GEAR_MARKED_MISSING",
     "GEAR_RECOVERED", "GEAR_REMOVED", "GEAR_RECOVERY_PLAN_CREATED", "STRING_STORM_PRIORITY_SET"].includes(e.event_type)
  );

  for (const event of gearEvents) {
    try {
      const payload = event.payload_json as Record<string, unknown>;
      const gearId = payload.gear_id as string;

      if (!gearId) continue;

      let state = gearStates.get(gearId) || {
        gear_id: gearId,
        trip_id: tripId,
        mode: "OFFSHORE",
        status: "REGISTERED",
        last_seen_at: event.ts_device,
        metadata: {}
      };

      switch (event.event_type) {
        case "GEAR_REGISTERED":
          state.status = "REGISTERED";
          state.metadata = { ...state.metadata as object, registered_at: event.ts_device };
          break;
        case "GEAR_SET":
          state.status = "SET";
          if (payload.location) state.last_position = payload.location;
          break;
        case "GEAR_CHECKED":
          state.status = "CHECKED";
          state.last_seen_at = event.ts_device;
          break;
        case "GEAR_HAULED":
          state.status = "HAULED";
          state.last_seen_at = event.ts_device;
          break;
        case "GEAR_MARKED_MISSING":
          state.status = "MISSING";
          break;
        case "GEAR_RECOVERED":
          state.status = "RECOVERED";
          state.last_seen_at = event.ts_device;
          break;
        case "GEAR_REMOVED":
          state.status = "REMOVED";
          break;
        case "STRING_STORM_PRIORITY_SET":
          state.metadata = { ...state.metadata as object, storm_priority: payload.priority };
          break;
      }

      gearStates.set(gearId, state);
      rebuiltCount++;
    } catch (err) {
      errors.push({
        id: event.event_id,
        error: err instanceof Error ? err.message : "Unknown error"
      });
    }
  }

  // Persist all gear states
  for (const [, state] of gearStates) {
    await withTenant(env, tenantId, async (sql) => {
      await sql`
        insert into gear_state_offshore (
          gear_id, tenant_id, trip_id, status, last_seen_at, last_position, metadata
        ) values (
          ${state.gear_id as string}, ${tenantId}, ${tripId}, ${state.status as string},
          ${state.last_seen_at as string}::timestamptz,
          ${state.last_position ? JSON.stringify(state.last_position) : null}::jsonb,
          ${JSON.stringify(state.metadata)}::jsonb
        )
        on conflict (gear_id) do update
        set status = excluded.status,
            last_seen_at = excluded.last_seen_at,
            last_position = excluded.last_position,
            metadata = excluded.metadata
      `;
    });
  }

  const completedAt = new Date();

  return {
    projection_type: "gear_state_offshore",
    rebuilt_count: rebuiltCount,
    errors,
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    duration_ms: completedAt.getTime() - startedAt.getTime()
  };
}

/**
 * Rebuild catch_rollups projection from event stream
 */
export async function rebuildCatchRollups(
  env: Env,
  tenantId: string,
  tripId: string,
  events: OpsEvent[]
): Promise<ProjectionRebuildResult> {
  const startedAt = new Date();
  const errors: Array<{ id: string; error: string }> = [];
  let rebuiltCount = 0;

  const speciesRollups = new Map<string, { species: string; count: number; total_weight: number; avg_length: number }>();

  const catchEvents = events.filter(e =>
    ["CATCH_RECORDED", "CATCH_CORRECTED"].includes(e.event_type)
  );

  for (const event of catchEvents) {
    try {
      const payload = event.payload_json as Record<string, unknown>;
      const species = payload.species as string;

      if (!species) continue;

      let rollup = speciesRollups.get(species) || {
        species,
        count: 0,
        total_weight: 0,
        avg_length: 0
      };

      if (event.event_type === "CATCH_RECORDED" && payload.kept !== false) {
        rollup.count++;
        if (payload.weight_kg) rollup.total_weight += payload.weight_kg as number;
        if (payload.length_cm) {
          rollup.avg_length = (rollup.avg_length * (rollup.count - 1) + (payload.length_cm as number)) / rollup.count;
        }
      }

      speciesRollups.set(species, rollup);
      rebuiltCount++;
    } catch (err) {
      errors.push({
        id: event.event_id,
        error: err instanceof Error ? err.message : "Unknown error"
      });
    }
  }

  // Persist rollups
  for (const [, rollup] of speciesRollups) {
    await withTenant(env, tenantId, async (sql) => {
      await sql`
        insert into catch_rollups (
          trip_id, tenant_id, species, count, total_weight_kg, avg_length_cm
        ) values (
          ${tripId}, ${tenantId}, ${rollup.species}, ${rollup.count},
          ${rollup.total_weight}, ${rollup.avg_length}
        )
        on conflict (trip_id, species) do update
        set count = excluded.count,
            total_weight_kg = excluded.total_weight_kg,
            avg_length_cm = excluded.avg_length_cm
      `;
    });
  }

  const completedAt = new Date();

  return {
    projection_type: "catch_rollups",
    rebuilt_count: rebuiltCount,
    errors,
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    duration_ms: completedAt.getTime() - startedAt.getTime()
  };
}

/**
 * Rebuild all projections for a trip from the event stream
 */
export async function rebuildAllProjections(
  env: Env,
  tenantId: string,
  tripId: string
): Promise<{
  trip_state: ProjectionRebuildResult;
  gear_state: ProjectionRebuildResult;
  catch_rollups: ProjectionRebuildResult;
}> {
  // Fetch all events for the trip
  const events = await withTenant(env, tenantId, async (sql) => {
    return sql`
      select *
      from ops_event
      where tenant_id = ${tenantId}
        and (payload_json->>'trip_id' = ${tripId} or subject_id = ${tripId})
      order by ts_device asc
    ` as Promise<OpsEvent[]>;
  });

  const [tripState, gearState, catchRollups] = await Promise.all([
    rebuildTripState(env, tenantId, tripId, events),
    rebuildGearStateOffshore(env, tenantId, tripId, events),
    rebuildCatchRollups(env, tenantId, tripId, events)
  ]);

  return {
    trip_state: tripState,
    gear_state: gearState,
    catch_rollups: catchRollups
  };
}

/**
 * Deterministic rebuild test - replay fixture events and verify outputs match expected
 */
export async function runDeterministicRebuildTest(
  env: Env,
  tenantId: string,
  tripId: string,
  expectedState: ProjectionState
): Promise<{
  passed: boolean;
  mismatches: Array<{ field: string; expected: unknown; actual: unknown }>;
}> {
  const mismatches: Array<{ field: string; expected: unknown; actual: unknown }> = [];

  // Rebuild projections
  const results = await rebuildAllProjections(env, tenantId, tripId);

  // Fetch rebuilt state
  const actualState = await withTenant(env, tenantId, async (sql) => {
    const trip = await sql`
      select * from trip_state where trip_id = ${tripId} limit 1
    `;
    return { trip_state: trip[0] };
  });

  // Compare expected vs actual
  if (expectedState.trip_state && actualState.trip_state) {
    for (const [key, expected] of Object.entries(expectedState.trip_state)) {
      const actual = (actualState.trip_state as Record<string, unknown>)[key];
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        mismatches.push({ field: key, expected, actual });
      }
    }
  }

  return {
    passed: mismatches.length === 0,
    mismatches
  };
}
