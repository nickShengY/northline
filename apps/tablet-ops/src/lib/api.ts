import { readRuntimeToken } from "@northline/shared";

const base = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";

export const defaultDevToken = "demoTenant:captain_001:CAPTAIN";

function pathSegment(value: string) {
  return encodeURIComponent(value);
}

/**
 * Abort hung requests so the UI can never be stuck in a permanent SYNCING state.
 */
const REQUEST_TIMEOUT_MS = 15000;

function requestTimeoutSignal(): AbortSignal | undefined {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  }
  return undefined;
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

async function parseJson<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function getSession() {
  const response = await fetch(`${base}/v1/auth/session`, {
    headers: { Authorization: authHeader.Authorization },
    signal: requestTimeoutSignal()
  });
  return parseJson<{
    tenant_id: string;
    actor_id: string;
    role: string;
    capabilities: string[];
    issued_at: string;
  }>(response, "Session");
}

export async function getAuthConfig() {
  const response = await fetch(`${base}/v1/auth/config`, {
    signal: requestTimeoutSignal()
  });
  return parseJson<{
    enabled: boolean;
    login_url: string | null;
    client_id?: string | null;
    scopes?: string | null;
  }>(response, "Auth configuration");
}

export async function listTrips() {
  const response = await fetch(`${base}/v1/ops/trips`, {
    headers: { Authorization: authHeader.Authorization },
    signal: requestTimeoutSignal()
  });
  return parseJson<{ trips: Array<{ trip_id: string; status: string; mode: string }> }>(response, "Trip list");
}

export async function getTripGear(tripId: string, mode: "OFFSHORE" | "ICE" = "OFFSHORE") {
  const response = await fetch(`${base}/v1/gear/trip/${pathSegment(tripId)}?mode=${mode}`, {
    headers: { Authorization: authHeader.Authorization },
    signal: requestTimeoutSignal()
  });
  return parseJson<{
    gear: Array<{
      gear_id: string;
      status: "SET" | "CHECKED" | "HAULED" | "MISSING" | "RECOVERED" | "REMOVED";
      updated_at: string;
      last_position?: { lat?: number; lon?: number };
    }>;
  }>(response, "Gear list");
}

export async function transitionTripGear(input: {
  trip_id: string;
  gear_id: string;
  transition: "SET" | "CHECKED" | "HAULED" | "MISSING" | "RECOVERED" | "REMOVED";
  note?: string;
  mode?: "OFFSHORE" | "ICE";
}) {
  const response = await fetch(`${base}/v1/gear/transition`, {
    method: "POST",
    headers: authHeader,
    signal: requestTimeoutSignal(),
    body: JSON.stringify({ ...input, mode: input.mode ?? "OFFSHORE" })
  });
  return parseJson(response, "Gear transition");
}

export async function listDevices() {
  const response = await fetch(`${base}/v1/sync/devices`, {
    headers: { Authorization: authHeader.Authorization },
    signal: requestTimeoutSignal()
  });
  return parseJson<{
    devices: Array<{
      device_id: string;
      subject_type: string;
      subject_id: string;
      revoked: boolean;
      last_seen_at?: string;
      created_at?: string;
    }>;
  }>(response, "Device list");
}

export async function getOpenIncidents() {
  const response = await fetch(`${base}/v1/safety/incidents/open`, {
    headers: { Authorization: authHeader.Authorization },
    signal: requestTimeoutSignal()
  });
  return parseJson<{
    incidents: Array<{
      case_id: string;
      category: string;
      severity: number;
      summary: string;
      opened_at: string;
      status: string;
    }>;
  }>(response, "Open incidents");
}

export async function scoreRisk(input: {
  mode: "OFFSHORE" | "ICE";
  workloadIntensity: number;
  weatherSeverity: number;
  nearMissCount: number;
  daylightHoursLeft: number;
}) {
  const response = await fetch(`${base}/v1/safety/risk/score`, {
    method: "POST",
    headers: authHeader,
    signal: requestTimeoutSignal(),
    body: JSON.stringify(input)
  });
  return parseJson<{ score: number; tier: "LOW" | "MODERATE" | "HIGH" | "CRITICAL" }>(response, "Risk score");
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
  const response = await fetch(`${base}/v1/safety/hazard/report`, {
    method: "POST",
    headers: authHeader,
    signal: requestTimeoutSignal(),
    body: JSON.stringify(input)
  });
  return parseJson(response, "Hazard report");
}
