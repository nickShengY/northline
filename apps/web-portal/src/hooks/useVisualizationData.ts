import { useEffect, useState, useCallback, useRef } from "react";
import {
  getDashboard,
  getGearForTrip,
  getHazards,
  listDevices,
  getSyncMetrics,
  listTrips,
  getTripState,
  getTripTimeline,
  getOpenIncidents,
  type GearForTripResponse,
  type HazardsResponse,
  type DevicesResponse,
  type SyncMetricsResponse,
  type TripsResponse,
  type TripStateResponse,
  type OpenIncidentsResponse
} from "../lib/api";
import type { VesselPosition, RiskZone, GearItem, SyncNode, TripPhase, ComplianceCheckpoint } from "../components/charts";

interface UseFleetDataResult {
  vessels: VesselPosition[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Hook to fetch fleet data for the tactical map
 * Aggregates trip state + device data to show vessel positions
 */
export function useFleetData(tripId?: string, refreshInterval = 30000): UseFleetDataResult {
  const [vessels, setVessels] = useState<VesselPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    abortRef.current = new AbortController();

    setLoading(true);
    setError(null);

    try {
      // Get all trips as vessels
      const trips = await listTrips() as TripsResponse;
      const tripRows = trips.trips || [];

      // For detailed vessel positions, try to get trip state if tripId provided
      let detailedVessels: VesselPosition[] = [];

      if (tripId) {
        try {
          const tripState = await getTripState(tripId) as TripStateResponse;
          // Convert trip gear to vessel positions if geo data exists
          if (tripState.gear) {
            detailedVessels = tripState.gear.map((gear: { gear_id: string; last_position?: { lat?: number; lon?: number }; status: string; updated_at: string }, idx: number) => ({
              id: gear.gear_id,
              name: gear.gear_id,
              x: gear.last_position?.lat ? ((gear.last_position.lat + 90) / 180) * 100 : 20 + idx * 15,
              y: gear.last_position?.lon ? ((gear.last_position.lon + 180) / 360) * 100 : 20 + idx * 10,
              status: gear.status as VesselPosition["status"],
              heading: 0,
              speed: gear.status === "DEPLOYED" ? 0 : gear.status === "HAULED" ? 0.5 : 0,
              tripPhase: gear.status as string,
              lastCheckin: new Date(gear.updated_at).toLocaleTimeString()
            }));
          }
        } catch {
          // Leave detailed vessel data empty when trip detail lookup fails.
        }
      }

      // Convert trips to vessels with positions
      const vesselData: VesselPosition[] = tripRows.map((trip: TripsResponse["trips"][0], idx: number) => ({
        id: trip.trip_id,
        name: `Vessel ${trip.trip_id.slice(-4)}`,
        x: 10 + (idx % 5) * 18,
        y: 15 + Math.floor(idx / 5) * 20,
        status: mapTripStatusToVesselStatus(trip.status),
        heading: trip.status === "ACTIVE" ? 45 + idx * 30 : 0,
        speed: trip.status === "ACTIVE" ? 2.5 : 0,
        tripPhase: trip.status,
        lastCheckin: trip.updated_at
          ? new Date(trip.updated_at).toLocaleTimeString()
          : "Unknown"
      }));

      // Merge with detailed vessel data if available
      const merged = detailedVessels.length > 0
        ? [...detailedVessels, ...vesselData.filter(v => !detailedVessels.find(d => d.id === v.id))]
        : vesselData;

      setVessels(merged);
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    fetchData();

    if (refreshInterval > 0) {
      const interval = setInterval(fetchData, refreshInterval);
      return () => {
        clearInterval(interval);
        abortRef.current?.abort();
      };
    }
  }, [fetchData, refreshInterval]);

  return { vessels, loading, error, refetch: fetchData };
}

/**
 * Hook to fetch risk/hazard data for heat map
 */
export function useRiskData(refreshInterval = 60000) {
  const [zones, setZones] = useState<RiskZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [hazards, incidents] = await Promise.all([
        getHazards() as Promise<HazardsResponse>,
        getOpenIncidents() as Promise<OpenIncidentsResponse>
      ]);

      // Convert hazards to risk zones
      const hazardZones: RiskZone[] = (hazards.hazards || []).map((h: HazardsResponse["hazards"][0], idx: number) => ({
        x: h.location?.lat ? ((h.location.lat + 90) / 180) * 100 : 20 + idx * 20,
        y: h.location?.lon ? ((h.location.lon + 180) / 360) * 100 : 20 + idx * 15,
        radius: 15 + h.severity * 5,
        severity: mapSeverityToRiskLevel(h.severity),
        label: h.type || "Hazard"
      }));

      // Add incident zones
      const incidentZones: RiskZone[] = (incidents.incidents || []).slice(0, 5).map((inc: OpenIncidentsResponse["incidents"][0], idx: number) => ({
        x: 30 + idx * 15,
        y: 40 + idx * 10,
        radius: 20 + inc.severity * 8,
        severity: mapSeverityToRiskLevel(inc.severity),
        label: inc.category
      }));

      setZones([...hazardZones, ...incidentZones]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load risk data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    if (refreshInterval > 0) {
      const interval = setInterval(fetchData, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [fetchData, refreshInterval]);

  return { zones, loading, error, refetch: fetchData };
}

/**
 * Hook to fetch gear health data
 */
export function useGearData(tripId?: string, refreshInterval = 30000) {
  const [items, setItems] = useState<GearItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!tripId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await getGearForTrip(tripId) as GearForTripResponse;

      const gearItems: GearItem[] = (data.gear || []).map((g: GearForTripResponse["gear"][0]) => ({
        id: g.gear_id,
        name: g.buoy_label || g.station_id || g.gear_id,
        status: mapGearStatus(g.status),
        health: calculateGearHealth(g.status, g.updated_at),
        lastSweep: new Date(g.updated_at),
        location: g.last_position
          ? `${g.last_position.lat?.toFixed(2) ?? "?"}, ${g.last_position.lon?.toFixed(2) ?? "?"}`
          : (data.mode === "OFFSHORE" ? g.buoy_label : g.station_id) || "Unknown"
      }));

      setItems(gearItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load gear data");
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    fetchData();
    if (refreshInterval > 0 && tripId) {
      const interval = setInterval(fetchData, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [fetchData, refreshInterval, tripId]);

  return { items, loading, error, refetch: fetchData };
}

/**
 * Hook to fetch sync network data
 */
export function useSyncData(refreshInterval = 15000) {
  const [nodes, setNodes] = useState<SyncNode[]>([]);
  const [metrics, setMetrics] = useState<SyncMetricsResponse["metrics"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function formatNodeName(subjectType: string, index: number) {
    if (subjectType === "VESSEL") return index === 0 ? "Vessel station" : `Vessel station ${index + 1}`;
    if (subjectType === "GROUP") return index === 0 ? "Crew group" : `Crew group ${index + 1}`;
    if (subjectType === "USER") return index === 0 ? "Crew device" : `Crew device ${index + 1}`;
    return index === 0 ? "Operations device" : `Operations device ${index + 1}`;
  }

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [devices, metricsData] = await Promise.all([
        listDevices() as Promise<DevicesResponse>,
        getSyncMetrics(24) as Promise<SyncMetricsResponse>
      ]);

      // Convert devices to sync nodes
      const syncNodes: SyncNode[] = (devices.devices || []).map((d: DevicesResponse["devices"][0], index: number) => ({
        id: d.device_id,
        name: formatNodeName(d.subject_type, index),
        status: d.revoked ? "OFFLINE" : "ONLINE",
        lastSync: new Date(d.last_seen_at || d.created_at),
        pendingCount: 0,
        queueDepth: 0
      }));

      setNodes(syncNodes);
      setMetrics(metricsData.metrics || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sync data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    if (refreshInterval > 0) {
      const interval = setInterval(fetchData, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [fetchData, refreshInterval]);

  return { nodes, metrics, loading, error, refetch: fetchData };
}

/**
 * Hook to fetch trip phase data for timeline
 */
export function useTripTimelineData(tripId?: string) {
  const [phases, setPhases] = useState<TripPhase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!tripId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [timeline, state] = await Promise.all([
        getTripTimeline(tripId, 100) as Promise<{ count: number; timeline: Array<{ event_type: string; ts_device: string; payload_json: unknown }> }>,
        getTripState(tripId) as Promise<TripStateResponse>
      ]);

      // Build phases directly from observed timeline events.
      const phases: TripPhase[] = [];
      const status = state.trip?.status || "PLANNED";
      const isActive = status === "ACTIVE";

      if (timeline.timeline?.length) {
        const events = [...timeline.timeline].sort((a, b) => a.ts_device.localeCompare(b.ts_device));
        const firstEvent = events[0];
        const lastEvent = events[events.length - 1];
        const firstTime = firstEvent ? new Date(firstEvent.ts_device) : new Date();
        const lastTime = lastEvent ? new Date(lastEvent.ts_device) : new Date(firstTime.getTime() + 60000);
        const safeEndTime = lastTime.getTime() > firstTime.getTime() ? lastTime : new Date(firstTime.getTime() + 60000);

        phases.push({
          name: "Observed Activity",
          start: firstTime,
          end: safeEndTime,
          status: isActive ? "ACTIVE" : "COMPLETE",
          progress: isActive ? Math.min(99, Math.max(1, Math.round((timeline.count / 200) * 100))) : 100
        });
      } else {
        setPhases([]);
        return;
      }

      setPhases(phases);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load timeline");
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { phases, loading, error, refetch: fetchData };
}

/**
 * Hook to fetch compliance progress data
 */
export function useComplianceData(tripId?: string) {
  const [checkpoints, setCheckpoints] = useState<ComplianceCheckpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!tripId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const state = await getTripState(tripId) as TripStateResponse;

      // Build checkpoints from compliance validation
      const compliance = state.compliance;
      const baseCheckpoints: ComplianceCheckpoint[] = [
        { name: "Gear Inspection", completed: compliance.completion_meter >= 25, required: true },
        { name: "Safety Brief", completed: compliance.completion_meter >= 50, required: true },
        { name: "Catch Log", completed: compliance.completion_meter >= 75, required: true },
        { name: "Trip Report", completed: compliance.completion_meter >= 90, required: true }
      ];

      // Add any validation errors as incomplete checkpoints
      const errorCheckpoints = (compliance.issues || []).map((issue: { code: string; message: string }) => ({
        name: issue.message || issue.code,
        completed: false,
        required: true
      }));

      setCheckpoints([...baseCheckpoints, ...errorCheckpoints]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load compliance data");
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { checkpoints, loading, error, refetch: fetchData };
}

// Helper functions
function mapTripStatusToVesselStatus(status: string): VesselPosition["status"] {
  switch (status) {
    case "ACTIVE": return "FISHING";
    case "PLANNED": return "TRANSIT";
    case "COMPLETED": return "DOCKED";
    case "CANCELLED": return "DOCKED";
    default: return "TRANSIT";
  }
}

function mapSeverityToRiskLevel(severity: number): RiskZone["severity"] {
  if (severity <= 2) return "LOW";
  if (severity <= 3) return "MODERATE";
  if (severity <= 4) return "HIGH";
  return "CRITICAL";
}

function mapGearStatus(status: string): GearItem["status"] {
  const statusMap: Record<string, GearItem["status"]> = {
    SET: "DEPLOYED",
    CHECKED: "DEPLOYED",
    HAULED: "RETRIEVED",
    MISSING: "MISSING",
    RECOVERED: "RETRIEVED",
    REMOVED: "RETRIEVED"
  };
  return statusMap[status] || "DAMAGED";
}

function calculateGearHealth(status: string, updatedAt: string): number {
  if (status === "MISSING") return 0;
  if (status === "REMOVED") return 100;

  // Calculate health based on age of last update
  const age = Date.now() - new Date(updatedAt).getTime();
  const hoursOld = age / (1000 * 60 * 60);

  if (hoursOld < 1) return 95;
  if (hoursOld < 6) return 85;
  if (hoursOld < 24) return 75;
  if (hoursOld < 48) return 65;
  return 50;
}
