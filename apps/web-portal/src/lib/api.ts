import { readRuntimeToken } from "@northline/shared";

const base = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";

export const defaultDevToken = "demoTenant:portal_admin:ORG_ADMIN";

function pathSegment(value: string) {
  return encodeURIComponent(value);
}

function queryString(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

function boundedInteger(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function getAuthToken() {
  const token = import.meta.env.DEV
    ? readRuntimeToken() ?? import.meta.env.VITE_API_TOKEN ?? import.meta.env.VITE_DEV_TOKEN ?? defaultDevToken
    : readRuntimeToken();
  if (!token) {
    throw new Error("Missing API token. Sign in before using the Northline API.");
  }
  return token;
}

const authHeader = {
  get Authorization() {
    return `Bearer ${getAuthToken()}`;
  },
  "Content-Type": "application/json"
};

export async function getSession() {
  const res = await fetch(`${base}/v1/auth/session`, {
    headers: { Authorization: authHeader.Authorization }
  });
  if (!res.ok) throw new Error("Session unavailable");
  return res.json();
}

export async function getAuthConfig() {
  const res = await fetch(`${base}/v1/auth/config`);
  if (!res.ok) throw new Error("Auth configuration unavailable");
  return res.json();
}

export async function getDashboard() {
  const res = await fetch(`${base}/v1/ops/dashboard`, { headers: authHeader });
  if (!res.ok) throw new Error("Failed to load dashboard");
  return res.json();
}

export async function getTripState(tripId: string) {
  const res = await fetch(`${base}/v1/ops/trip/${pathSegment(tripId)}/state`, { headers: authHeader });
  if (!res.ok) throw new Error("Failed to load trip state");
  return res.json();
}

export async function verifyCertificate(certificateId: string) {
  const res = await fetch(`${base}/v1/trace/certificate/${pathSegment(certificateId)}/verify`, { headers: authHeader });
  if (!res.ok) throw new Error("Certificate not found");
  return res.json();
}

export async function scoreRisk(input: {
  mode: "OFFSHORE" | "ICE";
  workloadIntensity: number;
  weatherSeverity: number;
  nearMissCount: number;
  daylightHoursLeft: number;
  soloOperator?: boolean;
  checkinMisses?: number;
}) {
  const res = await fetch(`${base}/v1/safety/risk/score`, {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify(input)
  });
  if (!res.ok) throw new Error("Risk score failed");
  return res.json();
}

export async function getOpenIncidents() {
  const res = await fetch(`${base}/v1/safety/incidents/open`, {
    headers: { Authorization: authHeader.Authorization }
  });
  if (!res.ok) throw new Error("Incident feed unavailable");
  return res.json();
}

export async function createLot(input: {
  lot_id: string;
  trip_id: string;
  mode: "OFFSHORE" | "ICE";
  species_totals: Record<string, number>;
}) {
  const res = await fetch(`${base}/v1/trace/lot/create`, {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify(input)
  });
  if (!res.ok) throw new Error("Lot creation failed");
  return res.json();
}

export async function listLots() {
  const res = await fetch(`${base}/v1/trace/lots`, {
    headers: { Authorization: authHeader.Authorization }
  });
  if (!res.ok) throw new Error("Lot listing failed");
  return res.json();
}

export async function signCompliance(tripId: string, pkgId: string) {
  const res = await fetch(`${base}/v1/ops/trip/${pathSegment(tripId)}/compliance/sign`, {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify({ pkg_id: pkgId })
  });
  if (!res.ok) throw new Error("Compliance sign-off failed");
  return res.json();
}

export async function generateComplianceExport(tripId: string) {
  const res = await fetch(`${base}/v1/export/compliance-package`, {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify({ trip_id: tripId, format: "JSON" })
  });
  if (!res.ok) throw new Error("Compliance export failed");
  return res.json();
}

export async function listTrips() {
  const res = await fetch(`${base}/v1/ops/trips`, {
    headers: { Authorization: authHeader.Authorization }
  });
  if (!res.ok) throw new Error("Trip listing failed");
  return res.json();
}

export async function getTripTimeline(tripId: string, limit = 100) {
  const query = queryString({ limit: boundedInteger(limit, 1, 5000) });
  const res = await fetch(`${base}/v1/ops/trip/${pathSegment(tripId)}/timeline${query}`, {
    headers: { Authorization: authHeader.Authorization }
  });
  if (!res.ok) throw new Error("Trip timeline failed");
  return res.json();
}

export async function listIntegrations(type?: string) {
  const query = queryString({ type });
  const res = await fetch(`${base}/v1/integrations/status${query}`, {
    headers: { Authorization: authHeader.Authorization }
  });
  if (!res.ok) throw new Error("Integration listing failed");
  return res.json();
}

export async function upsertIntegration(input: {
  integration_id: string;
  integration_type: string;
  provider: string;
  enabled: boolean;
  config_json: Record<string, unknown>;
}) {
  const res = await fetch(`${base}/v1/integrations/configs/upsert`, {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify(input)
  });
  if (!res.ok) throw new Error("Integration upsert failed");
  return res.json();
}

export async function testIntegration(integrationId: string) {
  const res = await fetch(`${base}/v1/integrations/configs/${pathSegment(integrationId)}/test`, {
    method: "POST",
    headers: authHeader
  });
  if (!res.ok) throw new Error("Integration test failed");
  return res.json();
}

export async function listRulesets(mode?: string) {
  const query = queryString({ mode });
  const res = await fetch(`${base}/v1/rules/all${query}`, {
    headers: { Authorization: authHeader.Authorization }
  });
  if (!res.ok) throw new Error("Ruleset listing failed");
  return res.json();
}

export async function upsertRuleset(input: {
  ruleset_id: string;
  mode: "OFFSHORE" | "ICE";
  region_code: string;
  effective_from: string;
  effective_to?: string;
  priority: number;
  rules_json: Record<string, unknown>;
}) {
  const res = await fetch(`${base}/v1/rules/upsert`, {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify(input)
  });
  if (!res.ok) throw new Error("Ruleset upsert failed");
  return res.json();
}

export async function listDevices() {
  const res = await fetch(`${base}/v1/sync/devices`, {
    headers: { Authorization: authHeader.Authorization }
  });
  if (!res.ok) throw new Error("Device listing failed");
  return res.json();
}

export async function registerDevice(input: {
  device_id: string;
  subject_type: "VESSEL" | "USER" | "GROUP" | "ORG";
  subject_id: string;
  public_key: string;
  key_version?: number;
}) {
  const res = await fetch(`${base}/v1/sync/device/register`, {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify(input)
  });
  if (!res.ok) throw new Error("Device registration failed");
  return res.json();
}

export async function revokeDevice(deviceId: string) {
  const res = await fetch(`${base}/v1/sync/device/revoke/${pathSegment(deviceId)}`, {
    method: "POST",
    headers: authHeader
  });
  if (!res.ok) throw new Error("Device revocation failed");
  return res.json();
}

export async function getSyncMetrics(hours = 24) {
  const query = queryString({ hours: boundedInteger(hours, 1, 168) });
  const res = await fetch(`${base}/v1/sync/metrics/summary${query}`, {
    headers: { Authorization: authHeader.Authorization }
  });
  if (!res.ok) throw new Error("Sync metrics failed");
  return res.json();
}

// Gear API endpoints
export async function getGearForTrip(tripId: string, mode?: "OFFSHORE" | "ICE") {
  const query = queryString({ mode });
  const res = await fetch(`${base}/v1/gear/trip/${pathSegment(tripId)}${query}`, {
    headers: { Authorization: authHeader.Authorization }
  });
  if (!res.ok) throw new Error("Gear data unavailable");
  return res.json();
}

// Hazards API endpoint
export async function getHazards(scope?: string) {
  const query = queryString({ scope });
  const res = await fetch(`${base}/v1/safety/hazards${query}`, {
    headers: { Authorization: authHeader.Authorization }
  });
  if (!res.ok) throw new Error("Hazards data unavailable");
  return res.json();
}

// Export API endpoint for historical data
export async function getHistoricalMetrics(metricType: string, days = 30) {
  const query = queryString({ hours: boundedInteger(days * 24, 1, 168) });
  const res = await fetch(`${base}/v1/sync/metrics/summary${query}`, {
    headers: { Authorization: authHeader.Authorization }
  });
  if (!res.ok) throw new Error("Historical metrics failed");
  return res.json();
}

export async function listAuditEvents(limit = 25) {
  const query = queryString({ limit: boundedInteger(limit, 1, 500) });
  const res = await fetch(`${base}/v1/audit/events${query}`, {
    headers: { Authorization: authHeader.Authorization }
  });
  if (!res.ok) throw new Error("Audit event listing failed");
  return res.json();
}

// Export response types for hooks
export interface GearForTripResponse {
  trip_id: string;
  mode: string;
  gear: Array<{
    gear_id: string;
    trip_id: string;
    status: string;
    buoy_label?: string;
    station_id?: string;
    pot_count?: number;
    last_position?: { lat?: number; lon?: number };
    updated_at: string;
  }>;
}

export interface HazardsResponse {
  hazards: Array<{
    hazard_id: string;
    type: string;
    severity: number;
    confidence: number;
    location?: { lat?: number; lon?: number };
    sharing_scope: string;
    confirmed_count: number;
    ts_last_update: string;
  }>;
}

export interface DevicesResponse {
  devices: Array<{
    device_id: string;
    subject_type: string;
    subject_id: string;
    key_version: number;
    revoked: boolean;
    last_seen_at: string;
    created_at: string;
  }>;
}

export interface SyncMetricsResponse {
  tenant_id: string;
  window_hours: number;
  metrics: Array<{
    metric_name: string;
    avg_value: number;
    max_value: number;
    min_value: number;
    samples: number;
    latest_at: string;
  }>;
}

export interface TripsResponse {
  trips: Array<{
    trip_id: string;
    tenant_id: string;
    mode: string;
    owner_id: string;
    status: string;
    started_at: string;
    ended_at: string;
    location_name: string;
    completion_meter: number;
    compliance_open_issues: number;
    latest_risk_tier: string;
    updated_at: string;
  }>;
}

export interface TripStateResponse {
  trip: {
    trip_id: string;
    status: string;
    mode: string;
    owner_id: string;
  } | null;
  gear: Array<{
    gear_id: string;
    status: string;
    last_position?: { lat?: number; lon?: number };
    updated_at: string;
  }>;
  hazards: Record<string, unknown>;
  compliance: {
    completion_meter: number;
    issues: Array<{ code: string; severity: string; message: string }>;
    errors: Array<{ code: string; message: string }>;
    warnings: Array<{ code: string; message: string }>;
  };
}

export interface OpenIncidentsResponse {
  incidents: Array<{
    case_id: string;
    trip_id: string;
    category: string;
    severity: number;
    status: string;
    summary: string;
    opened_by: string;
    opened_at: string;
  }>;
}

export interface AuditEventsResponse {
  events: Array<{
    audit_id: string;
    tenant_id: string;
    actor_id: string;
    actor_role: string;
    action: string;
    subject_type: string;
    subject_id: string;
    outcome: string;
    request_id?: string;
    metadata_json?: Record<string, unknown>;
    created_at: string;
  }>;
}
