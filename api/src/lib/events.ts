import { verifyHashChain, type OpsEvent } from "@northline/shared";
import type { Env } from "../types";
import { withTenant, type SqlQuery } from "./db";

type Payload = Record<string, unknown>;
type DeviceChainCache = Map<string, string | null>;
type ParsedEventCursor =
  | { kind: "none" }
  | { kind: "timestamp"; tsServer: string }
  | { kind: "event"; tsServer: string; eventId: string };

function asPayload(event: OpsEvent): Payload {
  return event.payload_json && typeof event.payload_json === "object" ? event.payload_json as Payload : {};
}

function modeFromPayload(payload: Payload): "OFFSHORE" | "ICE" {
  return payload.mode === "ICE" ? "ICE" : "OFFSHORE";
}

function riskTierFromIssues(issues: unknown): "LOW" | "MODERATE" | "HIGH" | "CRITICAL" {
  if (!Array.isArray(issues)) return "LOW";
  const errorCount = issues.filter((issue) =>
    typeof issue === "object" &&
    issue !== null &&
    (issue as { severity?: unknown }).severity === "error"
  ).length;
  if (errorCount >= 3) return "CRITICAL";
  if (errorCount > 0) return "HIGH";
  return issues.length > 0 ? "MODERATE" : "LOW";
}

export async function projectAcceptedEvent(sql: SqlQuery, tenantId: string, event: OpsEvent) {
  const payload = asPayload(event);

  switch (event.event_type) {
    case "TRIP_PLANNED": {
      const tripId = String(payload.trip_id ?? "");
      if (!tripId) break;
      await sql`
        insert into trip_state (
          trip_id, tenant_id, mode, owner_id, status, location_name, completion_meter,
          compliance_open_issues, latest_risk_tier, updated_at
        ) values (
          ${tripId}, ${tenantId}, ${modeFromPayload(payload)}, ${String(payload.owner_id ?? event.actor_id)},
          ${"PLANNED"}, ${payload.location_name ? String(payload.location_name) : null}, 0, 0, ${"LOW"}, now()
        )
        on conflict (tenant_id, trip_id) do update
        set mode = excluded.mode,
            owner_id = excluded.owner_id,
            status = excluded.status,
            location_name = excluded.location_name,
            updated_at = now()
      `;
      break;
    }

    case "TRIP_STARTED":
    case "TRIP_ENDED":
    case "TRIP_CANCELLED": {
      const tripId = String(payload.trip_id ?? "");
      if (!tripId) break;
      const status = event.event_type === "TRIP_STARTED" ? "ACTIVE" : event.event_type === "TRIP_ENDED" ? "ENDED" : "CANCELLED";
      await sql`
        update trip_state
        set status = ${status},
            started_at = case when ${event.event_type} = 'TRIP_STARTED' then ${event.ts_device}::timestamptz else started_at end,
            ended_at = case when ${event.event_type} = 'TRIP_ENDED' then ${event.ts_device}::timestamptz else ended_at end,
            updated_at = now()
        where tenant_id = ${tenantId} and trip_id = ${tripId}
      `;
      break;
    }

    case "COMPLIANCE_VALIDATION_RAN": {
      const tripId = String(payload.trip_id ?? "");
      if (!tripId) break;
      const issues = Array.isArray(payload.issues) ? payload.issues : [];
      const errorCount = issues.filter((issue) =>
        typeof issue === "object" &&
        issue !== null &&
        (issue as { severity?: unknown }).severity === "error"
      ).length;
      await sql`
        update trip_state
        set completion_meter = ${Number(payload.completion_meter ?? 0)},
            compliance_open_issues = ${errorCount},
            latest_risk_tier = ${riskTierFromIssues(payload.issues)},
            updated_at = now()
        where tenant_id = ${tenantId} and trip_id = ${tripId}
      `;
      break;
    }

    case "GEAR_REGISTERED":
    case "GEAR_SET":
    case "GEAR_CHECKED":
    case "GEAR_HAULED":
    case "GEAR_MARKED_MISSING":
    case "GEAR_RECOVERED":
    case "GEAR_REMOVED": {
      const tripId = String(payload.trip_id ?? "");
      const gearId = String(payload.gear_id ?? "");
      if (!tripId || !gearId) break;
      const statusByType: Record<string, string> = {
        GEAR_REGISTERED: "REGISTERED",
        GEAR_SET: "SET",
        GEAR_CHECKED: "CHECKED",
        GEAR_HAULED: "HAULED",
        GEAR_MARKED_MISSING: "MISSING",
        GEAR_RECOVERED: "RECOVERED",
        GEAR_REMOVED: "REMOVED"
      };
      const status = statusByType[event.event_type] ?? "REGISTERED";
      const position = payload.position ? JSON.stringify(payload.position) : null;

      if (modeFromPayload(payload) === "ICE") {
        await sql`
          insert into gear_state_ice (gear_id, tenant_id, trip_id, status, last_position, updated_at)
          values (${gearId}, ${tenantId}, ${tripId}, ${status}, ${position}::jsonb, now())
          on conflict (tenant_id, gear_id) do update
          set trip_id = excluded.trip_id,
              status = excluded.status,
              last_position = coalesce(excluded.last_position, gear_state_ice.last_position),
              updated_at = now()
        `;
      } else {
        await sql`
          insert into gear_state_offshore (gear_id, tenant_id, trip_id, status, last_position, updated_at)
          values (${gearId}, ${tenantId}, ${tripId}, ${status}, ${position}::jsonb, now())
          on conflict (tenant_id, gear_id) do update
          set trip_id = excluded.trip_id,
              status = excluded.status,
              last_position = coalesce(excluded.last_position, gear_state_offshore.last_position),
              updated_at = now()
        `;
      }
      break;
    }

    case "HAZARD_REPORTED": {
      const hazardId = String(payload.hazard_id ?? "");
      const location = payload.location ? JSON.stringify(payload.location) : null;
      if (!hazardId || !location) break;
      await sql`
        insert into hazard_layer_state (
          hazard_id, tenant_id, type, severity, confidence, location, sharing_scope, reported_by, ts_last_update
        ) values (
          ${hazardId}, ${tenantId}, ${String(payload.hazard_type ?? "WEATHER")},
          ${Number(payload.severity ?? 1)}, ${Number(payload.confidence ?? 0.5)},
          ${location}::jsonb, ${String(payload.sharing_scope ?? "ORG")}, ${event.actor_id}, now()
        )
        on conflict (tenant_id, hazard_id) do update
        set severity = excluded.severity,
            confidence = excluded.confidence,
            location = excluded.location,
            sharing_scope = excluded.sharing_scope,
            ts_last_update = now()
      `;
      break;
    }

    case "HAZARD_CONFIRMED": {
      const hazardId = String(payload.hazard_id ?? "");
      if (!hazardId) break;
      await sql`
        update hazard_layer_state
        set confirmed_count = confirmed_count + 1,
            confidence = least(1, confidence + 0.15),
            ts_last_update = now()
        where tenant_id = ${tenantId} and hazard_id = ${hazardId}
      `;
      break;
    }

    default:
      break;
  }
}

