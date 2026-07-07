import type { Env } from "../types";
import type { OpsEvent } from "@northline/shared";

function isLocalDatabaseUrl(value?: string) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function canUseDevelopmentDataFallback(env: Env) {
  return env.APP_ENV === "development" && isLocalDatabaseUrl(env.NEON_DATABASE_URL);
}

export function shouldUseDevelopmentDataFallback(env: Env, error: unknown) {
  if (!canUseDevelopmentDataFallback(env)) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /connect|connection|timeout|terminated|fetch failed|ECONNREFUSED|ENOTFOUND|database/i.test(message);
}

export const demoTrips = [
  {
    trip_id: "trip_demo_001",
    tenant_id: "demoTenant",
    mode: "OFFSHORE",
    owner_id: "captain_001",
    status: "ACTIVE",
    started_at: "2026-07-06T11:00:00.000Z",
    ended_at: null,
    location_name: "Bering Sea A-12",
    completion_meter: 72,
    compliance_open_issues: 1,
    latest_risk_tier: "MODERATE",
    updated_at: "2026-07-06T18:30:00.000Z"
  },
  {
    trip_id: "trip_ice_demo_002",
    tenant_id: "demoTenant",
    mode: "ICE",
    owner_id: "guide_001",
    status: "ACTIVE",
    started_at: "2026-07-06T12:30:00.000Z",
    ended_at: null,
    location_name: "Lake Simcoe North Grid",
    completion_meter: 88,
    compliance_open_issues: 0,
    latest_risk_tier: "LOW",
    updated_at: "2026-07-06T18:15:00.000Z"
  }
] as const;

export const demoGear = [
  {
    gear_id: "STR-021",
    trip_id: "trip_demo_001",
    status: "SET",
    buoy_label: "B-21",
    pot_count: 24,
    last_position: { lat: 55.49, lon: -165.21 },
    updated_at: "2026-07-06T18:10:00.000Z"
  },
  {
    gear_id: "STR-022",
    trip_id: "trip_demo_001",
    status: "CHECKED",
    buoy_label: "B-22",
    pot_count: 18,
    last_position: { lat: 55.54, lon: -165.12 },
    updated_at: "2026-07-06T18:22:00.000Z"
  },
  {
    gear_id: "TIP-014",
    trip_id: "trip_ice_demo_002",
    status: "CHECKED",
    station_id: "station_north_01",
    tipup_type: "thermal",
    depth_m: 11,
    last_position: { lat: 44.42, lon: -79.33 },
    updated_at: "2026-07-06T18:05:00.000Z"
  }
] as const;

export const demoHazards = [
  {
    hazard_id: "hz_demo_weather_001",
    type: "WEATHER",
    severity: 3,
    confidence: 0.82,
    location: { lat: 55.52, lon: -165.18 },
    sharing_scope: "ORG",
    confirmed_count: 3,
    ts_last_update: "2026-07-06T18:18:00.000Z"
  },
  {
    hazard_id: "hz_demo_open_water_002",
    type: "OPEN_WATER",
    severity: 4,
    confidence: 0.9,
    location: { lat: 44.421, lon: -79.334 },
    sharing_scope: "GROUP",
    confirmed_count: 2,
    ts_last_update: "2026-07-06T17:55:00.000Z"
  }
] as const;

export const demoIncidents = [
  {
    case_id: "case_demo_001",
    trip_id: "trip_demo_001",
    category: "NEAR_MISS",
    severity: 3,
    status: "OPEN",
    summary: "Line tension near miss requires toolbox review before next haul.",
    opened_by: "crew_1",
    opened_at: "2026-07-06T17:48:00.000Z"
  }
] as const;

export const demoDevices = [
  {
    device_id: "bridge_tablet_001",
    subject_type: "VESSEL",
    subject_id: "northline_vessel_001",
    key_version: 1,
    revoked: false,
    last_seen_at: "2026-07-06T18:25:00.000Z",
    created_at: "2026-07-06T13:00:00.000Z"
  },
  {
    device_id: "mobile_crew_1_abcd1234",
    subject_type: "USER",
    subject_id: "crew_1",
    key_version: 1,
    revoked: false,
    last_seen_at: "2026-07-06T18:21:00.000Z",
    created_at: "2026-07-06T13:05:00.000Z"
  }
] as const;

export const demoSyncMetrics = [
  {
    metric_name: "sync_success_rate",
    avg_value: 0.96,
    max_value: 1,
    min_value: 0.88,
    samples: 18,
    latest_at: "2026-07-06T18:28:00.000Z"
  },
  {
    metric_name: "upload_queue_depth",
    avg_value: 1.4,
    max_value: 4,
    min_value: 0,
    samples: 18,
    latest_at: "2026-07-06T18:28:00.000Z"
  }
] as const;

