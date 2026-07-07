import { Hono } from "hono";
import type { Context } from "hono";
import { withTenant } from "../lib/db";
import { demoTrips, shouldUseDevelopmentDataFallback } from "../lib/dev-fallback";
import type { AuthContext, Env } from "../types";

type AisAppContext = { Bindings: Env; Variables: { auth: AuthContext } };

// Authentication (including websocket token extraction) is enforced by the
// shared /v1/* auth middleware in src/index.ts; no extra layer is needed here.
const app = new Hono<AisAppContext>();
const AIS_AI_MAX_BODY_BYTES = 64 * 1024;
const AIS_AI_MAX_VESSELS = 25;
const AIS_AI_MAX_OBSERVATIONS = 500;
const AIS_AI_DEFAULT_TIMEOUT_MS = 12_000;
const AIS_PROXY_TIMEOUT_MS = 8_000;

function requireAisProxyUrl(env: Env) {
  if (!env.AIS_PROXY_URL) {
    throw new Error("AIS_PROXY_URL is not configured");
  }
  return env.AIS_PROXY_URL.endsWith("/") ? env.AIS_PROXY_URL : `${env.AIS_PROXY_URL}/`;
}

function aisAiTimeoutMs(env: Env) {
  const configured = Number(env.AIS_AI_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 1_000
    ? Math.min(configured, 30_000)
    : AIS_AI_DEFAULT_TIMEOUT_MS;
}

async function readBoundedJson(c: Context<AisAppContext>) {
  const contentLength = Number(c.req.header("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > AIS_AI_MAX_BODY_BYTES) {
    return {
      ok: false as const,
      response: c.json({
        error: "payload_too_large",
        max_bytes: AIS_AI_MAX_BODY_BYTES
      }, 413)
    };
  }

  const text = await c.req.text();
  if (new TextEncoder().encode(text).byteLength > AIS_AI_MAX_BODY_BYTES) {
    return {
      ok: false as const,
      response: c.json({
        error: "payload_too_large",
        max_bytes: AIS_AI_MAX_BODY_BYTES
      }, 413)
    };
  }

  try {
    return { ok: true as const, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false as const,
      response: c.json({ error: "invalid_payload" }, 400)
    };
  }
}

async function proxyAisJson(c: Context<AisAppContext>, path: string) {
  try {
    const base = requireAisProxyUrl(c.env);
    const incomingUrl = new URL(c.req.url);
    const upstream = new URL(path.replace(/^\//, ""), base);
    upstream.search = incomingUrl.search;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AIS_PROXY_TIMEOUT_MS);

    try {
      const response = await fetch(upstream.toString(), {
        method: "GET",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" }
      });

      const text = await response.text();
      return new Response(text, {
        status: response.status,
        headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" }
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return c.json(
      {
        error: "ais_proxy_unavailable",
        message: error instanceof Error ? error.message : "AIS proxy request failed"
      },
      503
    );
  }
}

interface FallbackAisVessel {
  mmsi: string;
  name: string;
  latitude: number;
  longitude: number;
  speedOverGround: number;
  courseOverGround: number;
  heading: number;
  navigationalStatus: number;
  status: string;
  destination?: string;
  timestamp: string;
  lastUpdated: number;
}

async function loadFallbackVessels(env: Env, tenantId: string): Promise<FallbackAisVessel[]> {
  let rows: any[];
  try {
    rows = await withTenant(env, tenantId, async (sql) => {
      return sql`
        with gear_positions as (
          select trip_id,
                 avg((last_position->>'lat')::float) as latitude,
                 avg((last_position->>'lon')::float) as longitude
          from (
            select trip_id, last_position
            from gear_state_offshore
            where tenant_id = ${tenantId}
              and last_position is not null
            union all
            select trip_id, last_position
            from gear_state_ice
            where tenant_id = ${tenantId}
              and last_position is not null
          ) positions
          group by trip_id
        )
        select t.trip_id, t.mode, t.status, t.location_name, t.updated_at::text, p.latitude, p.longitude
        from trip_state t
        left join gear_positions p on p.trip_id = t.trip_id
        where t.tenant_id = ${tenantId}
        order by t.updated_at desc
        limit 100
      `;
    });
  } catch (error) {
    if (!shouldUseDevelopmentDataFallback(env, error)) throw error;
    rows = demoTrips.map((trip) => ({
      trip_id: trip.trip_id,
      mode: trip.mode,
      status: trip.status,
      location_name: trip.location_name,
      updated_at: trip.updated_at,
      latitude: trip.mode === "ICE" ? 44.42 : 55.5,
      longitude: trip.mode === "ICE" ? -79.33 : -165.2
    }));
  }

  return rows.map((row) => {
    const latitude = Number(row.latitude ?? (row.mode === "ICE" ? 44.42 : 55.5));
    const longitude = Number(row.longitude ?? (row.mode === "ICE" ? -79.33 : -165.2));
    const active = row.status === "ACTIVE";

    return {
      mmsi: `trip:${row.trip_id}`,
      name: row.location_name ? `${row.location_name} ${row.mode}` : row.trip_id,
      latitude,
      longitude,
      speedOverGround: active ? (row.mode === "OFFSHORE" ? 6.5 : 1.2) : 0,
      courseOverGround: active ? (row.mode === "OFFSHORE" ? 42 : 0) : 0,
      heading: active ? (row.mode === "OFFSHORE" ? 42 : 0) : 0,
      navigationalStatus: active ? (row.mode === "OFFSHORE" ? 7 : 0) : 5,
      status: active ? (row.mode === "OFFSHORE" ? "Engaged in fishing" : "Active ice ops") : "Stationary",
      destination: row.location_name ?? undefined,
      timestamp: row.updated_at ?? new Date().toISOString(),
      lastUpdated: new Date(row.updated_at ?? Date.now()).getTime()
    };
  });
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const earthRadiusKm = 6371;
  const dLat = toRadians(bLat - aLat);
  const dLon = toRadians(bLon - aLon);
  const lat1 = toRadians(aLat);
  const lat2 = toRadians(bLat);

  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(haversine));
}

interface RiskAssessmentResponse {
  vessel_mmsi: string;
  risk_score: number;
  risk_level: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  primary_factors: string[];
  recommendations: string[];
  confidence: number;
  analysis_timestamp: string;
}

interface RecommendationResponse {
  category: "SAFETY" | "EFFICIENCY" | "COMPLIANCE" | "OPERATIONAL";
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  title: string;
  description: string;
  action_items: string[];
  expected_outcome: string;
  time_frame: string;
  confidence: number;
}

interface CollisionPredictionResponse {
  vessel_a: { mmsi: string; name: string };
  vessel_b: { mmsi: string; name: string };
  collision_probability: number;
  time_to_closest_approach: number;
  closest_approach_distance: number;
  risk_level: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  recommended_actions: string[];
  confidence: number;
}

function toRiskLevel(score: number): "LOW" | "MODERATE" | "HIGH" | "CRITICAL" {
  if (score >= 80) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 35) return "MODERATE";
  return "LOW";
}

function distanceNm(aLat: number, aLon: number, bLat: number, bLon: number) {
  return distanceKm(aLat, aLon, bLat, bLon) * 0.539957;
}

function buildFallbackRiskAssessments(
  vessels: Array<Record<string, unknown>>,
  weather: Record<string, unknown> | undefined
): RiskAssessmentResponse[] {
  const waveHeight = Number(weather?.waveHeight ?? 0);
  const windSpeed = Number(weather?.windSpeed ?? 0);

  return vessels.map((vessel) => {
    const speed = Number(vessel.speedOverGround ?? 0);
    const vesselMmsi = String(vessel.mmsi ?? vessel.id ?? "unknown");
    const factors: string[] = [];
    let score = 10;

    if (waveHeight >= 3) {
      score += waveHeight * 10;
      factors.push(`Wave height elevated at ${waveHeight.toFixed(1)}m`);
    }

    if (windSpeed >= 25) {
      score += Math.min(25, windSpeed / 2);
      factors.push(`Wind speed elevated at ${windSpeed.toFixed(0)}km/h`);
    }

    if (speed >= 8) {
      score += 15;
      factors.push(`Transit speed is high at ${speed.toFixed(1)}kn`);
    } else if (speed <= 1) {
      score += 5;
      factors.push("Low maneuvering speed may reduce response margin");
    }

    if (factors.length === 0) {
      factors.push("Operating profile remains within baseline thresholds");
    }

    const riskLevel = toRiskLevel(score);
    return {
      vessel_mmsi: vesselMmsi,
      risk_score: Math.min(100, Math.round(score)),
      risk_level: riskLevel,
      primary_factors: factors,
      recommendations:
        riskLevel === "LOW"
          ? ["Continue normal watchstanding and monitor weather updates"]
          : ["Tighten bridge watch rotation", "Review hazard layer and collision picture"],
      confidence: 0.64,
      analysis_timestamp: new Date().toISOString()
    };
  });
}

function buildFallbackRecommendations(body: Record<string, unknown>): RecommendationResponse[] {
  const tripData = (body.tripData as Record<string, unknown> | undefined) ?? {};
  const weather = (body.weather as Record<string, unknown> | undefined) ?? {};
  const activeVesselCount = Number(tripData.activeVesselCount ?? 0);
  const waveHeight = Number(weather.waveHeight ?? 0);

  const recommendations: RecommendationResponse[] = [
    {
      category: "OPERATIONAL",
      priority: activeVesselCount >= 3 ? "HIGH" : "MEDIUM",
      title: "Reconfirm active fleet picture",
      description: `Track ${activeVesselCount || 0} active vessel(s) against current trip and sync state.`,
      action_items: ["Refresh fleet map", "Check open incidents", "Verify latest sync metrics"],
      expected_outcome: "Improved operational awareness across active trips",
      time_frame: "Next 15 minutes",
      confidence: 0.61
    }
  ];

  if (waveHeight >= 2.5) {
    recommendations.unshift({
      category: "SAFETY",
      priority: waveHeight >= 4 ? "URGENT" : "HIGH",
      title: "Review weather exposure controls",
      description: `Wave state is elevated at ${waveHeight.toFixed(1)}m.`,
      action_items: ["Delay non-essential deck work", "Reconfirm PPE and comms readiness"],
      expected_outcome: "Lower weather-driven exposure during active operations",
      time_frame: "Immediate",
      confidence: 0.72
    });
  }

  return recommendations;
}

function buildFallbackCollisionPrediction(
  vesselA: Record<string, unknown>,
  vesselB: Record<string, unknown>
): CollisionPredictionResponse {
  const latA = Number(vesselA.latitude ?? 0);
  const lonA = Number(vesselA.longitude ?? 0);
  const latB = Number(vesselB.latitude ?? 0);
  const lonB = Number(vesselB.longitude ?? 0);
  const speedA = Number(vesselA.speedOverGround ?? 0);
  const speedB = Number(vesselB.speedOverGround ?? 0);

  const rawDistance = distanceNm(latA, lonA, latB, lonB);
  const relativeSpeed = Math.max(0.5, Math.abs(speedA - speedB) + 0.5);
  const closestApproachDistance = Number(Math.min(rawDistance, 99.9).toFixed(2));
  const timeToClosestApproach = rawDistance > 25 ? Math.min(720, Math.round((rawDistance / relativeSpeed) * 60)) : Math.max(0, Math.round((rawDistance / relativeSpeed) * 60));
  const collisionProbability = rawDistance > 25 ? 0.01 : Math.max(0, Math.min(1, 1 - rawDistance / 10));
  const riskLevel = rawDistance < 1 ? "CRITICAL" : rawDistance < 3 ? "HIGH" : rawDistance < 6 ? "MODERATE" : "LOW";

  return {
    vessel_a: {
      mmsi: String(vesselA.mmsi ?? "unknown"),
      name: String(vesselA.name ?? vesselA.mmsi ?? "Vessel A")
    },
    vessel_b: {
      mmsi: String(vesselB.mmsi ?? "unknown"),
      name: String(vesselB.name ?? vesselB.mmsi ?? "Vessel B")
    },
    collision_probability: Number(collisionProbability.toFixed(2)),
    time_to_closest_approach: timeToClosestApproach,
    closest_approach_distance: Number(closestApproachDistance.toFixed(2)),
    risk_level: riskLevel,
    recommended_actions:
      riskLevel === "LOW"
        ? ["Maintain current traffic watch"]
        : ["Review CPA/TCPA on the bridge", "Confirm VHF contact plan and maneuver room"],
    confidence: 0.58
  };
}

async function callOpenRouterAI<T>(
  messages: Array<{ role: string; content: string }>,
  schema: Record<string, unknown>,
  apiKey: string,
  preferredModel?: string,
  temperature = 0.1,
  timeoutMs = AIS_AI_DEFAULT_TIMEOUT_MS
): Promise<T> {
  const modelHierarchy = [
    preferredModel || "openrouter/aurora-alpha",
    "stepfun/step-3.5-flash:free",
    "anthropic/claude-opus-4.5",
    "openai/gpt-oss-safeguard-20b:nitro"
  ];

  let lastError: Error | null = null;

  for (const model of modelHierarchy) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://northline-fishing.com",
          "X-Title": "Northline Fleet AI Analysis"
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: 2000,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: (schema.name as string) || "response",
              strict: true,
              schema
            }
          }
        })
      });

      if (!response.ok) {
        throw new Error(
          `OpenRouter error (${response.status} ${response.statusText}): ${await response.text()}`
        );
      }

      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error(`No content returned by model ${model}`);
      }

      return JSON.parse(content) as T;
    } catch (error) {
      lastError = error as Error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error("All OpenRouter models failed");
}

