import {
  readRuntimeToken,
  type AckSyncResponse,
  type DownloadEventsResponse,
  type UploadEventsResponse
} from "@northline/shared";

const base = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";

export const defaultDevToken = "demoTenant:crew_1:CREW";

function pathSegment(value: string) {
  return encodeURIComponent(value);
}

export function getAuthToken() {
  const token = import.meta.env.DEV
    ? readRuntimeToken() ?? import.meta.env.VITE_API_TOKEN ?? import.meta.env.VITE_DEV_TOKEN ?? defaultDevToken
    : readRuntimeToken();
  if (!token) {
    throw new Error("Missing API token. Sign in before using the Northline API.");
  }
  return token;
}

export function parseDevToken(token = getAuthToken()) {
  const [tenantId = "", actorId = "", role = "CREW"] = token.split(":");
  return { tenantId, actorId, role };
}

const authHeader = {
  get Authorization() {
    return `Bearer ${getAuthToken()}`;
  },
  "Content-Type": "application/json"
};

type Mode = "OFFSHORE" | "ICE";
type RiskTier = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

export interface RiskScoreResult {
  score: number;
  tier: RiskTier;
  rationale: string[];
  mitigations: string[];
}

export interface HazardRow {
  hazard_id: string;
  type: string;
  confidence: number;
  sharing_scope: string;
}

export interface TrainingRecommendation {
  module_id: string;
  title: string;
}

export interface GearRow {
  gear_id: string;
  status: string;
}

export interface TripRow {
  trip_id: string;
  status: string;
  mode: Mode;
}

export interface SessionResponse {
  tenant_id: string;
  actor_id: string;
  role: string;
  capabilities: string[];
  issued_at: string;
}

async function parseJson<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function getSession() {
  const res = await fetch(`${base}/v1/auth/session`, {
    headers: { Authorization: authHeader.Authorization }
  });
  return parseJson<SessionResponse>(res, "Session");
}

export async function getAuthConfig() {
  const res = await fetch(`${base}/v1/auth/config`);
  return parseJson<{
    enabled: boolean;
    login_url: string | null;
    client_id?: string | null;
    scopes?: string | null;
  }>(res, "Auth configuration");
}

export async function scoreRisk(mode: Mode, input: {
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
    body: JSON.stringify({ mode, ...input })
  });
  return parseJson<RiskScoreResult>(res, "Risk score");
}

export async function listTrips() {
  const res = await fetch(`${base}/v1/ops/trips`, {
    headers: { Authorization: authHeader.Authorization }
  });
  return parseJson<{ trips: TripRow[] }>(res, "Trip list");
}

export async function recommendTraining(mode: Mode, input: {
  missed_checkins: number;
  overdue_gear_checks: number;
  near_miss_count: number;
  compliance_errors: number;
}) {
  const res = await fetch(`${base}/v1/training/recommend`, {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify({ mode, ...input })
  });
  return parseJson<{ recommended: TrainingRecommendation[] }>(res, "Training recommendation");
}

export async function scheduleCheckin(input: { checkin_id: string; trip_id: string; due_at: string }) {
  const res = await fetch(`${base}/v1/safety/checkin/schedule`, {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify(input)
  });
  return parseJson(res, "Check-in schedule");
}

export async function completeCheckin(input: { checkin_id: string; trip_id: string; location?: { lat: number; lon: number } }) {
  const res = await fetch(`${base}/v1/safety/checkin/complete`, {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify(input)
  });
  return parseJson(res, "Check-in complete");
}

export async function reportHazard(input: {
  hazard_id: string;
  trip_id?: string;
  hazard_type: "CRACK" | "SLUSH" | "RIDGE" | "OPEN_WATER" | "WEATHER" | "GEAR_RISK";
  severity: number;
  confidence: number;
  sharing_scope: "PRIVATE" | "GROUP" | "ORG" | "DELAYED_PUBLIC" | "PUBLIC";
  location: { lat: number; lon: number };
}) {
  const res = await fetch(`${base}/v1/safety/hazard/report`, {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify(input)
  });
  return parseJson(res, "Hazard report");
}

export async function listHazards(scope?: "PRIVATE" | "GROUP" | "ORG" | "DELAYED_PUBLIC" | "PUBLIC") {
  const query = scope ? `?scope=${scope}` : "";
  const res = await fetch(`${base}/v1/safety/hazards${query}`, {
    headers: { Authorization: authHeader.Authorization }
  });
  return parseJson<{ hazards: HazardRow[] }>(res, "Hazard list");
}

export async function getTripGear(tripId: string, mode: Mode = "OFFSHORE") {
  const res = await fetch(`${base}/v1/gear/trip/${pathSegment(tripId)}?mode=${mode}`, {
    headers: { Authorization: authHeader.Authorization }
  });
  return parseJson<{ gear: GearRow[] }>(res, "Gear list");
}

export async function transitionGear(input: {
  trip_id: string;
  gear_id: string;
  transition: "SET" | "CHECKED" | "HAULED" | "MISSING" | "RECOVERED" | "REMOVED";
  note?: string;
  mode?: Mode;
}) {
  const res = await fetch(`${base}/v1/gear/transition`, {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify({ mode: "OFFSHORE", ...input })
  });
  return parseJson(res, "Gear transition");
}

export async function registerCurrentDevice(input: { device_id: string; public_key: string; key_version?: number }) {
  const res = await fetch(`${base}/v1/sync/device/register-self`, {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify({
      key_version: 1,
      ...input
    })
  });
  return parseJson<{ ok: boolean; device_id: string; emitted_event_id?: string }>(res, "Device registration");
}

export async function uploadEvents(events: unknown[], cursor?: string | null) {
  const res = await fetch(`${base}/v1/sync/upload`, {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify({ events, ...(cursor ? { cursor } : {}) })
  });
  return parseJson<UploadEventsResponse>(res, "Event upload");
}

export async function downloadEvents(cursor?: string | null, limit = 1000) {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  params.set("limit", String(limit));

  const res = await fetch(`${base}/v1/sync/download?${params.toString()}`, {
    headers: { Authorization: authHeader.Authorization }
  });
  return parseJson<DownloadEventsResponse>(res, "Event download");
}

export async function ackSyncCursor(cursor: string) {
  const res = await fetch(`${base}/v1/sync/ack`, {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify({ cursor })
  });
  return parseJson<AckSyncResponse>(res, "Sync ack");
}
