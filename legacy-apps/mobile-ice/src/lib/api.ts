const base = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";

const authHeader = {
  Authorization: `Bearer ${import.meta.env.VITE_DEV_TOKEN ?? "demoTenant:guide_01:GUIDE"}`,
  "Content-Type": "application/json"
};

export async function scoreIceRisk(input: {
  workloadIntensity: number;
  weatherSeverity: number;
  nearMissCount: number;
  daylightHoursLeft: number;
  soloOperator: boolean;
  checkinMisses: number;
}) {
  const res = await fetch(`${base}/v1/safety/risk/score`, {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify({ mode: "ICE", ...input })
  });
  if (!res.ok) throw new Error("Risk request failed");
  return res.json();
}

export async function recommendIceTraining(input: {
  missed_checkins: number;
  overdue_gear_checks: number;
  near_miss_count: number;
  compliance_errors: number;
}) {
  const res = await fetch(`${base}/v1/training/recommend`, {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify({ mode: "ICE", ...input })
  });
  if (!res.ok) throw new Error("Training recommendation failed");
  return res.json();
}

export async function scheduleCheckin(input: { checkin_id: string; trip_id: string; due_at: string }) {
  const res = await fetch(`${base}/v1/safety/checkin/schedule`, {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify(input)
  });
  if (!res.ok) throw new Error("Check-in scheduling failed");
  return res.json();
}

export async function completeCheckin(input: {
  checkin_id: string;
  trip_id: string;
  location?: { lat: number; lon: number };
}) {
  const res = await fetch(`${base}/v1/safety/checkin/complete`, {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify(input)
  });
  if (!res.ok) throw new Error("Check-in completion failed");
  return res.json();
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
  if (!res.ok) throw new Error("Hazard report failed");
  return res.json();
}

export async function listHazards(scope?: "PRIVATE" | "GROUP" | "ORG" | "DELAYED_PUBLIC" | "PUBLIC") {
  const suffix = scope ? `?scope=${scope}` : "";
  const res = await fetch(`${base}/v1/safety/hazards${suffix}`, {
    headers: { Authorization: authHeader.Authorization }
  });
  if (!res.ok) throw new Error("Hazard fetch failed");
  return res.json();
}