app.get("/vessels", async (c) => {
  const auth = c.get("auth");
  if (c.env.AIS_PROXY_URL) {
    const proxied = await proxyAisJson(c, "/api/vessels");
    if (proxied.status !== 503) return proxied;
  }

  const vessels = await loadFallbackVessels(c.env, auth.tenantId);
  return c.json({ vessels, source: "db_fallback" });
});

app.get("/nearby", async (c) => {
  const auth = c.get("auth");
  const lat = Number(c.req.query("lat"));
  const lon = Number(c.req.query("lon"));
  const radiusKm = Number(c.req.query("radius") ?? "25");

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return c.json({ error: "invalid_query", message: "lat must be between -90 and 90" }, 400);
  }

  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return c.json({ error: "invalid_query", message: "lon must be between -180 and 180" }, 400);
  }

  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 500) {
    return c.json({ error: "invalid_query", message: "radius must be greater than 0 and no more than 500km" }, 400);
  }

  const vessels = await loadFallbackVessels(c.env, auth.tenantId);
  const nearby = vessels.filter((vessel) => distanceKm(lat, lon, vessel.latitude, vessel.longitude) <= radiusKm);
  return c.json({ vessels: nearby, source: "db_fallback" });
});

app.get("/vessel/:mmsi", async (c) => {
  const auth = c.get("auth");
  const target = c.req.param("mmsi");

  if (c.env.AIS_PROXY_URL) {
    const proxied = await proxyAisJson(c, `/api/vessel?mmsi=${encodeURIComponent(target)}`);
    if (proxied.status !== 503) return proxied;
  }

  const vessels = await loadFallbackVessels(c.env, auth.tenantId);
  const vessel = vessels.find((item) => item.mmsi === target);
  if (!vessel) {
    return c.json({ found: false, reason: "vessel_not_found" }, 404);
  }
  return c.json({ found: true, vessel, source: "db_fallback" });
});

