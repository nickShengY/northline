import type { ComplianceIssue, GearState, OpsEvent, TripState } from "../models/core";

export interface ProjectionSnapshot {
  trips: Record<string, TripState>;
  gear: Record<string, GearState>;
  compliance: Record<string, { completion_meter: number; issues: ComplianceIssue[] }>;
  hazards: Record<string, { confidence: number; confirmations: number }>;
}

export function createEmptySnapshot(): ProjectionSnapshot {
  return {
    trips: {},
    gear: {},
    compliance: {},
    hazards: {}
  };
}

export function applyEvent(snapshot: ProjectionSnapshot, event: OpsEvent): ProjectionSnapshot {
  const next = structuredClone(snapshot);
  const payload = event.payload_json as Record<string, unknown>;

  switch (event.event_type) {
    case "TRIP_PLANNED": {
      const tripId = String(payload.trip_id);
      next.trips[tripId] = {
        trip_id: tripId,
        tenant_id: event.tenant_id,
        mode: (payload.mode as "OFFSHORE" | "ICE") ?? "ICE",
        owner_id: String(payload.owner_id ?? event.actor_id),
        status: "PLANNED",
        location_name: payload.location_name ? String(payload.location_name) : undefined,
        completion_meter: 0,
        compliance_open_issues: 0,
        latest_risk_tier: "LOW"
      };
      break;
    }
    case "TRIP_STARTED": {
      const tripId = String(payload.trip_id);
      const trip = next.trips[tripId];
      if (trip) {
        trip.status = "ACTIVE";
        trip.started_at = event.ts_device;
      }
      break;
    }
    case "TRIP_ENDED": {
      const tripId = String(payload.trip_id);
      const trip = next.trips[tripId];
      if (trip) {
        trip.status = "ENDED";
        trip.ended_at = event.ts_device;
      }
      break;
    }
    case "GEAR_REGISTERED": {
      const gearId = String(payload.gear_id);
      next.gear[gearId] = {
        gear_id: gearId,
        trip_id: String(payload.trip_id),
        mode: (payload.mode as "OFFSHORE" | "ICE") ?? "ICE",
        status: "REGISTERED",
        last_seen_at: event.ts_device,
        metadata: (payload.metadata as Record<string, unknown>) ?? {}
      };
      break;
    }
    case "GEAR_SET":
    case "GEAR_CHECKED":
    case "GEAR_HAULED":
    case "GEAR_MARKED_MISSING":
    case "GEAR_RECOVERED":
    case "GEAR_REMOVED": {
      const gearId = String(payload.gear_id);
      const gear = next.gear[gearId];
      if (!gear) break;
      const statusMap: Record<
        "GEAR_SET" | "GEAR_CHECKED" | "GEAR_HAULED" | "GEAR_MARKED_MISSING" | "GEAR_RECOVERED" | "GEAR_REMOVED",
        GearState["status"]
      > = {
        GEAR_SET: "SET",
        GEAR_CHECKED: "CHECKED",
        GEAR_HAULED: "HAULED",
        GEAR_MARKED_MISSING: "MISSING",
        GEAR_RECOVERED: "RECOVERED",
        GEAR_REMOVED: "REMOVED"
      };
      gear.status = statusMap[event.event_type];
      gear.last_seen_at = event.ts_device;
      const position = payload.position as { lat: number; lon: number } | undefined;
      if (position) gear.last_position = position;
      break;
    }
    case "COMPLIANCE_VALIDATION_RAN": {
      const tripId = String(payload.trip_id);
      const meter = Number(payload.completion_meter ?? 0);
      const issues = (payload.issues as ComplianceIssue[]) ?? [];
      next.compliance[tripId] = { completion_meter: meter, issues };
      const trip = next.trips[tripId];
      if (trip) {
        trip.completion_meter = meter;
        trip.compliance_open_issues = issues.filter((i) => i.severity === "error").length;
      }
      break;
    }
    case "HAZARD_REPORTED": {
      const hazardId = String(payload.hazard_id);
      next.hazards[hazardId] = {
        confidence: Number(payload.confidence ?? 0.3),
        confirmations: 0
      };
      break;
    }
    case "HAZARD_CONFIRMED": {
      const hazardId = String(payload.hazard_id);
      const hazard = next.hazards[hazardId];
      if (hazard) {
        hazard.confirmations += 1;
        hazard.confidence = Math.min(1, hazard.confidence + 0.15);
      }
      break;
    }
    default:
      break;
  }

  return next;
}

export function replay(events: OpsEvent[]): ProjectionSnapshot {
  return events
    .slice()
    .sort((a, b) => a.ts_device.localeCompare(b.ts_device))
    .reduce(applyEvent, createEmptySnapshot());
}