export const demoTimelineEvents: OpsEvent[] = [
  {
    event_id: "evt_demo_trip_planned_001",
    tenant_id: "demoTenant",
    subject_type: "ORG",
    subject_id: "trip_demo_001",
    actor_id: "captain_001",
    device_id: "bridge_tablet_001",
    ts_device: "2026-07-06T10:45:00.000Z",
    ts_server: "2026-07-06T10:45:02.000Z",
    event_type: "TRIP_PLANNED",
    schema_version: 1,
    payload_json: {
      trip_id: "trip_demo_001",
      mode: "OFFSHORE",
      owner_id: "captain_001",
      location_name: "Bering Sea A-12"
    },
    prev_hash: "",
    event_hash: "demo_hash_001",
    signature: "development-demo"
  },
  {
    event_id: "evt_demo_trip_started_001",
    tenant_id: "demoTenant",
    subject_type: "ORG",
    subject_id: "trip_demo_001",
    actor_id: "captain_001",
    device_id: "bridge_tablet_001",
    ts_device: "2026-07-06T11:00:00.000Z",
    ts_server: "2026-07-06T11:00:02.000Z",
    event_type: "TRIP_STARTED",
    schema_version: 1,
    payload_json: {
      trip_id: "trip_demo_001",
      mode: "OFFSHORE"
    },
    prev_hash: "demo_hash_001",
    event_hash: "demo_hash_002",
    signature: "development-demo"
  },
  {
    event_id: "evt_demo_gear_set_001",
    tenant_id: "demoTenant",
    subject_type: "ORG",
    subject_id: "trip_demo_001",
    actor_id: "crew_1",
    device_id: "mobile_crew_1_abcd1234",
    ts_device: "2026-07-06T14:10:00.000Z",
    ts_server: "2026-07-06T14:10:03.000Z",
    event_type: "GEAR_SET",
    schema_version: 1,
    payload_json: {
      trip_id: "trip_demo_001",
      mode: "OFFSHORE",
      gear_id: "STR-021",
      position: { lat: 55.49, lon: -165.21 }
    },
    prev_hash: "demo_hash_002",
    event_hash: "demo_hash_003",
    signature: "development-demo"
  },
  {
    event_id: "evt_demo_hazard_reported_001",
    tenant_id: "demoTenant",
    subject_type: "ORG",
    subject_id: "trip_demo_001",
    actor_id: "crew_1",
    device_id: "mobile_crew_1_abcd1234",
    ts_device: "2026-07-06T18:18:00.000Z",
    ts_server: "2026-07-06T18:18:05.000Z",
    event_type: "HAZARD_REPORTED",
    schema_version: 1,
    payload_json: {
      trip_id: "trip_demo_001",
      hazard_id: "hz_demo_weather_001",
      hazard_type: "WEATHER",
      severity: 3,
      confidence: 0.82,
      sharing_scope: "ORG",
      location: { lat: 55.52, lon: -165.18 }
    },
    prev_hash: "demo_hash_003",
    event_hash: "demo_hash_004",
    signature: "development-demo"
  },
  {
    event_id: "evt_demo_compliance_001",
    tenant_id: "demoTenant",
    subject_type: "ORG",
    subject_id: "trip_demo_001",
    actor_id: "captain_001",
    device_id: "bridge_tablet_001",
    ts_device: "2026-07-06T18:30:00.000Z",
    ts_server: "2026-07-06T18:30:04.000Z",
    event_type: "COMPLIANCE_VALIDATION_RAN",
    schema_version: 1,
    payload_json: {
      trip_id: "trip_demo_001",
      completion_meter: 72,
      issues: [{ code: "DEMO_CLOSEOUT_REVIEW", severity: "error", message: "Demo closeout issue requires review." }]
    },
    prev_hash: "demo_hash_004",
    event_hash: "demo_hash_005",
    signature: "development-demo"
  }
];

export function demoDashboard() {
  const activeTrips = demoTrips.filter((trip) => trip.status === "ACTIVE").length;
  const missingGear = demoGear.filter((gear) => String(gear.status) === "MISSING").length;

  return {
    active_trips: activeTrips,
    missing_gear: missingGear,
    total_gear: demoGear.length,
    compliance_issues_open: demoTrips.reduce((sum, trip) => sum + trip.compliance_open_issues, 0),
    hazard_count: demoHazards.length,
    risk_distribution: {
      LOW: demoTrips.filter((trip) => trip.latest_risk_tier === "LOW").length,
      MODERATE: demoTrips.filter((trip) => trip.latest_risk_tier === "MODERATE").length,
      HIGH: demoTrips.filter((trip) => String(trip.latest_risk_tier) === "HIGH").length,
      CRITICAL: demoTrips.filter((trip) => String(trip.latest_risk_tier) === "CRITICAL").length
    },
    compliance_status: {
      signed: demoTrips.filter((trip) => trip.compliance_open_issues === 0).length,
      pending: demoTrips.filter((trip) => trip.compliance_open_issues > 0).length
    },
    gear_health_score: demoGear.length > 0 ? Math.round(((demoGear.length - missingGear) / demoGear.length) * 100) : 100,
    last_updated: new Date().toISOString(),
    source: "development_fallback"
  };
}