app.get("/stats", async (c) => {
  const auth = c.get("auth");
  const vessels = await loadFallbackVessels(c.env, auth.tenantId);
  const active = vessels.filter((item) => item.speedOverGround > 0).length;
  return c.json({
    vesselCount: vessels.length,
    activeCount: active,
    stationaryCount: vessels.length - active,
    source: "db_fallback"
  });
});

app.post("/risk/assess", async (c) => {
  const openRouterKey = c.env.OPENROUTER_API_KEY;
  const parsedBody = await readBoundedJson(c);
  if (!parsedBody.ok) return parsedBody.response;

  const body = parsedBody.value as {
    vessels?: Array<Record<string, unknown>>;
    weather?: Record<string, unknown>;
    fishingZone?: Record<string, unknown>;
  };

  const vessels = body?.vessels ?? [];
  if (!Array.isArray(vessels) || vessels.length === 0) {
    return c.json({ error: "invalid_payload", message: "vessels[] is required" }, 400);
  }
  if (vessels.length > AIS_AI_MAX_VESSELS) {
    return c.json({ error: "too_many_vessels", max_vessels: AIS_AI_MAX_VESSELS }, 400);
  }

  const riskSchema = {
    name: "risk_assessment",
    type: "object",
    properties: {
      vessel_mmsi: { type: "string" },
      risk_score: { type: "number", minimum: 0, maximum: 100 },
      risk_level: { type: "string", enum: ["LOW", "MODERATE", "HIGH", "CRITICAL"] },
      primary_factors: { type: "array", items: { type: "string" } },
      recommendations: { type: "array", items: { type: "string" } },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      analysis_timestamp: { type: "string" }
    },
    required: [
      "vessel_mmsi",
      "risk_score",
      "risk_level",
      "primary_factors",
      "recommendations",
      "confidence",
      "analysis_timestamp"
    ],
    additionalProperties: false
  };

  if (!openRouterKey) {
    const assessments = buildFallbackRiskAssessments(vessels, body?.weather);
    const highest = assessments.reduce((currentHighest, item) =>
      item.risk_score > currentHighest.risk_score ? item : currentHighest,
      assessments[0]!
    );
    return c.json({
      assessments,
      overallRisk: {
        level: highest.risk_level,
        score: assessments.reduce((sum, item) => sum + item.risk_score, 0) / assessments.length
      },
      ai_enhanced: false,
      model: "local-fallback"
    });
  }

  try {
    const assessments = await Promise.all(
      vessels.map((vessel) =>
        callOpenRouterAI<RiskAssessmentResponse>(
          [
            {
              role: "system",
              content:
                "You are a maritime safety analyst. Return structured risk analysis based strictly on provided vessel and weather context."
            },
            {
              role: "user",
              content: `Vessel: ${JSON.stringify(vessel)}\nWeather: ${JSON.stringify(body?.weather ?? {})}\nFishingZone: ${JSON.stringify(body?.fishingZone ?? {})}`
            }
          ],
          riskSchema,
          openRouterKey,
          undefined,
          0.1,
          aisAiTimeoutMs(c.env)
        )
      )
    );

    const severityScore = { LOW: 1, MODERATE: 2, HIGH: 3, CRITICAL: 4 } as const;
    const averageSeverity =
      assessments.reduce((sum, item) => sum + severityScore[item.risk_level], 0) / assessments.length;
    const overallRisk =
      averageSeverity >= 3.5
        ? "CRITICAL"
        : averageSeverity >= 2.5
          ? "HIGH"
          : averageSeverity >= 1.5
            ? "MODERATE"
            : "LOW";

    return c.json({
      assessments,
      overallRisk: {
        level: overallRisk,
        score: assessments.reduce((sum, item) => sum + item.risk_score, 0) / assessments.length
      },
      ai_enhanced: true,
      model: "openrouter"
    });
  } catch (error) {
    console.warn(JSON.stringify({
      event: "ais_ai_fallback",
      endpoint: "risk_assess",
      error: error instanceof Error ? error.message : String(error)
    }));
    const assessments = buildFallbackRiskAssessments(vessels, body?.weather);
    const highest = assessments.reduce((currentHighest, item) =>
      item.risk_score > currentHighest.risk_score ? item : currentHighest,
      assessments[0]!
    );
    return c.json({
      assessments,
      overallRisk: {
        level: highest.risk_level,
        score: assessments.reduce((sum, item) => sum + item.risk_score, 0) / assessments.length
      },
      ai_enhanced: false,
      model: "local-fallback",
      fallback_reason: "ai_upstream_unavailable"
    });
  }
});

