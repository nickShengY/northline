import { useEffect, useState, useCallback, useRef } from "react";
import type { VesselPosition } from "../components/charts";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";

function getRuntimeToken() {
  if (typeof window === "undefined") return undefined;
  return window.sessionStorage.getItem("northline.apiToken") ?? window.localStorage.getItem("northline.apiToken") ?? undefined;
}

function getAuthHeaders() {
  const token = import.meta.env.DEV
    ? import.meta.env.VITE_API_TOKEN ?? import.meta.env.VITE_DEV_TOKEN
    : getRuntimeToken();
  const resolvedToken = token || (import.meta.env.DEV ? "demoTenant:portal_admin:ORG_ADMIN" : "");
  if (!resolvedToken) {
    throw new Error("Missing API token. Sign in before using the Northline API.");
  }
  return {
    Authorization: `Bearer ${resolvedToken}`,
    "Content-Type": "application/json"
  };
}

interface AISVesselData {
  mmsi: string;
  name?: string;
  callSign?: string;
  imoNumber?: number;
  vesselType?: number;
  latitude: number | null;
  longitude: number | null;
  speedOverGround?: number | null;
  courseOverGround?: number | null;
  heading?: number | null;
  navigationalStatus?: number;
  status?: string;
  length?: number;
  width?: number;
  destination?: string;
  eta?: string | null;
  draught?: number;
  timestamp: string;
  lastUpdated: number;
}

interface RiskAssessment {
  vesselId: string;
  riskLevel: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  factors: string[];
  recommendation: string;
  confidence: number;
}

interface AIRecommendation {
  id: string;
  type: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  message: string;
  action: string;
  confidence: number;
}

interface CollisionPrediction {
  vessel_a: { mmsi: string; name: string };
  vessel_b: { mmsi: string; name: string };
  collision_probability: number;
  time_to_closest_approach: number;
  closest_approach_distance: number;
  risk_level: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  recommended_actions: string[];
  confidence: number;
}

interface UseAISBackendOptions {
  enableAI?: boolean;
  fishingZone?: { lat: number; lon: number; radius: number };
  weatherPosition?: [number, number];
}

interface AISVesselResponse {
  vessels?: AISVesselData[];
}