export async function validateDeviceChainContinuity(
  sql: SqlQuery,
  tenantId: string,
  event: OpsEvent,
  latestByDevice: DeviceChainCache
): Promise<"ok" | "hash_chain_gap" | "hash_chain_conflict"> {
  let latestHash = latestByDevice.get(event.device_id);

  if (latestHash === undefined) {
    const rows = await sql`
      select event_hash
      from ops_event
      where tenant_id = ${tenantId}
        and device_id = ${event.device_id}
      order by ts_server desc
      limit 1
    `;
    latestHash = rows[0]?.event_hash ? String(rows[0].event_hash) : null;
    latestByDevice.set(event.device_id, latestHash);
  }

  if (!latestHash && event.prev_hash) return "hash_chain_gap";
  if (latestHash && event.prev_hash !== latestHash) return "hash_chain_conflict";

  latestByDevice.set(event.device_id, event.event_hash);
  return "ok";
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;
  return code === "23505" || (typeof message === "string" && message.includes("duplicate key"));
}

export async function appendEvents(env: Env, tenantId: string, events: OpsEvent[]) {
  if (!events.length) return { accepted: [], rejected: [] as Array<{ event_id: string; reason: string }> };

  const accepted: OpsEvent[] = [];
  const rejected: Array<{ event_id: string; reason: string }> = [];
  const latestByDevice: DeviceChainCache = new Map();

  await withTenant(env, tenantId, async (sql) => {
    for (const event of events) {
      const chainOk = await verifyHashChain(event);
      if (!chainOk) {
        rejected.push({ event_id: event.event_id, reason: "hash_chain_invalid" });
        continue;
      }

      const dup = await sql`
        select to_char(ts_server at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as ts_server
        from ops_event
        where tenant_id = ${tenantId} and event_id = ${event.event_id}
        limit 1
      `;
      if (dup.length) {
        // Idempotent redelivery: the event is already durably stored, so
        // report it as accepted rather than leaving the client to retry forever.
        accepted.push({ ...event, ts_server: dup[0]?.ts_server ? String(dup[0].ts_server) : event.ts_server });
        continue;
      }

      const continuity = await validateDeviceChainContinuity(sql, tenantId, event, latestByDevice);
      if (continuity !== "ok") {
        rejected.push({ event_id: event.event_id, reason: continuity });
        continue;
      }

      let inserted;
      try {
        inserted = await sql`
          insert into ops_event (
            event_id, tenant_id, subject_type, subject_id, actor_id, device_id,
            ts_device, event_type, schema_version, payload_json, prev_hash, event_hash, signature
          ) values (
            ${event.event_id}, ${event.tenant_id}, ${event.subject_type}, ${event.subject_id}, ${event.actor_id}, ${event.device_id},
            ${event.ts_device}::timestamptz, ${event.event_type}, ${event.schema_version}, ${JSON.stringify(event.payload_json)}::jsonb,
            ${event.prev_hash ?? null}, ${event.event_hash}, ${event.signature}
          )
          returning to_char(ts_server at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as ts_server
        `;
      } catch (error) {
        // ops_event.event_id is a global primary key while the dedup check
        // above is tenant-scoped: a colliding id owned by another tenant must
        // reject just this event, not 500 the whole batch (which would also
        // leak an existence oracle across tenants).
        if (isUniqueViolation(error)) {
          rejected.push({ event_id: event.event_id, reason: "event_id_conflict" });
          continue;
        }
        throw error;
      }
      await projectAcceptedEvent(sql, tenantId, event);
      accepted.push({ ...event, ts_server: inserted[0]?.ts_server ? String(inserted[0].ts_server) : event.ts_server });
    }
  });

  return { accepted, rejected };
}