app.post("/ai/recommendations", async (c) => {
  const openRouterKey = c.env.OPENROUTER_API_KEY;
  const parsedBody = await readBoundedJson(c);
  if (!parsedBody.ok) return parsedBody.response;

  const body = parsedBody.value;
  if (!body || typeof body !== "object") {
    return c.json({ error: "invalid_payload" }, 400);
  }

  if (!openRouterKey) {
    return c.json({ recommendations: buildFallbackRecommendations(body as Record<string, unknown>), ai_enhanced: false, model: "local-fallback" });
  }

  const recommendationSchema = {
    name: "recommendations",
    type: "array",
    items: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["SAFETY", "EFFICIENCY", "COMPLIANCE", "OPERATIONAL"] },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
        title: { type: "string" },
        description: { type: "string" },
        action_items: { type: "array", items: { type: "string" } },
        expected_outcome: { type: "string" },
        time_frame: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 1 }
      },
      required: [
        "category",
        "priority",
        "title",
        "description",
        "action_items",
        "expected_outcome",
        "time_frame",
        "confidence"
      ],
      additionalProperties: false
    }
  };

  try {
    const recommendations = await callOpenRouterAI<RecommendationResponse[]>(
      [
        {
          role: "system",
          content: "You are an operations advisor. Return concrete recommendations in JSON schema format."
        },
        {
          role: "user",
          content: JSON.stringify(body)
        }
      ],
      recommendationSchema,
      openRouterKey,
      undefined,
      0.1,
      aisAiTimeoutMs(c.env)
    );

    return c.json({ recommendations, ai_enhanced: true, model: "openrouter" });
  } catch (error) {
    console.warn(JSON.stringify({
      event: "ais_ai_fallback",
      endpoint: "recommendations",
      error: error instanceof Error ? error.message : String(error)
    }));
    return c.json({
      recommendations: buildFallbackRecommendations(body as Record<string, unknown>),
      ai_enhanced: false,
      model: "local-fallback",
      fallback_reason: "ai_upstream_unavailable"
    });
  }
});

