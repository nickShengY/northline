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

function timestampMillis(value: string | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function compareProjectionEvents(left: OpsEvent, right: OpsEvent) {
  const leftServer = timestampMillis(left.ts_server);
  const rightServer = timestampMillis(right.ts_server);
  if (leftServer !== rightServer) return leftServer - rightServer;

  const leftDevice = timestampMillis(left.ts_device);
  const rightDevice = timestampMillis(right.ts_device);
  if (leftDevice !== rightDevice) return leftDevice - rightDevice;

  return left.event_id.localeCompare(right.event_id);
}

function orderProjectionEvents(events: OpsEvent[]) {
  return [...events].sort(compareProjectionEvents);
}

function payloadOf(event: OpsEvent) {
  return event.payload_json && typeof event.payload_json === "object" ? event.payload_json as Record<string, unknown> : {};
}

function modeFromPayload(payload: Record<string, unknown>): "OFFSHORE" | "ICE" {
  return payload.mode === "ICE" ? "ICE" : "OFFSHORE";
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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
    const sortedEvents = orderProjectionEvents(events);

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
        const payload = payloadOf(event);

        switch (event.event_type) {
          case "TRIP_PLANNED":
            tripState.status = "PLANNED";
            tripState.location_name = payload.location_name;
            tripState.owner_id = payload.owner_id ?? event.actor_id;
            tripState.mode = modeFromPayload(payload);
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
          location_name, completion_meter, compliance_open_issues, latest_risk_tier, updated_at
        ) values (
          ${tripId}, ${tenantId}, ${tripState.mode as string}, ${String(tripState.owner_id ?? "system")},
          ${tripState.status as string}, ${tripState.started_at as string ?? null}::timestamptz,
          ${tripState.ended_at as string ?? null}::timestamptz,
          ${tripState.location_name as string ?? null},
          ${tripState.completion_meter as number}, ${tripState.compliance_open_issues as number},
          ${tripState.latest_risk_tier as string}, now()
        )
        on conflict (trip_id) do update
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

  const gearEvents = orderProjectionEvents(events).filter(e =>
    ["GEAR_REGISTERED", "GEAR_SET", "GEAR_CHECKED", "GEAR_HAULED", "GEAR_MARKED_MISSING",
     "GEAR_RECOVERED", "GEAR_REMOVED", "GEAR_RECOVERY_PLAN_CREATED", "STRING_STORM_PRIORITY_SET"].includes(e.event_type)
  );

  for (const event of gearEvents) {
    try {
      const payload = payloadOf(event);
      const gearId = payload.gear_id as string;

      if (!gearId || modeFromPayload(payload) !== "OFFSHORE") continue;

      let state = gearStates.get(gearId) || {
        gear_id: gearId,
        trip_id: tripId,
        mode: "OFFSHORE",
        status: "REGISTERED",
        last_seen_at: event.ts_device,
        last_position: null,
        set_time: null,
        buoy_label: null,
        pot_count: null,
        line_length_m: null,
        target_depth_m: null
      };

      switch (event.event_type) {
        case "GEAR_REGISTERED":
          state.status = "REGISTERED";
          state.buoy_label = payload.buoy_label ?? state.buoy_label;
          state.pot_count = payload.pot_count ?? state.pot_count;
          state.line_length_m = payload.line_length_m ?? state.line_length_m;
          state.target_depth_m = payload.target_depth_m ?? state.target_depth_m;
          break;
        case "GEAR_SET":
          state.status = "SET";
          state.set_time = event.ts_device;
          if (payload.position ?? payload.location) state.last_position = payload.position ?? payload.location;
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

  await withTenant(env, tenantId, async (sql) => {
    await sql`delete from gear_state_offshore where tenant_id = ${tenantId} and trip_id = ${tripId}`;

    for (const [, state] of gearStates) {
      await sql`
        insert into gear_state_offshore (
          gear_id, tenant_id, trip_id, status, buoy_label, pot_count, line_length_m,
          target_depth_m, set_time, last_position, updated_at
        ) values (
          ${state.gear_id as string}, ${tenantId}, ${tripId}, ${state.status as string},
          ${state.buoy_label as string | null}, ${state.pot_count as number | null},
          ${state.line_length_m as number | null}, ${state.target_depth_m as number | null},
          ${state.set_time as string | null}::timestamptz,
          ${state.last_position ? JSON.stringify(state.last_position) : null}::jsonb,
          now()
        )
        on conflict (gear_id) do update
        set status = excluded.status,
            buoy_label = excluded.buoy_label,
            pot_count = excluded.pot_count,
            line_length_m = excluded.line_length_m,
            target_depth_m = excluded.target_depth_m,
            set_time = excluded.set_time,
            last_position = excluded.last_position,
            updated_at = now()
      `;
    }
  });

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

  const catchRecords = new Map<string, {
    catch_id: string;
    species: string;
    mode: "OFFSHORE" | "ICE";
    kept: boolean;
    weight_kg: number;
    length_cm: number;
  }>();

  const catchEvents = orderProjectionEvents(events).filter(e =>
    ["CATCH_RECORDED", "CATCH_CORRECTED"].includes(e.event_type)
  );

  for (const event of catchEvents) {
    try {
      const payload = payloadOf(event);
      const catchId = String(payload.catch_id ?? "");

      if (!catchId) continue;

      if (event.event_type === "CATCH_RECORDED") {
        const species = String(payload.species ?? "");
        if (!species) continue;

        catchRecords.set(catchId, {
          catch_id: catchId,
          species,
          mode: modeFromPayload(payload),
          kept: payload.kept !== false,
          weight_kg: finiteNumber(payload.weight_kg),
          length_cm: finiteNumber(payload.length_cm)
        });
      } else {
        const current = catchRecords.get(catchId);
        const corrections = payload.corrections && typeof payload.corrections === "object"
          ? payload.corrections as Record<string, unknown>
          : {};
        if (current) {
          catchRecords.set(catchId, {
            ...current,
            species: typeof corrections.species === "string" ? corrections.species : current.species,
            mode: corrections.mode === "ICE" || corrections.mode === "OFFSHORE" ? corrections.mode : current.mode,
            kept: typeof corrections.kept === "boolean" ? corrections.kept : current.kept,
            weight_kg: typeof corrections.weight_kg === "number" && Number.isFinite(corrections.weight_kg)
              ? corrections.weight_kg
              : current.weight_kg,
            length_cm: typeof corrections.length_cm === "number" && Number.isFinite(corrections.length_cm)
              ? corrections.length_cm
              : current.length_cm
          });
        }
      }

      rebuiltCount++;
    } catch (err) {
      errors.push({
        id: event.event_id,
        error: err instanceof Error ? err.message : "Unknown error"
      });
    }
  }

  const speciesRollups = new Map<string, {
    rollup_id: string;
    species: string;
    mode: "OFFSHORE" | "ICE";
    kept_count: number;
    released_count: number;
    total_weight_kg: number;
    total_length_cm: number;
    evidence_count: number;
  }>();

  for (const record of catchRecords.values()) {
    const key = `${record.mode}:${record.species}`;
    const current = speciesRollups.get(key) ?? {
      rollup_id: `${tripId}:${key}`,
      species: record.species,
      mode: record.mode,
      kept_count: 0,
      released_count: 0,
      total_weight_kg: 0,
      total_length_cm: 0,
      evidence_count: 0
    };

    if (record.kept) {
      current.kept_count += 1;
    } else {
      current.released_count += 1;
    }
    current.total_weight_kg += record.weight_kg;
    current.total_length_cm += record.length_cm;
    current.evidence_count += 1;
    speciesRollups.set(key, current);
  }

  await withTenant(env, tenantId, async (sql) => {
    await sql`delete from catch_rollups where tenant_id = ${tenantId} and trip_id = ${tripId}`;

    for (const [, rollup] of speciesRollups) {
      await sql`
        insert into catch_rollups (
          rollup_id, tenant_id, trip_id, mode, species, kept_count, released_count,
          total_weight_kg, total_length_cm, evidence_count, updated_at
        ) values (
          ${rollup.rollup_id}, ${tenantId}, ${tripId}, ${rollup.mode}, ${rollup.species},
          ${rollup.kept_count}, ${rollup.released_count}, ${rollup.total_weight_kg},
          ${rollup.total_length_cm}, ${rollup.evidence_count}, now()
        )
        on conflict (rollup_id) do update
        set kept_count = excluded.kept_count,
            released_count = excluded.released_count,
            total_weight_kg = excluded.total_weight_kg,
            total_length_cm = excluded.total_length_cm,
            evidence_count = excluded.evidence_count,
            updated_at = now()
      `;
    }
  });

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
      order by ts_server asc, event_id asc
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
