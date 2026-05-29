const base = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";

function getRuntimeToken() {
  if (typeof window === "undefined") return undefined;
  return window.sessionStorage.getItem("northline.apiToken") ?? window.localStorage.getItem("northline.apiToken") ?? undefined;
}

function getAuthToken() {
  const token = import.meta.env.DEV
    ? import.meta.env.VITE_API_TOKEN ?? import.meta.env.VITE_DEV_TOKEN
    : getRuntimeToken();
  if (!token && import.meta.env.DEV) return "demoTenant:captain_001:CAPTAIN";
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

export async function listTrips() {
  const response = await fetch(`${base}/v1/ops/trips`, {
    headers: { Authorization: authHeader.Authorization }
  });
  return parseJson<{ trips: Array<{ trip_id: string; status: string; mode: string }> }>(response, "Trip list");
}

export async function getTripGear(tripId: string) {
  const response = await fetch(`${base}/v1/gear/trip/${tripId}?mode=OFFSHORE`, {
    headers: { Authorization: authHeader.Authorization }
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
}) {
  const response = await fetch(`${base}/v1/gear/transition`, {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify({ mode: "OFFSHORE", ...input })
  });
  return parseJson(response, "Gear transition");
}

export async function listDevices() {
  const response = await fetch(`${base}/v1/sync/devices`, {
    headers: { Authorization: authHeader.Authorization }
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
    headers: { Authorization: authHeader.Authorization }
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
    body: JSON.stringify(input)
  });
  return parseJson(response, "Hazard report");
}