app.post("/risk/predict-collision", async (c) => {
  const openRouterKey = c.env.OPENROUTER_API_KEY;
  const parsedBody = await readBoundedJson(c);
  if (!parsedBody.ok) return parsedBody.response;

  const body = parsedBody.value as {
    vesselA?: Record<string, unknown>;
    vesselB?: Record<string, unknown>;
    timeHorizon?: number;
  };

  if (!body?.vesselA || !body?.vesselB) {
    return c.json({ error: "invalid_payload", message: "vesselA and vesselB are required" }, 400);
  }

  if (!openRouterKey) {
    return c.json({ ...buildFallbackCollisionPrediction(body.vesselA, body.vesselB), ai_enhanced: false, model: "local-fallback" });
  }

  const collisionSchema = {
    name: "collision_prediction",
    type: "object",
    properties: {
      vessel_a: {
        type: "object",
        properties: { mmsi: { type: "string" }, name: { type: "string" } },
        required: ["mmsi", "name"],
        additionalProperties: false
      },
      vessel_b: {
        type: "object",
        properties: { mmsi: { type: "string" }, name: { type: "string" } },
        required: ["mmsi", "name"],
        additionalProperties: false
      },
      collision_probability: { type: "number", minimum: 0, maximum: 1 },
      time_to_closest_approach: { type: "number" },
      closest_approach_distance: { type: "number" },
      risk_level: { type: "string", enum: ["LOW", "MODERATE", "HIGH", "CRITICAL"] },
      recommended_actions: { type: "array", items: { type: "string" } },
      confidence: { type: "number", minimum: 0, maximum: 1 }
    },
    required: [
      "vessel_a",
      "vessel_b",
      "collision_probability",
      "time_to_closest_approach",
      "closest_approach_distance",
      "risk_level",
      "recommended_actions",
      "confidence"
    ],
    additionalProperties: false
  };

  try {
    const prediction = await callOpenRouterAI<CollisionPredictionResponse>(
      [
        {
          role: "system",
          content: "You are a COLREG-aware collision analyst. Return strict JSON only."
        },
        {
          role: "user",
          content: JSON.stringify({
            vesselA: body.vesselA,
            vesselB: body.vesselB,
            timeHorizon: body.timeHorizon ?? 30
          })
        }
      ],
      collisionSchema,
      openRouterKey,
      undefined,
      0.1,
      aisAiTimeoutMs(c.env)
    );

    return c.json({ ...prediction, ai_enhanced: true, model: "openrouter" });
  } catch (error) {
    console.warn(JSON.stringify({
      event: "ais_ai_fallback",
      endpoint: "collision_prediction",
      error: error instanceof Error ? error.message : String(error)
    }));
    return c.json({
      ...buildFallbackCollisionPrediction(body.vesselA, body.vesselB),
      ai_enhanced: false,
      model: "local-fallback",
      fallback_reason: "ai_upstream_unavailable"
    });
  }
});