export function buildEventCursor(event: Pick<OpsEvent, "event_id" | "ts_server">): string {
  return `${event.ts_server ?? ""}|${event.event_id}`;
}

export function parseEventCursor(cursor?: string): ParsedEventCursor {
  if (!cursor?.trim()) return { kind: "none" };
  const trimmed = cursor.trim();
  const separator = trimmed.lastIndexOf("|");
  if (separator <= 0 || separator === trimmed.length - 1) {
    return { kind: "timestamp", tsServer: trimmed };
  }

  return {
    kind: "event",
    tsServer: trimmed.slice(0, separator),
    eventId: trimmed.slice(separator + 1)
  };
}

/**
 * Fetches events belonging to a single trip/subject with a SQL-level filter
 * (payload trip_id or subject_id match), instead of scanning the oldest N
 * tenant-wide events and filtering in JS.
 *
 * With `latest: true` the most recent `limit` events are returned (still in
 * ascending ts_server order); otherwise the earliest `limit` events are used.
 */
export async function eventsForTrip(
  env: Env,
  tenantId: string,
  tripId: string,
  options: { limit?: number; latest?: boolean } = {}
): Promise<OpsEvent[]> {
  const limit = options.limit ?? 5000;
  return withTenant(env, tenantId, async (sql) => {
    const rows = options.latest
      ? await sql`
        select event_id, tenant_id, subject_type, subject_id, actor_id, device_id,
               to_char(ts_device at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as ts_device,
               to_char(ts_server at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as ts_server,
               event_type, schema_version, payload_json,
               prev_hash, event_hash, signature
        from ops_event
        where tenant_id = ${tenantId}
          and (payload_json->>'trip_id' = ${tripId} or subject_id = ${tripId})
        order by ts_server desc, event_id desc
        limit ${limit}
      `
      : await sql`
        select event_id, tenant_id, subject_type, subject_id, actor_id, device_id,
               to_char(ts_device at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as ts_device,
               to_char(ts_server at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as ts_server,
               event_type, schema_version, payload_json,
               prev_hash, event_hash, signature
        from ops_event
        where tenant_id = ${tenantId}
          and (payload_json->>'trip_id' = ${tripId} or subject_id = ${tripId})
        order by ts_server asc, event_id asc
        limit ${limit}
      `;

    return (options.latest ? rows.reverse() : rows) as OpsEvent[];
  });
}

export async function eventsSinceCursor(env: Env, tenantId: string, cursor?: string, limit = 1000): Promise<OpsEvent[]> {
  return withTenant(env, tenantId, async (sql) => {
    const parsedCursor = parseEventCursor(cursor);
    const rows = parsedCursor.kind === "event"
      ? await sql`
        select event_id, tenant_id, subject_type, subject_id, actor_id, device_id,
               to_char(ts_device at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as ts_device,
               to_char(ts_server at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as ts_server,
               event_type, schema_version, payload_json,
               prev_hash, event_hash, signature
        from ops_event
        where tenant_id = ${tenantId}
          and (
            ts_server > ${parsedCursor.tsServer}::timestamptz
            or (ts_server = ${parsedCursor.tsServer}::timestamptz and event_id > ${parsedCursor.eventId})
          )
        order by ts_server asc, event_id asc
        limit ${limit}
      `
      : parsedCursor.kind === "timestamp"
        ? await sql`
        select event_id, tenant_id, subject_type, subject_id, actor_id, device_id,
               to_char(ts_device at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as ts_device,
               to_char(ts_server at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as ts_server,
               event_type, schema_version, payload_json,
               prev_hash, event_hash, signature
        from ops_event
        where tenant_id = ${tenantId}
          and ts_server > ${parsedCursor.tsServer}::timestamptz
        order by ts_server asc, event_id asc
        limit ${limit}
      `
        : await sql`
        select event_id, tenant_id, subject_type, subject_id, actor_id, device_id,
               to_char(ts_device at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as ts_device,
               to_char(ts_server at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as ts_server,
               event_type, schema_version, payload_json,
               prev_hash, event_hash, signature
        from ops_event
        where tenant_id = ${tenantId}
        order by ts_server asc, event_id asc
        limit ${limit}
      `;

    return rows as OpsEvent[];
  });
}
