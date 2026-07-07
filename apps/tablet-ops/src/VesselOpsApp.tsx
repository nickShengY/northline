import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Textarea,
  Select,
  Badge,
  StatusBadge,
  RiskBadge,
  ConnectionStatus,
  SyncIndicator,
  MOBAlert,
  ConfirmModal,
  Skeleton,
  useToast,
  AppShell,
  PageHeader,
  Section,
  Grid,
  Stack,
  Divider,
  Icon,
  ActivityList
} from "@northline/ui";
import "@northline/ui/styles.css";
import {
  listTrips,
  getTripGear,
  transitionTripGear,
  listDevices,
  getOpenIncidents,
  scoreRisk,
  reportHazard
} from "./lib/api";

type SyncState = "SYNCED" | "SYNCING" | "PENDING" | "ERROR";
type VesselStatus = "DOCKED" | "TRANSIT" | "FISHING" | "HAULING" | "EMERGENCY";
type GearStatus = "REGISTERED" | "SET" | "CHECKED" | "HAULED" | "MISSING" | "RECOVERED" | "REMOVED";

interface GearItem {
  gear_id: string;
  status: GearStatus;
  lastCheck: string;
  location?: string;
}

interface CrewMember {
  id: string;
  name: string;
  role: string;
  status: "ON_DECK" | "BELOW" | "OFF_WATCH";
}

interface SafetyEvent {
  id: string;
  type: "MOB" | "INJURY" | "HAZARD" | "ALERT";
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  timestamp: Date;
  acknowledged: boolean;
}

interface ShiftNote {
  id: string;
  text: string;
  author: string;
  createdAt: string;
}

type ActivityTone = "info" | "success" | "warning" | "danger";

interface ActivityEntry {
  id: string;
  message: string;
  tone: ActivityTone;
  createdAt: string;
}

type RiskTier = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

const VESSEL_NAME = "Northline Vessel Ops";
const STORAGE_VERSION = 1;
const STORAGE_KEY_NOTES = "northline.tablet_ops.shift_notes";
const STORAGE_KEY_ACTIVITY = "northline.tablet_ops.activity";

/** Preset assumptions fed to the risk model when live values are unavailable. */
const RISK_ESTIMATE_INPUTS = {
  workloadIntensity: 60,
  weatherSeverity: 50,
  daylightHoursLeft: 4
} as const;

/** crypto.randomUUID throws on non-secure contexts (e.g. plain-HTTP tablets). */
function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      // fall through to the non-crypto fallback below
    }
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

interface VersionedPayload<T> {
  version: number;
  items: T[];
}

function readVersionedStorage<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<VersionedPayload<T>> | null;
    if (!parsed || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.items)) {
      return [];
    }
    return parsed.items;
  } catch {
    return [];
  }
}

function writeVersionedStorage<T>(key: string, items: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify({ version: STORAGE_VERSION, items }));
  } catch {
    // Storage may be full or unavailable; the in-memory copy remains authoritative.
  }
}

/** Resolve the device position, or null if geolocation is unavailable/denied/timed out. */
function getCurrentPosition(timeoutMs = 8000): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 }
    );
  });
}

function mapSeverityToLabel(severity: number): SafetyEvent["severity"] {
  if (severity >= 5) return "critical";
  if (severity >= 4) return "high";
  if (severity >= 3) return "medium";
  return "low";
}

function formatGearTimestamp(value: string) {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? "Unknown" : time.toLocaleTimeString();
}

function formatCrewName(subjectType: string, index: number) {
  if (subjectType === "VESSEL") return index === 0 ? "Vessel station" : `Vessel station ${index + 1}`;
  if (subjectType === "GROUP") return index === 0 ? "Crew group" : `Crew group ${index + 1}`;
  if (subjectType === "USER") return index === 0 ? "Crew device" : `Crew device ${index + 1}`;
  return index === 0 ? "Operations device" : `Operations device ${index + 1}`;
}

function formatCrewRole(subjectType: string) {
  if (subjectType === "VESSEL") return "Bridge station";
  if (subjectType === "GROUP") return "Crew channel";
  if (subjectType === "USER") return "Assigned operator";
  return "Operations endpoint";
}