app.post("/ai/behavior", async (c) => {
  const parsedBody = await readBoundedJson(c);
  if (!parsedBody.ok) return parsedBody.response;

  const body = parsedBody.value as {
    mmsi?: string;
    observations?: Array<{ speed?: number; course?: number }>;
  };

  if (!body?.mmsi || !Array.isArray(body.observations)) {
    return c.json({ error: "invalid_payload" }, 400);
  }
  if (body.observations.length > AIS_AI_MAX_OBSERVATIONS) {
    return c.json({ error: "too_many_observations", max_observations: AIS_AI_MAX_OBSERVATIONS }, 400);
  }

  const speeds = body.observations.map((item) => Number(item.speed ?? 0)).filter((value) => Number.isFinite(value));
  const courses = body.observations.map((item) => Number(item.course ?? 0)).filter((value) => Number.isFinite(value));
  const avgSpeed = speeds.length ? speeds.reduce((sum, value) => sum + value, 0) / speeds.length : 0;
  const avgCourseChange =
    courses.length > 1
      ? courses.slice(1).reduce((sum, course, index) => sum + Math.abs(course - (courses[index] ?? course)), 0) /
        (courses.length - 1)
      : 0;

  return c.json({
    mmsi: body.mmsi,
    model: {
      mmsi: body.mmsi,
      avgSpeed,
      typicalCourseChanges: avgCourseChange,
      patterns: [
        avgSpeed < 1 ? "STATIONARY" : "UNDERWAY",
        avgCourseChange > 45 ? "HIGH_MANEUVERING" : "STABLE_COURSE"
      ],
      lastUpdated: Date.now()
    },
    anomalyScore: avgCourseChange > 90 ? 0.8 : avgCourseChange > 45 ? 0.4 : 0.1
  });
});