export function useAISBackend(
  _boundingBox: [[number, number], [number, number]],
  options: UseAISBackendOptions = {}
) {
  const [vessels, setVessels] = useState<AISVesselData[]>([]);
  const [smoothedVessels, setSmoothedVessels] = useState<AISVesselData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [riskAssessments, setRiskAssessments] = useState<RiskAssessment[]>([]);
  const [aiRecommendations, setAIRecommendations] = useState<AIRecommendation[]>([]);
  const [collisionAlerts, setCollisionAlerts] = useState<CollisionPrediction[]>([]);

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const smoothingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const vesselsRef = useRef(vessels);
  const optionsRef = useRef(options);

  useEffect(() => {
    vesselsRef.current = vessels;
  }, [vessels]);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const fetchVessels = useCallback(async () => {
    try {
      setConnectionStatus("connecting");
      const response = await fetch(`${API_BASE}/v1/ais/vessels`, {
        headers: getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error(`AIS vessel fetch failed (${response.status})`);
      }

      const data = (await response.json()) as AISVesselResponse;
      const next = Array.isArray(data.vessels) ? data.vessels : [];
      setVessels(next);
      setError(null);
      setConnectionStatus("connected");
    } catch (err) {
      setConnectionStatus("error");
      setError(err instanceof Error ? err.message : "Failed to fetch vessel data");
      setVessels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVessels();
    pollingIntervalRef.current = setInterval(fetchVessels, 15000);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [fetchVessels]);

  useEffect(() => {
    if (vessels.length === 0) {
      setSmoothedVessels([]);
      return;
    }

    smoothingIntervalRef.current = setInterval(() => {
      setSmoothedVessels((prev) =>
        vessels.map((vessel) => {
          const existing = prev.find((item) => item.mmsi === vessel.mmsi);
          if (!existing) {
            return vessel;
          }

          const smoothing = 0.3;
          return {
            ...vessel,
            latitude:
              existing.latitude != null && vessel.latitude != null
                ? existing.latitude + (vessel.latitude - existing.latitude) * smoothing
                : vessel.latitude,
            longitude:
              existing.longitude != null && vessel.longitude != null
                ? existing.longitude + (vessel.longitude - existing.longitude) * smoothing
                : vessel.longitude,
            speedOverGround:
              existing.speedOverGround != null && vessel.speedOverGround != null
                ? existing.speedOverGround + (vessel.speedOverGround - existing.speedOverGround) * smoothing
                : vessel.speedOverGround ?? existing.speedOverGround,
            courseOverGround:
              existing.courseOverGround != null && vessel.courseOverGround != null
                ? existing.courseOverGround + (vessel.courseOverGround - existing.courseOverGround) * smoothing
                : vessel.courseOverGround ?? existing.courseOverGround,
            heading:
              existing.heading != null && vessel.heading != null
                ? existing.heading + (vessel.heading - existing.heading) * smoothing
                : vessel.heading ?? existing.heading
          };
        })
      );
    }, 1000);

    return () => {
      if (smoothingIntervalRef.current) {
        clearInterval(smoothingIntervalRef.current);
      }
    };
  }, [vessels]);

  const assessRisks = useCallback(async (weather: { waveHeight: number; windSpeed: number; temperature: number }) => {
    if (!optionsRef.current.enableAI || vesselsRef.current.length === 0) return;

    try {
      const response = await fetch(`${API_BASE}/v1/ais/risk/assess`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          vessels: vesselsRef.current,
          weather,
          fishingZone: optionsRef.current.fishingZone
        })
      });

      if (!response.ok) {
        throw new Error(`Risk assessment failed (${response.status})`);
      }

      const data = (await response.json()) as {
        assessments?: Array<{
          vessel_mmsi?: string;
          risk_level?: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
          primary_factors?: string[];
          recommendations?: string[];
          confidence?: number;
        }>;
      };

      setRiskAssessments(
        (data.assessments ?? []).map((item) => ({
          vesselId: item.vessel_mmsi ?? "unknown",
          riskLevel: item.risk_level ?? "LOW",
          factors: item.primary_factors ?? [],
          recommendation: item.recommendations?.[0] ?? "",
          confidence: item.confidence ?? 0
        }))
      );
    } catch {
      setRiskAssessments([]);
    }
  }, []);

  const getRecommendations = useCallback(async () => {
    if (!optionsRef.current.enableAI) return;

    const activeVessels = vesselsRef.current.filter((v) => v.latitude != null && v.longitude != null);
    const averageSpeed =
      activeVessels.length > 0
        ? activeVessels.reduce((sum, vessel) => sum + (vessel.speedOverGround ?? 0), 0) / activeVessels.length
        : 0;

    try {
      const response = await fetch(`${API_BASE}/v1/ais/ai/recommendations`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          tripData: {
            activeVesselCount: activeVessels.length,
            averageSpeed,
            lastSampledAt: new Date().toISOString()
          },
          weather: null,
          vessels: activeVessels.slice(0, 10),
          fishingZone: optionsRef.current.fishingZone
        })
      });

      if (!response.ok) {
        throw new Error(`Recommendations failed (${response.status})`);
      }

      const data = (await response.json()) as {
        recommendations?: Array<{
          category?: string;
          priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
          title?: string;
          description?: string;
          confidence?: number;
        }>;
      };

      setAIRecommendations(
        (data.recommendations ?? []).map((item, index) => ({
          id: `rec_${index}`,
          type: item.category ?? "OPERATIONAL",
          priority: item.priority ?? "LOW",
          message: item.title ?? "Recommendation",
          action: item.description ?? "",
          confidence: item.confidence ?? 0
        }))
      );
    } catch {
      setAIRecommendations([]);
    }
  }, []);

  const predictCollisions = useCallback(async () => {
    if (!optionsRef.current.enableAI || vesselsRef.current.length < 2) return;

    const candidates = vesselsRef.current.filter((v) => v.latitude != null && v.longitude != null).slice(0, 6);
    if (candidates.length < 2) {
      setCollisionAlerts([]);
      return;
    }

    const predictions: CollisionPrediction[] = [];
    for (let i = 0; i < candidates.length; i += 1) {
      for (let j = i + 1; j < candidates.length; j += 1) {
        const vesselA = candidates[i];
        const vesselB = candidates[j];
        if (!vesselA || !vesselB) continue;

        try {
          const response = await fetch(`${API_BASE}/v1/ais/risk/predict-collision`, {
            method: "POST",
            headers: getAuthHeaders(),
            body: JSON.stringify({
              vesselA,
              vesselB,
              timeHorizon: 30
            })
          });

          if (!response.ok) continue;
          const prediction = (await response.json()) as CollisionPrediction;
          predictions.push(prediction);
        } catch {
          // Continue with remaining pairs.
        }
      }
    }

    setCollisionAlerts(predictions);
  }, []);

  const vesselPositions: VesselPosition[] = smoothedVessels.map((vessel) => ({
    id: vessel.mmsi,
    name: vessel.name || `Vessel ${vessel.mmsi.slice(-4)}`,
    x: vessel.longitude != null ? ((vessel.longitude + 180) / 360) * 100 : 50,
    y: vessel.latitude != null ? ((vessel.latitude + 90) / 180) * 100 : 50,
    status: mapNavStatusToVesselStatus(vessel.navigationalStatus ?? null, vessel.speedOverGround ?? null),
    heading: vessel.heading || vessel.courseOverGround || 0,
    speed: vessel.speedOverGround || 0,
    tripPhase: vessel.status,
    lastCheckin: new Date(vessel.timestamp).toLocaleTimeString()
  }));

  const fetchNearby = useCallback(async (lat: number, lon: number, radius: number) => {
    try {
      const response = await fetch(`${API_BASE}/v1/ais/nearby?lat=${lat}&lon=${lon}&radius=${radius}`, {
        headers: getAuthHeaders()
      });
      if (!response.ok) {
        throw new Error(`Nearby vessel fetch failed (${response.status})`);
      }
      const data = (await response.json()) as AISVesselResponse;
      return data.vessels ?? [];
    } catch {
      return [];
    }
  }, []);

  return {
    vessels: smoothedVessels,
    vesselPositions,
    loading,
    error,
    connectionStatus,
    riskAssessments,
    aiRecommendations,
    collisionAlerts,
    assessRisks,
    getRecommendations,
    predictCollisions,
    fetchNearby,
    reconnect: fetchVessels
  };
}

function mapNavStatusToVesselStatus(
  status: number | null,
  speed: number | null
): "ACTIVE" | "TRANSIT" | "FISHING" | "DOCKED" | "MAINTENANCE" {
  if (status === 7) return "FISHING";
  if (status === 1 || status === 5) return "DOCKED";
  if (status === 0) {
    if (speed && speed > 0.5 && speed < 8) return "FISHING";
    if (speed && speed >= 8) return "TRANSIT";
    return "ACTIVE";
  }
  return "ACTIVE";
}

export function getVesselTypeName(type?: number): string {
  const types: Record<number, string> = {
    0: "Unknown",
    30: "Fishing",
    31: "Towing",
    33: "Dredging",
    35: "Diving",
    50: "Pilot"
  };
  return types[type ?? 0] || "Unknown";
}