function formatTripLabel(id?: string) {
  if (!id) return "Not selected";
  const match = id.match(/trip_(ice_)?(?:demo_)?(\d+)$/i);
  if (match?.[2]) return `${match[1] ? "Ice trip" : "Trip"} ${match[2].padStart(3, "0")}`;
  return id;
}

export function VesselOpsApp() {
  const toast = useToast();
  const [vesselStatus, setVesselStatus] = useState<VesselStatus>("DOCKED");
  const [syncState, setSyncState] = useState<SyncState>("SYNCING");
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [tripId, setTripId] = useState("");
  const [tripOptions, setTripOptions] = useState<string[]>([]);
  const vesselName = VESSEL_NAME;
  const [gearItems, setGearItems] = useState<GearItem[]>([]);
  const [gearBusy, setGearBusy] = useState<Record<string, boolean>>({});
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [safetyEvents, setSafetyEvents] = useState<SafetyEvent[]>([]);
  const [mobAlertActive, setMobAlertActive] = useState(false);
  const [emergencyReportBusy, setEmergencyReportBusy] = useState(false);
  const [clearEmergencyOpen, setClearEmergencyOpen] = useState(false);
  const [allHandsConfirmOpen, setAllHandsConfirmOpen] = useState(false);
  const [shiftNotes, setShiftNotes] = useState<ShiftNote[]>(() => readVersionedStorage<ShiftNote>(STORAGE_KEY_NOTES));
  const [noteInput, setNoteInput] = useState("");
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>(() =>
    readVersionedStorage<ActivityEntry>(STORAGE_KEY_ACTIVITY)
  );
  const [riskScore, setRiskScore] = useState<{ tier: RiskTier; score: number } | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [bootstrapStatus, setBootstrapStatus] = useState<"loading" | "error" | "ready">("loading");
  const [watchChecklist, setWatchChecklist] = useState({
    comms: false,
    deck: false,
    weather: false,
    gear: false
  });
  const loadSeqRef = useRef(0);
  // trip_id -> mode from the trip list, so gear/risk calls use the right mode
  // for ICE trips instead of assuming OFFSHORE.
  const tripModesRef = useRef<Map<string, "OFFSHORE" | "ICE">>(new Map());
  const modeForTrip = useCallback(
    (id: string): "OFFSHORE" | "ICE" => tripModesRef.current.get(id) ?? "OFFSHORE",
    []
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    writeVersionedStorage(STORAGE_KEY_NOTES, shiftNotes);
  }, [shiftNotes]);

  useEffect(() => {
    writeVersionedStorage(STORAGE_KEY_ACTIVITY, activityLog);
  }, [activityLog]);

  const addActivity = useCallback((message: string, tone: ActivityTone = "info") => {
    setActivityLog((prev) =>
      [{ id: generateId(), message, tone, createdAt: new Date().toISOString() }, ...prev].slice(0, 50)
    );
  }, []);

  const loadTripSnapshot = useCallback(
    async (nextTripId: string) => {
      if (!nextTripId) return;

      // Sequence guard: a slower response for a previously-selected trip must
      // never overwrite data for the trip the user switched to afterwards.
      const seq = ++loadSeqRef.current;
      setSyncState("SYNCING");
      try {
        const [gearResponse, deviceResponse, incidentResponse] = await Promise.all([
          getTripGear(nextTripId, modeForTrip(nextTripId)),
          listDevices(),
          getOpenIncidents()
        ]);
        if (seq !== loadSeqRef.current) return;

        setGearItems(
          (gearResponse.gear ?? []).map((gear) => ({
            gear_id: gear.gear_id,
            status: gear.status,
            lastCheck: formatGearTimestamp(gear.updated_at),
            location:
              gear.last_position?.lat != null && gear.last_position?.lon != null
                ? `${gear.last_position.lat.toFixed(3)}, ${gear.last_position.lon.toFixed(3)}`
                : undefined
          }))
        );

        setCrew(
          (deviceResponse.devices ?? []).slice(0, 8).map((device, index) => ({
            id: device.device_id,
            name: formatCrewName(device.subject_type, index),
            role: formatCrewRole(device.subject_type),
            status: device.revoked ? "OFF_WATCH" : "ON_DECK"
          }))
        );

        const incidents = incidentResponse.incidents ?? [];
        setSafetyEvents(
          incidents.slice(0, 8).map((incident) => ({
            id: incident.case_id,
            type: "HAZARD",
            severity: mapSeverityToLabel(incident.severity),
            message: incident.summary || incident.category,
            timestamp: new Date(incident.opened_at),
            acknowledged: incident.status !== "OPEN"
          }))
        );

        const risk = await scoreRisk({
          mode: modeForTrip(nextTripId),
          nearMissCount: incidents.length,
          ...RISK_ESTIMATE_INPUTS
        });
        if (seq !== loadSeqRef.current) return;
        setRiskScore({ tier: risk.tier, score: Math.round(risk.score) });

        // Only infer FISHING on the very first load; never clobber a status
        // the bridge has set (EMERGENCY, HAULING, ...).
        setVesselStatus((prev) => (prev === "DOCKED" ? "FISHING" : prev));
        setLastSyncedAt(new Date());
        setSyncState("SYNCED");
      } catch {
        if (seq !== loadSeqRef.current) return;
        setSyncState("ERROR");
        addActivity(`Failed to refresh live trip data for ${formatTripLabel(nextTripId)}.`, "danger");
      }
    },
    [addActivity]
  );

  const bootstrap = useCallback(async () => {
    setBootstrapStatus("loading");
    setSyncState("SYNCING");
    try {
      const response = await listTrips();
      const trips = response.trips ?? [];
      tripModesRef.current = new Map(
        trips.map((row) => [row.trip_id, row.mode === "ICE" ? "ICE" as const : "OFFSHORE" as const])
      );
      const ids = trips.map((row) => row.trip_id);
      setTripOptions(ids);
      const activeTripId = ids[0] ?? "";
      setTripId((prev) => prev || activeTripId);
      setBootstrapStatus("ready");

      if (activeTripId) {
        await loadTripSnapshot(activeTripId);
      } else {
        setSyncState("PENDING");
      }
    } catch {
      setBootstrapStatus("error");
      setSyncState("ERROR");
    }
  }, [loadTripSnapshot]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const transitionGear = useCallback(
    // REGISTERED is a server-assigned starting state, not a reachable transition.
    async (gearId: string, newStatus: Exclude<GearStatus, "REGISTERED">) => {
      if (!tripId) {
        addActivity("Select a trip before transitioning gear.", "warning");
        toast.warning("No trip selected", "Select a trip before transitioning gear.");
        return;
      }

      setGearBusy((prev) => ({ ...prev, [gearId]: true }));
      setSyncState("SYNCING");
      try {
        await transitionTripGear({
          trip_id: tripId,
          gear_id: gearId,
          transition: newStatus,
          note: `Tablet transition: ${newStatus}`,
          mode: modeForTrip(tripId)
        });
        await loadTripSnapshot(tripId);
        addActivity(`Gear ${gearId} transitioned to ${newStatus}.`, "success");
        toast.success("Gear updated", `${gearId} is now ${newStatus}.`);
      } catch {
        setSyncState("ERROR");
        addActivity(`Gear transition failed for ${gearId}.`, "danger");
        toast.error("Gear transition failed", `Could not move ${gearId} to ${newStatus}. Try again.`);
      } finally {
        setGearBusy((prev) => {
          const next = { ...prev };
          delete next[gearId];
          return next;
        });
      }
    },
    [tripId, addActivity, loadTripSnapshot, toast.warning, toast.success, toast.error]
  );

  /** Raise the MOB alarm locally. The hazard report is filed via "Respond Now". */
  const triggerMOB = useCallback(() => {
    setMobAlertActive(true);
    setVesselStatus("EMERGENCY");
    addActivity("MOB alert raised on this tablet. Awaiting emergency response.", "danger");
    toast.warning("MOB alert active", 'Use "Respond Now" to file the emergency hazard report.');
  }, [addActivity, toast.warning]);

  /** "Respond Now": file the emergency hazard report with the real device position. */
  const respondToEmergency = useCallback(async () => {
    if (emergencyReportBusy) return;
    if (!tripId) {
      addActivity("Emergency report needs an active trip selected.", "warning");
      toast.error("No trip selected", "Select a trip before filing the emergency hazard report.");
      return;
    }

    setEmergencyReportBusy(true);
    try {
      const position = await getCurrentPosition();
      if (!position) {
        // The hazard API requires coordinates; never fabricate them.
        addActivity(
          "Emergency report not submitted: device position unavailable and the report requires coordinates.",
          "warning"
        );
        toast.error(
          "Position unknown",
          "The hazard report requires coordinates and none are available. The alert stays active; use radio procedures."
        );
        return;
      }

      setSyncState("SYNCING");
      await reportHazard({
        hazard_id: `hz_${generateId().replace(/[^a-z0-9]/gi, "").slice(0, 8)}`,
        trip_id: tripId,
        hazard_type: "OPEN_WATER",
        severity: 5,
        confidence: 0.95,
        sharing_scope: "ORG",
        location: position
      });
      addActivity("Emergency MOB hazard report submitted with live device position.", "danger");
      toast.success("Emergency report submitted", "MOB hazard shared with the organization.");
      await loadTripSnapshot(tripId);
    } catch {
      setSyncState("ERROR");
      addActivity("Emergency report failed to submit.", "danger");
      toast.error("Emergency report failed", "Could not submit the hazard report. Retry or use radio procedures.");
    } finally {
      setEmergencyReportBusy(false);
    }
  }, [emergencyReportBusy, tripId, addActivity, loadTripSnapshot, toast.error, toast.success]);

  /** De-escalation step 1: acknowledge. The alert stays active until cleared. */
  const acknowledgeMOB = useCallback(() => {
    setSafetyEvents((prev) =>
      prev.map((event) => (event.type === "MOB" || event.severity === "critical" ? { ...event, acknowledged: true } : event))
    );
    addActivity("Emergency alert acknowledged by bridge. Emergency status remains active.", "warning");
    toast.info("Alert acknowledged", "Emergency status stays active until explicitly cleared.");
  }, [addActivity, toast.info]);

  /** De-escalation step 2: clear (confirmed via modal). */
  const clearEmergency = useCallback(() => {
    setClearEmergencyOpen(false);
    setMobAlertActive(false);
    setVesselStatus("FISHING");
    addActivity("Emergency status cleared by bridge. Vessel status set to FISHING (local).", "success");
    toast.success("Emergency cleared", "Vessel status returned to FISHING.");
  }, [addActivity, toast.success]);

  /** Local-only vessel status flips; logged honestly as such. */
  const setLocalVesselStatus = useCallback(
    (status: VesselStatus) => {
      setVesselStatus(status);
      addActivity(`Vessel status set to ${status} on this tablet (local only).`, "info");
      toast.info(`Status: ${status}`, "Local tablet status is not synced to shore.");
    },
    [addActivity, toast.info]
  );

  const confirmAllHands = useCallback(() => {
    setAllHandsConfirmOpen(false);
    addActivity("All hands check confirmed by bridge (local log entry only).", "success");
    toast.success("All hands check logged", "Recorded in the local bridge log.");
  }, [addActivity, toast.success]);

  const saveNote = useCallback(() => {
    if (!noteInput.trim()) return;
    const note: ShiftNote = {
      id: generateId(),
      text: noteInput.trim(),
      author: "Bridge",
      createdAt: new Date().toISOString()
    };
    setShiftNotes((prev) => [note, ...prev]);
    setNoteInput("");
    addActivity("Shift note saved.", "info");
    toast.success("Note saved", "Shift note stored on this tablet.");
  }, [noteInput, addActivity, toast.success]);

  const gearStatusColors: Record<GearStatus, "success" | "info" | "default" | "danger" | "warning"> = {
    REGISTERED: "info",
    SET: "success",
    CHECKED: "info",
    HAULED: "default",
    MISSING: "danger",
    RECOVERED: "warning",
    REMOVED: "default"
  };

  const syncStateMap: Record<SyncState, "synced" | "syncing" | "pending" | "error" | "offline"> = {
    SYNCED: "synced",
    SYNCING: "syncing",
    PENDING: "pending",
    ERROR: "error"
  };

  const initialLoading = bootstrapStatus === "loading";
  const openCriticalEvents = safetyEvents.filter(
    (event) => !event.acknowledged && (event.severity === "critical" || event.severity === "high")
  ).length;
  const missingGearCount = gearItems.filter((gear) => gear.status === "MISSING").length;
  const watchReady = watchChecklist.comms && watchChecklist.deck && watchChecklist.weather && watchChecklist.gear;
  const highRisk = riskScore != null && (riskScore.tier === "HIGH" || riskScore.tier === "CRITICAL");
  const bridgePlaybook: Array<{ label: string; detail: string; tone: ActivityTone }> = [
    {
      label: riskScore == null ? "Risk estimate pending" : highRisk ? "Hold haul decision" : "Haul decision clear",
      detail:
        riskScore == null
          ? "No risk estimate has been loaded yet for this trip."
          : highRisk
            ? "Run mitigation review before changing vessel or gear state."
            : "Current estimated risk does not block routine gear work.",
      tone: riskScore == null ? "warning" : highRisk ? "danger" : "success"
    },
    {
      label: missingGearCount ? "Gear exception review" : "Gear state normal",
      detail: missingGearCount
        ? `${missingGearCount} missing gear item ${missingGearCount === 1 ? "needs" : "need"} assignment.`
        : "No missing gear in the loaded trip snapshot.",
      tone: missingGearCount ? "warning" : "success"
    },
    {
      label: openCriticalEvents ? "Safety acknowledgement" : "Safety events acknowledged",
      detail: openCriticalEvents
        ? `${openCriticalEvents} high-priority event ${openCriticalEvents === 1 ? "is" : "are"} awaiting acknowledgement.`
        : "No loaded critical events require acknowledgement.",
      tone: openCriticalEvents ? "danger" : "success"
    }
  ];

  return (
    <AppShell maxWidth="full">
      {toast.container}

      {mobAlertActive && (
        <Section>
          <MOBAlert vesselName={vesselName} onCallEmergency={() => void respondToEmergency()} />
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <Button
              variant="secondary"
              size="md"
              className="touch-action-btn"
              onClick={acknowledgeMOB}
              disabled={emergencyReportBusy}
            >
              <Icon name="Check" size={16} />
              Acknowledge Alert
            </Button>
            <Button
              variant="ghost"
              size="md"
              className="touch-action-btn"
              onClick={() => setClearEmergencyOpen(true)}
              disabled={emergencyReportBusy}
            >
              Clear Emergency...
            </Button>
          </div>
        </Section>
      )}

      <PageHeader
        title={vesselName}
        subtitle={formatTripLabel(tripId)}
        eyebrow="Vessel Operations"
        actions={
          <div className="flex items-center gap-4">
            <StatusBadge
              status={vesselStatus === "EMERGENCY" ? "error" : vesselStatus === "FISHING" ? "synced" : "pending"}
              pulse={vesselStatus === "EMERGENCY"}
            >
              {vesselStatus}
            </StatusBadge>
            <SyncIndicator
              state={isOnline ? syncStateMap[syncState] : "offline"}
              lastSync={lastSyncedAt ?? undefined}
              onRetry={() => (tripId ? void loadTripSnapshot(tripId) : void bootstrap())}
            />
          </div>
        }
      />

      {bootstrapStatus === "error" && (
        <Section>
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-[var(--radius-lg)] border bg-[var(--bg-secondary)]"
            style={{ borderColor: "var(--danger)" }}
          >
            <div>
              <p className="font-semibold" style={{ color: "var(--danger)" }}>
                Could not load trips
              </p>
              <p className="text-sm text-[var(--ink-muted)]">
                The trip list failed to load. Check the connection and retry.
              </p>
            </div>
            <Button variant="danger" size="md" className="touch-action-btn" onClick={() => void bootstrap()}>
              <Icon name="RefreshCw" size={16} />
              Retry
            </Button>
          </div>
        </Section>
      )}

      <Section>
        <div className="flex flex-wrap items-end gap-3">
          <div className="trip-select">
            <Select
              label="Active Trip"
              value={tripId}
              onChange={(event) => {
                const next = event.target.value;
                setTripId(next);
                if (next) void loadTripSnapshot(next);
              }}
              options={
                tripOptions.length === 0
                  ? [{ value: "", label: initialLoading ? "Loading trips..." : "No trips available" }]
                  : tripOptions.map((id) => ({ value: id, label: formatTripLabel(id) }))
              }
              hint={
                bootstrapStatus === "ready" && tripOptions.length === 0
                  ? "No trips found for this workspace. Start a trip from the shore console to see it here."
                  : undefined
              }
            />
          </div>
          <Button
            variant="secondary"
            size="md"
            className="touch-action-btn"
            onClick={() => void loadTripSnapshot(tripId)}
            disabled={!tripId}
          >
            <Icon name="RefreshCw" size={16} />
            Refresh
          </Button>
        </div>
      </Section>

      <Section>
        <div className="flex flex-wrap gap-3">
          <Button variant="danger" size="lg" onClick={triggerMOB} className="touch-action-btn">
            <Icon name="AlertTriangle" size={24} />
            MOB ALERT
          </Button>
          <Button variant="primary" size="lg" className="touch-action-btn" onClick={() => setLocalVesselStatus("HAULING")}>
            <Icon name="Anchor" size={24} />
            Start Haul
          </Button>
          <Button variant="secondary" size="lg" className="touch-action-btn" onClick={() => setLocalVesselStatus("FISHING")}>
            <Icon name="Fish" size={24} />
            Resume Fishing
          </Button>
          <Button variant="secondary" size="lg" className="touch-action-btn" onClick={() => setAllHandsConfirmOpen(true)}>
            <Icon name="Users" size={24} />
            All Hands Check
          </Button>
        </div>
      </Section>

      <Section title="Bridge Decision Support">
        <Grid cols={2} gap="md">
          <Card variant="glass">
            <CardHeader>
              <CardTitle>Operating Playbook</CardTitle>
              <CardDescription>Risk, gear, and incident signals translated into deck actions</CardDescription>
            </CardHeader>
            <CardContent>
              <Stack gap="sm">
                {bridgePlaybook.map((item) => (
                  <div key={item.label} className="flex items-start justify-between gap-3 p-3 rounded bg-[var(--bg-secondary)]">
                    <div>
                      <p className="font-semibold">{item.label}</p>
                      <p className="text-sm text-[var(--ink-muted)]">{item.detail}</p>
                    </div>
                    <Badge variant={item.tone === "info" ? "info" : item.tone} size="sm">
                      {item.tone === "danger" ? "Action" : item.tone === "warning" ? "Review" : "Clear"}
                    </Badge>
                  </div>
                ))}
              </Stack>
            </CardContent>
          </Card>

          <Card variant="glass">
            <CardHeader>
              <CardTitle>Watch Handoff</CardTitle>
              <CardDescription>Critical checks before bridge responsibility changes</CardDescription>
            </CardHeader>
            <CardContent>
              <Stack gap="sm">
                {[
                  ["comms", "Comms check complete"],
                  ["deck", "Deck crew accounted for"],
                  ["weather", "Weather window reviewed"],
                  ["gear", "Gear exceptions assigned"]
                ].map(([id, label]) => (
                  <label key={id} className="flex items-center justify-between gap-3 p-3 rounded bg-[var(--bg-secondary)] cursor-pointer">
                    <span className="text-sm">{label}</span>
                    <input
                      type="checkbox"
                      checked={watchChecklist[id as keyof typeof watchChecklist]}
                      onChange={(event) => setWatchChecklist((current) => ({ ...current, [id]: event.target.checked }))}
                      className="w-6 h-6"
                    />
                  </label>
                ))}
              </Stack>
              <div className="flex items-center justify-between mt-4">
                <StatusBadge status={watchReady ? "synced" : "pending"}>{watchReady ? "Ready" : "Incomplete"}</StatusBadge>
                <Button
                  variant="secondary"
                  size="md"
                  className="touch-action-btn"
                  onClick={() =>
                    addActivity(
                      watchReady
                        ? "Watch handoff logged with all checks complete (local log entry)."
                        : "Watch handoff logged with incomplete checks (local log entry).",
                      watchReady ? "success" : "warning"
                    )
                  }
                >
                  Log Handoff
                </Button>
              </div>
            </CardContent>
          </Card>
        </Grid>
      </Section>

      <Section>
        <Grid cols={3} gap="md">
          <Card variant="glass" className="md-col-span-2">
            <CardHeader>
              <CardTitle>Gear Status</CardTitle>
              <CardDescription>Tracking from the loaded trip snapshot</CardDescription>
            </CardHeader>
            <CardContent>
              {initialLoading ? (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[0, 1, 2].map((index) => (
                    <Skeleton key={index} variant="rectangular" height={148} />
                  ))}
                </div>
              ) : gearItems.length === 0 ? (
                <p className="text-sm text-[var(--ink-muted)]">
                  No gear records for this trip yet. Gear appears here once it is set and synced from deck devices.
                </p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {gearItems.map((gear) => (
                    <Card key={gear.gear_id} variant="outline" padding="sm">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-lg">{gear.gear_id}</span>
                        <Badge variant={gearStatusColors[gear.status]}>{gear.status}</Badge>
                      </div>
                      <p className="text-sm text-[var(--ink-muted)] mb-3">Updated: {gear.lastCheck}</p>
                      {gear.location && <p className="text-xs text-[var(--ink-muted)] mb-3">{gear.location}</p>}
                      <div className="flex gap-2">
                        {gear.status === "REGISTERED" && (
                          <Button
                            size="md"
                            variant="primary"
                            className="touch-action-btn"
                            loading={!!gearBusy[gear.gear_id]}
                            onClick={() => void transitionGear(gear.gear_id, "SET")}
                          >
                            Set
                          </Button>
                        )}
                        {gear.status === "SET" && (
                          <Button
                            size="md"
                            variant="primary"
                            className="touch-action-btn"
                            loading={!!gearBusy[gear.gear_id]}
                            onClick={() => void transitionGear(gear.gear_id, "CHECKED")}
                          >
                            Check
                          </Button>
                        )}
                        {gear.status === "CHECKED" && (
                          <Button
                            size="md"
                            variant="primary"
                            className="touch-action-btn"
                            loading={!!gearBusy[gear.gear_id]}
                            onClick={() => void transitionGear(gear.gear_id, "HAULED")}
                          >
                            Haul
                          </Button>
                        )}
                        {gear.status === "HAULED" && (
                          <Button
                            size="md"
                            variant="secondary"
                            className="touch-action-btn"
                            loading={!!gearBusy[gear.gear_id]}
                            onClick={() => void transitionGear(gear.gear_id, "SET")}
                          >
                            Reset
                          </Button>
                        )}
                        {gear.status === "MISSING" && (
                          <Button
                            size="md"
                            variant="secondary"
                            className="touch-action-btn"
                            loading={!!gearBusy[gear.gear_id]}
                            onClick={() => void transitionGear(gear.gear_id, "RECOVERED")}
                          >
                            Recover
                          </Button>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card variant="glass">
            <CardHeader>
              <CardTitle>Risk Assessment</CardTitle>
              <CardDescription>
                Estimate only: preset workload and weather assumptions plus the live open-incident count.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center gap-2 p-4">
                {initialLoading ? (
                  <Skeleton variant="rectangular" width={140} height={36} />
                ) : riskScore ? (
                  <>
                    <RiskBadge tier={riskScore.tier} score={riskScore.score} size="lg" />
                    <p className="text-xs text-[var(--ink-muted)]">Estimated risk, not a live sensor reading.</p>
                  </>
                ) : (
                  <p className="text-sm text-[var(--ink-muted)]">
                    Risk estimate unavailable. Refresh the trip to recalculate.
                  </p>
                )}
              </div>
              <Divider className="my-4" />
              <div className="space-y-3">
                <p className="text-sm font-semibold text-[var(--ink-secondary)]">Active Safety Events</p>
                {initialLoading ? (
                  <Stack gap="sm">
                    <Skeleton variant="rectangular" height={56} />
                    <Skeleton variant="rectangular" height={56} />
                  </Stack>
                ) : safetyEvents.length > 0 ? (
                  safetyEvents.slice(0, 3).map((event) => (
                    <div key={event.id} className="p-3 rounded bg-[var(--bg-secondary)]">
                      <div className="flex items-center gap-2">
                        <Badge variant={event.severity === "critical" ? "danger" : event.severity === "high" ? "warning" : "info"}>
                          {event.type}
                        </Badge>
                        {event.acknowledged && <Badge variant="success">ACK</Badge>}
                      </div>
                      <p className="text-sm mt-2">{event.message}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-[var(--ink-muted)]">
                    No active safety events for this trip. New incidents appear here after the next sync.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </Grid>
      </Section>

      <Section>
        <Grid cols={2} gap="md">
          <Card variant="glass">
            <CardHeader>
              <CardTitle>Connected Devices</CardTitle>
              <CardDescription>Operational devices assigned to this workspace</CardDescription>
            </CardHeader>
            <CardContent>
              <Stack gap="sm">
                {initialLoading ? (
                  <>
                    <Skeleton variant="rectangular" height={60} />
                    <Skeleton variant="rectangular" height={60} />
                    <Skeleton variant="rectangular" height={60} />
                  </>
                ) : (
                  <>
                    {crew.length === 0 && (
                      <p className="text-sm text-[var(--ink-muted)]">
                        No device records available. Devices appear here once they are registered to this workspace.
                      </p>
                    )}
                    {crew.map((member) => (
                      <div key={member.id} className="flex items-center justify-between p-3 rounded bg-[var(--bg-secondary)]">
                        <div>
                          <p className="font-medium">{member.name}</p>
                          <p className="text-sm text-[var(--ink-muted)]">{member.role}</p>
                        </div>
                        <StatusBadge
                          status={member.status === "ON_DECK" ? "synced" : member.status === "BELOW" ? "pending" : "inactive"}
                        >
                          {member.status.replace("_", " ")}
                        </StatusBadge>
                      </div>
                    ))}
                  </>
                )}
              </Stack>
            </CardContent>
          </Card>

          <Card variant="glass">
            <CardHeader>
              <CardTitle>Bridge Log</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                label="Shift note"
                value={noteInput}
                onChange={(event) => setNoteInput(event.target.value)}
                placeholder="Enter shift notes..."
                rows={3}
              />
              <Button size="md" className="mt-3 touch-action-btn" onClick={saveNote} disabled={!noteInput.trim()}>
                Save Entry
              </Button>

              {shiftNotes.length > 0 && (
                <Stack gap="sm" className="mt-4">
                  <p className="text-xs font-semibold text-[var(--ink-secondary)]">Recent Entries</p>
                  {shiftNotes.slice(0, 4).map((note) => (
                    <div key={note.id} className="p-2 rounded bg-[var(--bg-secondary)]">
                      <p className="text-sm">{note.text}</p>
                      <p className="text-xs text-[var(--ink-muted)] mt-1">
                        {note.author} - {new Date(note.createdAt).toLocaleTimeString()}
                      </p>
                    </div>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Section>

      <Section title="Activity Log">
        <ActivityList
          items={activityLog.slice(0, 15).map((item) => ({
            id: item.id,
            title: item.message,
            timestamp: new Date(item.createdAt),
            type: item.tone === "danger" ? "danger" : item.tone === "warning" ? "warning" : item.tone === "success" ? "success" : "info"
          }))}
        />
      </Section>

      <div className="mt-6 p-4 bg-[var(--bg-primary)] border border-[var(--border-default)] rounded-[var(--radius-lg)]">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <ConnectionStatus connected={isOnline} lastSync={lastSyncedAt ?? undefined} />
          <div className="flex items-center gap-4">
            <span className="text-sm text-[var(--ink-muted)]">
              Last update: {lastSyncedAt ? lastSyncedAt.toLocaleTimeString() : "never"}
            </span>
            <Button
              variant="ghost"
              size="md"
              className="touch-action-btn"
              onClick={() => void loadTripSnapshot(tripId)}
              disabled={!tripId}
            >
              <Icon name="RefreshCw" size={16} />
              Sync
            </Button>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={clearEmergencyOpen}
        onClose={() => setClearEmergencyOpen(false)}
        onConfirm={clearEmergency}
        title="Clear emergency status?"
        message="This stands down the MOB alert on this tablet and returns vessel status to FISHING. Only clear once the person is recovered or command has transferred the response."
        confirmText="Clear Emergency"
        cancelText="Keep Alert Active"
        variant="danger"
      />

      <ConfirmModal
        open={allHandsConfirmOpen}
        onClose={() => setAllHandsConfirmOpen(false)}
        onConfirm={confirmAllHands}
        title="Log all hands check?"
        message="Confirm every crew member has been physically sighted and accounted for. This records a local bridge log entry only."
        confirmText="Log Check"
      />
    </AppShell>
  );
}
