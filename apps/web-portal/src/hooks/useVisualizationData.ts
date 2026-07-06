import { useEffect, useState, useCallback, useRef } from "react";
import {
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
import { projectToMap } from "../lib/geo";
import type { VesselPosition, RiskZone, GearItem, SyncNode, TripPhase, ComplianceCheckpoint } from "../components/charts";

interface UseFleetDataResult {
  vessels: VesselPosition[];
  /** True when some plotted positions were synthesized (no geo data available). */
  approximate: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Hook to fetch fleet data for the tactical map
 * Aggregates trip state + gear data to show vessel positions
 */
export function useFleetData(tripId?: string, refreshInterval = 30000): UseFleetDataResult {
  const [vessels, setVessels] = useState<VesselPosition[]>([]);
  const [approximate, setApproximate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);
  const hasLoadedRef = useRef(false);
  const lastTripIdRef = useRef(tripId);

  const fetchData = useCallback(async () => {
    const seq = ++seqRef.current;
    // A trip switch is a fresh load: show the loading state again instead of
    // presenting the previous trip's data as current.
    if (tripId !== lastTripIdRef.current) {
      lastTripIdRef.current = tripId;
      hasLoadedRef.current = false;
    }
    // Only surface the loading state before the first successful fetch so
    // background polls don't flicker "Loading..." over live data.
    if (!hasLoadedRef.current) setLoading(true);

    try {
      // Get all trips as vessels
      const trips = await listTrips() as TripsResponse;
      const tripRows = trips.trips || [];

      // For detailed vessel positions, try to get trip state if tripId provided
      let detailedVessels: VesselPosition[] = [];
      let syntheticPositionUsed = false;

      if (tripId) {
        try {
          const tripState = await getTripState(tripId) as TripStateResponse;
          // Convert trip gear to vessel positions if geo data exists
          if (tripState.gear) {
            detailedVessels = tripState.gear.map((gear, idx) => {
              const lat = gear.last_position?.lat;
              const lon = gear.last_position?.lon;
              const hasPosition = lat != null && lon != null;
              if (!hasPosition) syntheticPositionUsed = true;
              const projected = hasPosition ? projectToMap(lat, lon) : { x: 20 + idx * 15, y: 20 + idx * 10 };
              return {
                id: gear.gear_id,
                name: gear.gear_id,
                x: projected.x,
                y: projected.y,
                status: mapGearStatusToVesselStatus(gear.status),
                heading: 0,
                speed: gear.status === "DEPLOYED" ? 0 : gear.status === "HAULED" ? 0.5 : 0,
                tripPhase: gear.status,
                lastCheckin: new Date(gear.updated_at).toLocaleTimeString()
              };
            });
          }
        } catch {
          // Leave detailed vessel data empty when trip detail lookup fails.
        }
      }

      // Convert trips to vessels; trip rows carry no geo data, so these
      // positions come from a synthetic fallback grid.
      if (tripRows.length > 0) syntheticPositionUsed = true;
      const vesselData: VesselPosition[] = tripRows.map((trip, idx) => ({
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

      // Drop stale responses that resolve after a newer request started.
      if (seq !== seqRef.current) return;
      hasLoadedRef.current = true;
      setVessels(merged);
      setApproximate(syntheticPositionUsed);
      setError(null);
    } catch (err) {
      if (seq !== seqRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load fleet data");
    } finally {
      if (seq === seqRef.current) {
        setLoading(false);
      }
    }
  }, [tripId]);

  useEffect(() => {
    fetchData();

    if (refreshInterval > 0) {
      const interval = setInterval(fetchData, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [fetchData, refreshInterval]);

  return { vessels, approximate, loading, error, refetch: fetchData };
}

/**
 * Hook to fetch risk/hazard data for heat map
 */
export function useRiskData(refreshInterval = 60000) {
  const [zones, setZones] = useState<RiskZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);
  const hasLoadedRef = useRef(false);

  const fetchData = useCallback(async () => {
    const seq = ++seqRef.current;
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const [hazards, incidents] = await Promise.all([
        getHazards() as Promise<HazardsResponse>,
        getOpenIncidents() as Promise<OpenIncidentsResponse>
      ]);

      // Convert hazards to risk zones
      const hazardZones: RiskZone[] = (hazards.hazards || []).map((h, idx) => {
        const lat = h.location?.lat;
        const lon = h.location?.lon;
        const projected = lat != null && lon != null ? projectToMap(lat, lon) : { x: 20 + idx * 20, y: 20 + idx * 15 };
        return {
          x: projected.x,
          y: projected.y,
          radius: 15 + h.severity * 5,
          severity: mapSeverityToRiskLevel(h.severity),
          label: h.type || "Hazard"
        };
      });

      // Add incident zones
      const incidentZones: RiskZone[] = (incidents.incidents || []).slice(0, 5).map((inc, idx) => ({
        x: 30 + idx * 15,
        y: 40 + idx * 10,
        radius: 20 + inc.severity * 8,
        severity: mapSeverityToRiskLevel(inc.severity),
        label: inc.category
      }));

      if (seq !== seqRef.current) return;
      hasLoadedRef.current = true;
      setZones([...hazardZones, ...incidentZones]);
      setError(null);
    } catch (err) {
      if (seq !== seqRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load risk data");
    } finally {
      if (seq === seqRef.current) {
        setLoading(false);
      }
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
  const seqRef = useRef(0);
  const hasLoadedRef = useRef(false);
  const lastTripIdRef = useRef(tripId);

  const fetchData = useCallback(async () => {
    const seq = ++seqRef.current;
    if (tripId !== lastTripIdRef.current) {
      // Trip switch: clear the previous trip's gear so it isn't shown as
      // current while the new trip loads.
      lastTripIdRef.current = tripId;
      hasLoadedRef.current = false;
      setItems([]);
    }
    if (!tripId) {
      hasLoadedRef.current = false;
      setItems([]);
      setError(null);
      setLoading(false);
      return;
    }

    if (!hasLoadedRef.current) setLoading(true);
    try {
      const data = await getGearForTrip(tripId) as GearForTripResponse;

      const gearItems: GearItem[] = (data.gear || []).map((g) => ({
        id: g.gear_id,
        name: g.buoy_label || g.station_id || g.gear_id,
        status: mapGearStatus(g.status),
        health: calculateGearHealth(g.status, g.updated_at),
        lastSweep: new Date(g.updated_at),
        location: g.last_position && g.last_position.lat != null && g.last_position.lon != null
          ? `${g.last_position.lat.toFixed(2)}, ${g.last_position.lon.toFixed(2)}`
          : (data.mode === "OFFSHORE" ? g.buoy_label : g.station_id) || "Unknown"
      }));

      if (seq !== seqRef.current) return;
      hasLoadedRef.current = true;
      setItems(gearItems);
      setError(null);
    } catch (err) {
      if (seq !== seqRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load gear data");
    } finally {
      if (seq === seqRef.current) {
        setLoading(false);
      }
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
  const seqRef = useRef(0);
  const hasLoadedRef = useRef(false);

  function formatNodeName(subjectType: string, index: number) {
    if (subjectType === "VESSEL") return index === 0 ? "Vessel station" : `Vessel station ${index + 1}`;
    if (subjectType === "GROUP") return index === 0 ? "Crew group" : `Crew group ${index + 1}`;
    if (subjectType === "USER") return index === 0 ? "Crew device" : `Crew device ${index + 1}`;
    return index === 0 ? "Operations device" : `Operations device ${index + 1}`;
  }

  const fetchData = useCallback(async () => {
    const seq = ++seqRef.current;
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const [devices, metricsData] = await Promise.all([
        listDevices() as Promise<DevicesResponse>,
        getSyncMetrics(24) as Promise<SyncMetricsResponse>
      ]);

      // Convert devices to sync nodes
      const syncNodes: SyncNode[] = (devices.devices || []).map((d, index) => ({
        id: d.device_id,
        name: formatNodeName(d.subject_type, index),
        status: d.revoked ? "OFFLINE" : "ONLINE",
        lastSync: new Date(d.last_seen_at || d.created_at),
        pendingCount: 0,
        queueDepth: 0
      }));

      if (seq !== seqRef.current) return;
      hasLoadedRef.current = true;
      setNodes(syncNodes);
      setMetrics(metricsData.metrics || []);
      setError(null);
    } catch (err) {
      if (seq !== seqRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load sync data");
    } finally {
      if (seq === seqRef.current) {
        setLoading(false);
      }
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
  const seqRef = useRef(0);
  const hasLoadedRef = useRef(false);
  const lastTripIdRef = useRef(tripId);

  const fetchData = useCallback(async () => {
    const seq = ++seqRef.current;
    if (tripId !== lastTripIdRef.current) {
      lastTripIdRef.current = tripId;
      hasLoadedRef.current = false;
      setPhases([]);
    }
    if (!tripId) {
      hasLoadedRef.current = false;
      setPhases([]);
      setError(null);
      setLoading(false);
      return;
    }

    if (!hasLoadedRef.current) setLoading(true);
    try {
      const [timeline, state] = await Promise.all([
        getTripTimeline(tripId, 100) as Promise<{ count: number; timeline: Array<{ event_type: string; ts_device: string; payload_json: unknown }> }>,
        getTripState(tripId) as Promise<TripStateResponse>
      ]);

      // Build phases directly from observed timeline events.
      const nextPhases: TripPhase[] = [];
      const status = state.trip?.status || "PLANNED";
      const isActive = status === "ACTIVE";

      if (timeline.timeline?.length) {
        const events = [...timeline.timeline].sort((a, b) => a.ts_device.localeCompare(b.ts_device));
        const firstEvent = events[0];
        const lastEvent = events[events.length - 1];
        const firstTime = firstEvent ? new Date(firstEvent.ts_device) : new Date();
        const lastTime = lastEvent ? new Date(lastEvent.ts_device) : new Date(firstTime.getTime() + 60000);
        const safeEndTime = lastTime.getTime() > firstTime.getTime() ? lastTime : new Date(firstTime.getTime() + 60000);

        nextPhases.push({
          name: "Observed Activity",
          start: firstTime,
          end: safeEndTime,
          status: isActive ? "ACTIVE" : "COMPLETE",
          progress: isActive ? Math.min(99, Math.max(1, Math.round((timeline.count / 200) * 100))) : 100
        });
      }

      if (seq !== seqRef.current) return;
      hasLoadedRef.current = true;
      setPhases(nextPhases);
      setError(null);
    } catch (err) {
      if (seq !== seqRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load timeline");
    } finally {
      if (seq === seqRef.current) {
        setLoading(false);
      }
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
  const seqRef = useRef(0);
  const hasLoadedRef = useRef(false);
  const lastTripIdRef = useRef(tripId);

  const fetchData = useCallback(async () => {
    const seq = ++seqRef.current;
    if (tripId !== lastTripIdRef.current) {
      lastTripIdRef.current = tripId;
      hasLoadedRef.current = false;
      setCheckpoints([]);
    }
    if (!tripId) {
      hasLoadedRef.current = false;
      setCheckpoints([]);
      setError(null);
      setLoading(false);
      return;
    }

    if (!hasLoadedRef.current) setLoading(true);
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

      // Add validation errors and warnings as incomplete checkpoints
      const issueCheckpoints = [...(compliance.errors ?? []), ...(compliance.warnings ?? [])].map((issue) => ({
        name: issue.message || issue.code,
        completed: false,
        required: issue.severity === "error"
      }));

      if (seq !== seqRef.current) return;
      hasLoadedRef.current = true;
      setCheckpoints([...baseCheckpoints, ...issueCheckpoints]);
      setError(null);
    } catch (err) {
      if (seq !== seqRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load compliance data");
    } finally {
      if (seq === seqRef.current) {
        setLoading(false);
      }
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

/**
 * Gear rows carry gear lifecycle statuses (SET/CHECKED/HAULED/...), not vessel
 * statuses, so map them explicitly instead of casting into the vessel union.
 */
function mapGearStatusToVesselStatus(status: string): VesselPosition["status"] {
  switch (status) {
    case "REGISTERED":
      return "TRANSIT";
    case "SET":
    case "CHECKED":
      return "FISHING";
    case "HAULED":
    case "RECOVERED":
      return "ACTIVE";
    case "REMOVED":
      return "DOCKED";
    case "MISSING":
      return "MAINTENANCE";
    default:
      return "ACTIVE";
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
    REGISTERED: "DEPLOYED",
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
