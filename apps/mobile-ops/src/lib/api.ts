const base = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";

function getRuntimeToken() {
  if (typeof window === "undefined") return undefined;
  return window.sessionStorage.getItem("northline.apiToken") ?? window.localStorage.getItem("northline.apiToken") ?? undefined;
}

export function getAuthToken() {
  const token = import.meta.env.DEV
    ? import.meta.env.VITE_API_TOKEN ?? import.meta.env.VITE_DEV_TOKEN
    : getRuntimeToken();
  if (!token && import.meta.env.DEV) return "demoTenant:crew_1:CREW";
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

async function parseJson<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status})`);
  }
  return (await response.json()) as T;
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
  trip_id: string;
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

export async function getTripGear(tripId: string) {
  const res = await fetch(`${base}/v1/gear/trip/${tripId}?mode=OFFSHORE`, {
    headers: { Authorization: authHeader.Authorization }
  });
  return parseJson<{ gear: GearRow[] }>(res, "Gear list");
}

export async function transitionGear(input: {
  trip_id: string;
  gear_id: string;
  transition: "SET" | "CHECKED" | "HAULED" | "MISSING" | "RECOVERED" | "REMOVED";
  note?: string;
}) {
  const res = await fetch(`${base}/v1/gear/transition`, {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify({ mode: "OFFSHORE", ...input })
  });
  return parseJson(res, "Gear transition");
}

export async function uploadEvents(events: unknown[]) {
  const res = await fetch(`${base}/v1/sync/upload`, {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify({ events })
  });
  return parseJson<{ accepted?: string[]; accepted_count?: number; rejected: string[] }>(res, "Event upload");
}