app.get("/stream", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.json({ error: "Expected WebSocket upgrade" }, 400);
  }

  let wsBase: string;
  try {
    wsBase = requireAisProxyUrl(c.env);
  } catch (error) {
    return c.json(
      {
        error: "ais_proxy_unavailable",
        message: error instanceof Error ? error.message : "AIS proxy is unavailable"
      },
      503
    );
  }

  const clientUrl = new URL(c.req.url);
  const upstreamBase = wsBase.replace(/^http:\/\//i, "ws://").replace(/^https:\/\//i, "wss://");
  const upstreamUrl = new URL("stream", upstreamBase);
  clientUrl.searchParams.delete("token");
  upstreamUrl.search = clientUrl.search;

  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];

  if (!client || !server) {
    return c.json({ error: "websocket_setup_failed" }, 500);
  }

  server.accept();

  const upstream = new WebSocket(upstreamUrl.toString());
  let upstreamReady = false;

  upstream.addEventListener("open", () => {
    upstreamReady = true;
  });

  upstream.addEventListener("message", (event) => {
    server.send(event.data as any);
  });

  upstream.addEventListener("close", () => {
    try {
      server.close();
    } catch {
      // no-op
    }
  });

  upstream.addEventListener("error", () => {
    try {
      server.close(1011, "AIS upstream error");
    } catch {
      // no-op
    }
  });

  server.addEventListener("message", (event) => {
    if (!upstreamReady) return;
    upstream.send(event.data as any);
  });

  server.addEventListener("close", () => {
    try {
      upstream.close();
    } catch {
      // no-op
    }
  });

  return new Response(null, {
    status: 101,
    webSocket: client
  });
});

export const aisProxyRouter = app;
