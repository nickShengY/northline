const base = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";

const authHeader = {
  Authorization: `Bearer ${import.meta.env.VITE_DEV_TOKEN ?? "demoTenant:captain_01:CAPTAIN"}`,
  "Content-Type": "application/json"
};

export interface RiskScoreResult {
  score: number;
  tier: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  rationale: string[];
  mitigations: string[];
}

export async function scoreOffshoreRisk(input: {
  workloadIntensity: number;
  weatherSeverity: number;
  nearMissCount: number;
  daylightHoursLeft: number;
}): Promise<RiskScoreResult> {
  const res = await fetch(`${base}/v1/safety/risk/score`, {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify({ mode: "OFFSHORE", ...input })
  });
  if (!res.ok) throw new Error("Failed to score risk");
  return (await res.json()) as RiskScoreResult;
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
  if (!res.ok) throw new Error("Failed gear transition");
  return res.json();
}

export async function getTripGear(tripId: string) {
  const res = await fetch(`${base}/v1/gear/trip/${tripId}?mode=OFFSHORE`, {
    headers: { Authorization: authHeader.Authorization }
  });
  if (!res.ok) throw new Error("Failed to load trip gear");
  return res.json();
}

export async function performSweepCheck(input: {
  trip_id: string;
  outstanding_gear_ids: string[];
}) {
  const res = await fetch(`${base}/v1/gear/sweep-check`, {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify({ mode: "OFFSHORE", ...input })
  });
  if (!res.ok) throw new Error("Failed sweep check");
  return res.json();
}

export async function getTripState(tripId: string) {
  const res = await fetch(`${base}/v1/ops/trip/${tripId}/state`, {
    headers: { Authorization: authHeader.Authorization }
  });
  if (!res.ok) throw new Error("Failed to load trip state");
  return res.json();
}

export async function getComplianceSummary(tripId: string) {
  const res = await fetch(`${base}/v1/ops/trip/${tripId}/compliance/summary`, {
    headers: { Authorization: authHeader.Authorization }
  });
  if (!res.ok) throw new Error("Failed to load compliance summary");
  return res.json();
}

export async function signCompliance(tripId: string, pkgId?: string) {
  const res = await fetch(`${base}/v1/ops/trip/${tripId}/compliance/sign`, {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify(pkgId ? { pkg_id: pkgId } : {})
  });
  if (!res.ok) throw new Error("Failed to sign compliance");
  return res.json();
}

export async function reportIncident(input: {
  case_id: string;
  trip_id: string;
  category: "MOB" | "INJURY" | "EQUIPMENT" | "NEAR_MISS" | "EXPOSURE";
  severity: number;
  summary: string;
  action_taken?: string;
}) {
  const res = await fetch(`${base}/v1/safety/incident`, {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify(input)
  });
  if (!res.ok) throw new Error("Failed to report incident");
  return res.json();
}

export async function getOpenIncidents() {
  const res = await fetch(`${base}/v1/safety/incidents/open`, {
    headers: { Authorization: authHeader.Authorization }
  });
  if (!res.ok) throw new Error("Failed to load incidents");
  return res.json();
}

export async function getEffectiveRules(mode: "OFFSHORE" | "ICE", region?: string) {
  const query = region ? `?mode=${mode}&region=${region}` : `?mode=${mode}`;
  const res = await fetch(`${base}/v1/rules/effective${query}`, {
    headers: { Authorization: authHeader.Authorization }
  });
  if (!res.ok) throw new Error("Failed to load rules");
  return res.json();
}

export async function uploadEvents(events: unknown[]) {
  const res = await fetch(`${base}/v1/sync/upload`, {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify({ events })
  });
  if (!res.ok) throw new Error("Failed to upload events");
  return res.json();
}

export async function downloadEvents(cursor?: string) {
  const query = cursor ? `?cursor=${cursor}` : "";
  const res = await fetch(`${base}/v1/sync/download${query}`, {
    headers: { Authorization: authHeader.Authorization }
  });
  if (!res.ok) throw new Error("Failed to download events");
  return res.json();
}
