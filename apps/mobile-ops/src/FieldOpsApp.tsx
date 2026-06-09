import { useEffect, useMemo, useState } from "react";
import {
  appendDraftEvent,
  appendCachedServerEvents,
  clearDraftEvents,
  clearSyncCursor,
  hasDeviceChainRejection,
  nextSyncUploadBatch,
  readDraftEvents,
  readSyncCursor,
  rejectedReasonCodes,
  removeDraftEvent,
  remainingDraftEventsAfterBatchedUpload,
  replaceDraftEvents,
  updateDeviceChainHeadsFromAccepted,
  writeSyncCursor
} from "./lib/offlineLog";
import { createSignedDraftEvent } from "./lib/draftEvent";
import {
  ackSyncCursor,
  completeCheckin,
  downloadEvents,
  getSession,
  getTripGear,
  listHazards,
  listTrips,
  parseDevToken,
  recommendTraining,
  registerCurrentDevice,
  reportHazard,
  scheduleCheckin,
  scoreRisk,
  transitionGear,
  uploadEvents,
  type GearRow,
  type HazardRow,
  type RiskScoreResult,
  type TrainingRecommendation
} from "./lib/api";
import {
  clearDeviceIdentity,
  generateAndStoreDeviceIdentity,
  readDeviceIdentity,
  type DeviceIdentitySummary
} from "./lib/deviceIdentity";
import { type OpsEvent } from "@northline/shared";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Input,
  Textarea,
  Select,
  Badge,
  StatusBadge,
  RiskBadge,
  Spinner,
  LoadingOverlay,
  Skeleton,
  StatusIndicator,
  ConnectionStatus,
  SyncIndicator,
  SyncProgress,
  SafetyAlert,
  MOBAlert,
  AppShell,
  PageHeader,
  Section,
  Grid,
  Stack,
  Divider,
  Navigation,
  BottomNavigation,
  Breadcrumbs,
  Icon,
  IconButton,
  Checklist,
  ActivityList,
  List,
  type IconName,
} from "@northline/ui";
import "@northline/ui/styles.css";

type Mode = "OFFSHORE" | "ICE";
type Module = "safety" | "operations" | "hazards" | "learning";
type SyncState = "SYNCED" | "SYNCING" | "PENDING" | "ERROR";
type Transition = "SET" | "CHECKED" | "HAULED" | "MISSING" | "RECOVERED" | "REMOVED";

interface ShiftNote {
  id: string;
  text: string;
  createdAt: string;
}

interface ActivityItem {
  id: string;
  text: string;
  createdAt: string;
  tone: "info" | "success" | "warning" | "danger";
}

interface AuthIdentity {
  tenantId: string;
  actorId: string;
  role: string;
}

interface Preferences {
  mode: Mode;
  tripId: string;
  activeModule: Module;
  pinnedModules: Module[];
}

interface QuickCommand {
  id: string;
  label: string;
  hint: string;
  run: () => void | Promise<void>;
}

interface SyncRepairReport {
  attempted: number;
  accepted: number;
  rejected: Array<{ event_id?: string; reason: string }>;
  deviceChainIssue: boolean;
  checkedAt: string;
}

const modules: Array<{ id: Module; label: string }> = [
  { id: "safety", label: "Safety" },
  { id: "operations", label: "Operations" },
  { id: "hazards", label: "Hazards" },
  { id: "learning", label: "Training" }
];

const moduleMeta: Record<Module, { label: string; description: string; icon: IconName }> = {
  safety: {
    label: "Safety",
    description: "Gate checks, check-ins, and emergency actions",
    icon: "ShieldCheck"
  },
  operations: {
    label: "Operations",
    description: "Risk scoring, gear state, and route confidence",
    icon: "Radar"
  },
  hazards: {
    label: "Hazards",
    description: "Shared hazard feed and field reports",
    icon: "AlertTriangle"
  },
  learning: {
    label: "Training",
    description: "Assignments matched to recent operating signals",
    icon: "GraduationCap"
  }
};

const PREFERENCES_KEY = "northline.mobile_ops.preferences";
const NOTES_KEY = "northline.mobile_ops.shift_notes";
const ACTIVITY_KEY = "northline.mobile_ops.recent_activity";
const MAX_NOTES = 30;
const MAX_ACTIVITY = 20;

function readStorageJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatEventLabel(eventType: string) {
  const labels: Record<string, string> = {
    SAFETY_PROMPT_ACKED: "Safety checklist"
  };
  return labels[eventType] ?? eventType.replace(/_/g, " ").toLowerCase().replace(/^\w/, (char) => char.toUpperCase());
}

function readInitialAuthIdentity(): AuthIdentity {
  const auth = parseDevToken();
  return { tenantId: auth.tenantId, actorId: auth.actorId, role: auth.role };
}

function MetricTile({
  label,
  value,
  tone = "neutral",
  icon
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "good" | "warning" | "danger";
  icon: IconName;
}) {
  return (
    <div className={`metric-tile ${tone}`}>
      <span className="metric-icon"><Icon name={icon} size={20} /></span>
      <span>
        <strong>{value}</strong>
        <small>{label}</small>
      </span>
    </div>
  );
}

export function FieldOpsApp() {
  const initialPrefs = useMemo<Preferences>(() => readStorageJson<Preferences>(PREFERENCES_KEY, {
    mode: "OFFSHORE",
    tripId: "",
    activeModule: "safety",
    pinnedModules: ["safety", "operations"]
  }), []);

  const [mode, setMode] = useState<Mode>(initialPrefs.mode);
  const [activeModule, setActiveModule] = useState<Module>(initialPrefs.activeModule);
  const [pinnedModules, setPinnedModules] = useState<Module[]>(initialPrefs.pinnedModules);
  const [syncState, setSyncState] = useState<SyncState>("SYNCED");
  const [statusMessage, setStatusMessage] = useState("Ready. Select a module to continue.");
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [authIdentity, setAuthIdentity] = useState<AuthIdentity>(() => readInitialAuthIdentity());
  const [deviceIdentity, setDeviceIdentity] = useState<DeviceIdentitySummary>(() => readDeviceIdentity());
  const [deviceRegistered, setDeviceRegistered] = useState(false);

  const [tripId, setTripId] = useState(initialPrefs.tripId);
  const [gearId, setGearId] = useState("STR-021");
  const [transition, setTransition] = useState<Transition>("CHECKED");
  const [checkinDone, setCheckinDone] = useState(false);
  const [checkinId, setCheckinId] = useState(() => `chk_${crypto.randomUUID().slice(0, 8)}`);
  const [risk, setRisk] = useState<RiskScoreResult | null>(null);
  const [training, setTraining] = useState<TrainingRecommendation[]>([]);
  const [hazards, setHazards] = useState<HazardRow[]>([]);
  const [gearRows, setGearRows] = useState<GearRow[]>([]);
  const [heaterOn, setHeaterOn] = useState(true);
  const [draftVersion, setDraftVersion] = useState(0);
  const [drafts, setDrafts] = useState<OpsEvent<Record<string, unknown>>[]>([]);
  const [checklist, setChecklist] = useState({
    pinch: false,
    tension: false,
    comms: false,
    ppe: false,
    deck: false
  });

  const [noteInput, setNoteInput] = useState("");
  const [shiftNotes, setShiftNotes] = useState<ShiftNote[]>(() => readStorageJson<ShiftNote[]>(NOTES_KEY, []));
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>(() =>
    readStorageJson<ActivityItem[]>(ACTIVITY_KEY, [])
  );
  const [commandQuery, setCommandQuery] = useState("");
  const [syncRepairReport, setSyncRepairReport] = useState<SyncRepairReport | null>(null);

  const offshoreReady = checklist.pinch && checklist.tension && checklist.comms && checklist.ppe && checklist.deck;
  const effectiveSyncState: SyncState = drafts.length > 0 && syncState === "SYNCED" ? "PENDING" : syncState;
  const syncClass = `sync-pill ${effectiveSyncState.toLowerCase()}`;
  const headerSubtitle = !isOnline
    ? "Offline mode active"
    : drafts.length > 0
      ? `${drafts.length} draft ${drafts.length === 1 ? "event" : "events"} waiting to sync`
      : "Online and synced";
  const deviceSigningReady = deviceIdentity.hasPrivateKey && Boolean(deviceIdentity.deviceId);
  const todayNotes = shiftNotes.slice(0, 4);
  const trackActivity = useMemo(
    () => (text: string, tone: ActivityItem["tone"] = "info") => {
      setRecentActivity((previous) =>
        [{ id: crypto.randomUUID(), text, tone, createdAt: new Date().toISOString() }, ...previous].slice(0, MAX_ACTIVITY)
      );
    },
    []
  );

  useEffect(() => {
    localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({ mode, tripId, activeModule, pinnedModules } satisfies Preferences)
    );
  }, [mode, tripId, activeModule, pinnedModules]);

  useEffect(() => {
    localStorage.setItem(NOTES_KEY, JSON.stringify(shiftNotes));
  }, [shiftNotes]);

  useEffect(() => {
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(recentActivity));
  }, [recentActivity]);

  useEffect(() => {
    let mounted = true;
    void getSession()
      .then((session) => {
        if (!mounted) return;
        setAuthIdentity({
          tenantId: session.tenant_id,
          actorId: session.actor_id,
          role: session.role
        });
      })
      .catch(() => {
        trackActivity("Session identity refresh failed; using local token identity.", "warning");
      });
    return () => {
      mounted = false;
    };
  }, [trackActivity]);

  useEffect(() => {
    let mounted = true;
    void readDraftEvents().then((events) => {
      if (mounted) setDrafts(events);
    });
    return () => {
      mounted = false;
    };
  }, [draftVersion, syncState]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function ensureTripContext() {
      const currentTripId = tripId.trim();

      try {
        const response = await listTrips();
        if (cancelled) return;

        const nextTripModes = Object.fromEntries(response.trips.map((trip) => [trip.trip_id, trip.mode as Mode]));
        const currentMode = currentTripId ? nextTripModes[currentTripId] : undefined;
        if (currentTripId && currentMode === mode) {
          return;
        }

        const matchingMode =
          response.trips.find((trip) => trip.mode === mode && trip.status === "ACTIVE") ??
          response.trips.find((trip) => trip.mode === mode) ??
          response.trips[0];

        if (matchingMode?.trip_id) {
          if (matchingMode.trip_id !== currentTripId) {
            setTripId(matchingMode.trip_id);
            setStatusMessage(`Loaded active ${mode.toLowerCase()} trip.`);
            trackActivity(`Loaded active ${mode.toLowerCase()} trip.`, "info");
          }
        } else if (!currentTripId) {
          setStatusMessage("No trips are available for the selected mode.");
        }
      } catch {
        if (cancelled) return;
        setStatusMessage("Enter a trip id to start syncing field workflows.");
      }
    }

    ensureTripContext();
    return () => {
      cancelled = true;
    };
  }, [mode, tripId, trackActivity]);

  async function runWithSync(
    task: () => Promise<void>,
    options?: {
      pendingOnError?: boolean;
      errorMessage?: string;
      successMessage?: string;
      successActivity?: string;
      errorActivity?: string;
    }
  ) {
    try {
      setSyncState("SYNCING");
      await task();
      setSyncState("SYNCED");
      if (options?.successMessage) {
        setStatusMessage(options.successMessage);
      }
      if (options?.successActivity) {
        trackActivity(options.successActivity, "success");
      }
    } catch {
      setSyncState(options?.pendingOnError ? "PENDING" : "ERROR");
      if (options?.errorMessage) {
        setStatusMessage(options.errorMessage);
      }
      if (options?.errorActivity) {
        trackActivity(options.errorActivity, options?.pendingOnError ? "warning" : "danger");
      }
    }
  }

  async function loadHazards() {
    const response = await listHazards(mode === "ICE" ? "GROUP" : "ORG");
    setHazards(response.hazards ?? []);
  }

  async function loadGear() {
    if (mode !== "OFFSHORE" || !tripId.trim()) {
      setGearRows([]);
      return;
    }
    const response = await getTripGear(tripId);
    setGearRows(response.gear ?? []);
  }

  async function createDraftEvent(eventType: string, payload: Record<string, unknown>): Promise<OpsEvent<Record<string, unknown>>> {
    return createSignedDraftEvent(authIdentity, deviceIdentity, eventType, payload, {
      allowDevSignature: import.meta.env.DEV
    });
  }

  async function handleGenerateDeviceIdentity() {
    const next = await generateAndStoreDeviceIdentity(authIdentity.actorId);
    setDeviceIdentity(next);
    setDeviceRegistered(false);
    setStatusMessage("Device signing key generated. Register the public key before production sync.");
    trackActivity("Generated local device signing key.", "success");
  }

  async function handleRegisterDeviceIdentity() {
    if (!deviceIdentity.deviceId || !deviceIdentity.publicKey) {
      setStatusMessage("Generate a device signing key before registration.");
      trackActivity("Device registration blocked: missing local key.", "warning");
      return;
    }

    await runWithSync(
      async () => {
        await registerCurrentDevice({
          device_id: deviceIdentity.deviceId as string,
          public_key: deviceIdentity.publicKey as string,
          key_version: 1
        });
        setDeviceRegistered(true);
      },
      {
        successMessage: "Device signing key registered for this user.",
        successActivity: "Registered current device signing key.",
        errorMessage: "Device key registration failed. Try again when connected.",
        errorActivity: "Device key registration failed."
      }
    );
  }

  function handleClearDeviceIdentity() {
    clearDeviceIdentity();
    setDeviceIdentity(readDeviceIdentity());
    setDeviceRegistered(false);
    setStatusMessage("Device signing key removed from this browser.");
    trackActivity("Removed local device signing key.", "warning");
  }

  async function refreshAll() {
    await runWithSync(
      async () => {
        await loadHazards();
        if (tripId.trim()) {
          await loadGear();
        } else {
          setGearRows([]);
        }
      },
      {
        pendingOnError: true,
        successMessage: "Data refreshed.",
        successActivity: "Refreshed hazards and gear state.",
        errorMessage: "Some data could not be refreshed. Offline values preserved.",
        errorActivity: "Refresh failed. Offline cache retained."
      }
    );
  }

  useEffect(() => {
    void refreshAll();
  }, [mode, tripId]);

  async function handleScheduleCheckin() {
    if (!tripId.trim()) {
      setStatusMessage("Enter a trip id before scheduling check-ins.");
      trackActivity("Check-in scheduling blocked: missing trip id.", "warning");
      return;
    }
    await runWithSync(
      async () => {
        const nextCheckinId = `chk_${crypto.randomUUID().slice(0, 8)}`;
        await scheduleCheckin({
          checkin_id: nextCheckinId,
          trip_id: tripId,
          due_at: new Date(Date.now() + 20 * 60 * 1000).toISOString()
        });
        setCheckinId(nextCheckinId);
        setCheckinDone(false);
      },
      {
        successMessage: "Check-in scheduled for the next 20-minute window.",
        successActivity: "Scheduled operator check-in.",
        errorMessage: "Check-in schedule failed. Try again when signal improves.",
        errorActivity: "Check-in scheduling failed."
      }
    );
  }

  async function handleCompleteCheckin() {
    if (!tripId.trim()) {
      setStatusMessage("Enter a trip id before completing check-ins.");
      trackActivity("Check-in completion blocked: missing trip id.", "warning");
      return;
    }
    await runWithSync(
      async () => {
        await completeCheckin({ checkin_id: checkinId, trip_id: tripId });
        setCheckinDone(true);
      },
      {
        successMessage: "Operator check-in confirmed.",
        successActivity: "Completed operator check-in.",
        errorMessage: "Could not send check-in. Try again when signal improves.",
        errorActivity: "Check-in completion failed."
      }
    );
  }

  async function handleRiskScore() {
    await runWithSync(
      async () => {
        const result = await scoreRisk(mode, {
          workloadIntensity: mode === "OFFSHORE" ? (offshoreReady ? 54 : 74) : 46,
          weatherSeverity: mode === "OFFSHORE" ? 60 : 56,
          nearMissCount: mode === "OFFSHORE" ? (drafts.length > 2 ? 2 : 1) : 1,
          daylightHoursLeft: mode === "OFFSHORE" ? 3.5 : 1.8,
          soloOperator: mode === "ICE",
          checkinMisses: mode === "ICE" && !checkinDone ? 1 : 0
        });
        setRisk(result);
      },
      {
        successMessage: "Risk score recalculated.",
        successActivity: "Computed updated risk profile.",
        errorMessage: "Risk scoring unavailable. Keep operating in offline-safe mode.",
        errorActivity: "Risk computation failed."
      }
    );
  }

  async function handleTraining() {
    await runWithSync(
      async () => {
        const response = await recommendTraining(mode, {
          missed_checkins: checkinDone ? 0 : 1,
          overdue_gear_checks: mode === "OFFSHORE" ? 1 : 0,
          near_miss_count: drafts.length > 3 ? 1 : 0,
          compliance_errors: mode === "OFFSHORE" && !offshoreReady ? 1 : 0
        });
        setTraining(response.recommended ?? []);
      },
      {
        pendingOnError: true,
        successMessage: "Training recommendations updated.",
        successActivity: "Generated training recommendations.",
        errorMessage: "Training service is offline. Recommendations not updated.",
        errorActivity: "Training recommendations unavailable."
      }
    );
  }

  async function handleReportHazard(severity = mode === "OFFSHORE" ? 3 : 4) {
    if (!tripId.trim()) {
      setStatusMessage("Enter a trip id before reporting hazards.");
      trackActivity("Hazard reporting blocked: missing trip id.", "warning");
      return;
    }
    await runWithSync(
      async () => {
        await reportHazard({
          hazard_id: `hz_${crypto.randomUUID().slice(0, 8)}`,
          trip_id: tripId,
          hazard_type: mode === "OFFSHORE" ? "WEATHER" : "RIDGE",
          severity,
          confidence: 0.76,
          sharing_scope: mode === "OFFSHORE" ? "ORG" : "GROUP",
          location: { lat: 55.35, lon: -166.21 }
        });
        await loadHazards();
      },
      {
        successMessage: "Hazard submitted and feed updated.",
        successActivity: severity >= 5 ? "Emergency hazard report sent." : "Hazard report submitted.",
        errorMessage: "Hazard report failed. Try again when signal improves.",
        errorActivity: "Hazard report failed."
      }
    );
  }

  async function handleGearTransition() {
    if (mode !== "OFFSHORE") return;
    if (!tripId.trim()) {
      setStatusMessage("Enter a trip id before transitioning gear.");
      trackActivity("Gear transition blocked: missing trip id.", "warning");
      return;
    }
    await runWithSync(
      async () => {
        await transitionGear({
          trip_id: tripId,
          gear_id: gearId,
          transition,
          note: `FieldOps transition ${transition}`
        });
        await loadGear();
      },
      {
        successMessage: `Gear ${gearId} updated to ${transition}.`,
        successActivity: `Gear ${gearId} transitioned to ${transition}.`,
        errorMessage: "Gear transition failed. Try again when signal improves.",
        errorActivity: "Gear transition failed."
      }
    );
  }

  async function handleAuthorizeHaul() {
    if (!tripId.trim()) {
      setStatusMessage("Enter a trip id before authorizing haul.");
      trackActivity("Haul authorization blocked: missing trip id.", "warning");
      return;
    }
    try {
      const event = await createDraftEvent("SAFETY_PROMPT_ACKED", { trip_id: tripId, checklist });
      await appendDraftEvent(event);
      setDraftVersion((value) => value + 1);
      setSyncState("PENDING");
      setStatusMessage("Checklist captured offline and queued for sync.");
      trackActivity("Captured haul authorization checklist offline.", "warning");
    } catch {
      setSyncState("ERROR");
      setStatusMessage("Device signing key is required before queueing production offline events.");
      trackActivity("Offline event capture blocked: missing device signing key.", "danger");
    }
  }

  async function pullServerEventsAfterQueueSync() {
    const currentCursor = readSyncCursor();
    const response = await downloadEvents(currentCursor, 500);
    if (response.cursor && response.cursor !== currentCursor) {
      await appendCachedServerEvents(response.events);
      writeSyncCursor(response.cursor);
      await ackSyncCursor(response.cursor);
    }
    return response.events.length;
  }

  async function handleSyncDrafts() {
    if (!drafts.length) {
      setStatusMessage("No queued draft events.");
      return;
    }
    try {
      setSyncState("SYNCING");
      const batch = nextSyncUploadBatch(drafts);
      const response = await uploadEvents(batch, readSyncCursor());
      updateDeviceChainHeadsFromAccepted(batch, response.accepted);
      const rejectionCodes = rejectedReasonCodes(response);
      setSyncRepairReport({
        attempted: batch.length,
        accepted: response.accepted?.length ?? response.accepted_count ?? 0,
        rejected: response.rejected.map((item, index) => ({
          event_id: item.event_id,
          reason: rejectionCodes[index] ?? (typeof item.reason === "string" ? item.reason : JSON.stringify(item.reason))
        })),
        deviceChainIssue: hasDeviceChainRejection(response),
        checkedAt: new Date().toISOString()
      });
      const remaining = remainingDraftEventsAfterBatchedUpload(drafts, response);
      await replaceDraftEvents(remaining);
      setDraftVersion((value) => value + 1);
      if (remaining.length > 0) {
        setSyncState("PENDING");
        if (hasDeviceChainRejection(response)) {
          setStatusMessage(`Device event chain needs reconciliation. ${remaining.length} drafts still queued.`);
          trackActivity("Device chain rejection returned during queue sync.", "danger");
        } else {
          setStatusMessage(`Partial sync complete. ${remaining.length} drafts still queued. ${rejectionCodes.join(", ")}`);
          trackActivity("Partial queue sync completed.", "warning");
        }
      } else {
        try {
          const downloadedCount = await pullServerEventsAfterQueueSync();
          setSyncState("SYNCED");
          setStatusMessage(
            downloadedCount > 0
              ? `Draft queue synced. Pulled ${downloadedCount} server ${downloadedCount === 1 ? "event" : "events"}.`
              : "Draft queue synced."
          );
          trackActivity(
            downloadedCount > 0
              ? `Uploaded queued offline events and acknowledged ${downloadedCount} server events.`
              : "Uploaded queued offline events.",
            "success"
          );
        } catch {
          setSyncState("ERROR");
          setStatusMessage("Draft queue uploaded, but server download checkpoint failed.");
          trackActivity("Queued events uploaded; download checkpoint failed.", "danger");
        }
      }
    } catch {
      setSyncState("PENDING");
      setStatusMessage("Draft sync failed. Events remain queued.");
      trackActivity("Draft upload failed.", "danger");
    }
  }

  function handleExportDrafts() {
    const blob = new Blob([JSON.stringify(drafts, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `northline-draft-events-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    trackActivity("Exported queued draft events.", "info");
  }

  async function handleRemoveDraft(eventId: string) {
    await removeDraftEvent(eventId);
    setDraftVersion((value) => value + 1);
    trackActivity(`Removed queued event ${eventId.slice(0, 8)}.`, "info");
  }

  async function handleClearQueue() {
    await clearDraftEvents();
    setDraftVersion((value) => value + 1);
    setSyncRepairReport(null);
    setStatusMessage("Draft queue cleared.");
    trackActivity("Cleared local draft queue.", "warning");
  }

  async function handleReconcileSyncChain() {
    try {
      setSyncState("SYNCING");
      clearSyncCursor();
      const response = await downloadEvents(null, 1000);
      await appendCachedServerEvents(response.events);
      if (response.cursor) {
        writeSyncCursor(response.cursor);
        await ackSyncCursor(response.cursor);
      }
      setSyncState(drafts.length ? "PENDING" : "SYNCED");
      setStatusMessage(`Reconciled server event history. Retry sync with ${drafts.length} queued drafts.`);
      trackActivity(`Reconciled ${response.events.length} server events for sync repair.`, "success");
    } catch {
      setSyncState("ERROR");
      setStatusMessage("Sync repair failed. Keep the queue exported until connectivity and device trust are verified.");
      trackActivity("Sync repair checkpoint failed.", "danger");
    }
  }

  async function handleQuarantineRejectedDrafts() {
    const rejectedIds = new Set(syncRepairReport?.rejected.map((item) => item.event_id).filter(Boolean));
    if (!rejectedIds.size) {
      setStatusMessage("No specific rejected event ids to quarantine.");
      return;
    }

    const remaining = drafts.filter((event) => !rejectedIds.has(event.event_id));
    await replaceDraftEvents(remaining);
    setDraftVersion((value) => value + 1);
    setStatusMessage(`Quarantined ${rejectedIds.size} rejected draft ${rejectedIds.size === 1 ? "event" : "events"}.`);
    trackActivity(`Quarantined ${rejectedIds.size} rejected draft events after sync review.`, "warning");
  }

  function togglePin(module: Module) {
    setPinnedModules((current) => {
      if (current.includes(module)) {
        return current.filter((value) => value !== module);
      }
      return [module, ...current].slice(0, modules.length);
    });
  }

  function saveShiftNote() {
    const value = noteInput.trim();
    if (!value) return;
    setShiftNotes((current) =>
      [{ id: crypto.randomUUID(), text: value, createdAt: new Date().toISOString() }, ...current].slice(0, MAX_NOTES)
    );
    setNoteInput("");
    trackActivity("Saved shift handoff note.", "success");
  }

  function deleteShiftNote(noteId: string) {
    setShiftNotes((current) => current.filter((note) => note.id !== noteId));
    trackActivity("Removed shift note.", "info");
  }

  async function copyHandoffSummary() {
    const summary = [
      `Northline Field Ops Handoff`,
      `Mode: ${mode}`,
      `Trip: ${tripId}`,
      `Sync State: ${syncState}`,
      `Queued Draft Events: ${drafts.length}`,
      `Risk: ${risk ? `${risk.tier} (${risk.score})` : "Not scored"}`,
      `Latest Note: ${shiftNotes[0]?.text ?? "None"}`
    ].join("\n");

    try {
      await navigator.clipboard.writeText(summary);
      setStatusMessage("Handoff summary copied to clipboard.");
      trackActivity("Copied shift handoff summary.", "success");
    } catch {
      setStatusMessage("Clipboard unavailable. Summary could not be copied.");
      trackActivity("Clipboard copy failed for handoff summary.", "warning");
    }
  }

  const quickCommands: QuickCommand[] = [
    { id: "risk", label: "Run Risk Score", hint: "Operations", run: handleRiskScore },
    { id: "refresh", label: "Refresh All Data", hint: "Sync", run: refreshAll },
    { id: "sync", label: "Sync Draft Queue", hint: "Offline", run: handleSyncDrafts },
    { id: "repair", label: "Repair Sync Chain", hint: "Recovery", run: handleReconcileSyncChain },
    { id: "hazard", label: "Report Hazard", hint: "Safety", run: () => handleReportHazard() },
    { id: "emergency", label: "Emergency Alert", hint: "Critical", run: () => handleReportHazard(5) },
    { id: "training", label: "Generate Training", hint: "Learning", run: handleTraining },
    { id: "open-safety", label: "Open Safety Module", hint: "Navigation", run: () => setActiveModule("safety") },
    { id: "open-ops", label: "Open Operations Module", hint: "Navigation", run: () => setActiveModule("operations") }
  ];

  const filteredCommands = commandQuery.trim()
    ? quickCommands.filter((command) =>
        `${command.label} ${command.hint}`.toLowerCase().includes(commandQuery.trim().toLowerCase())
      )
    : [];

  const pinned = modules.filter((module) => pinnedModules.includes(module.id));
  const checklistItems = [
    { id: "pinch", label: "Pinch zones clear", checked: checklist.pinch, required: true },
    { id: "tension", label: "Line tension confirmed", checked: checklist.tension, required: true },
    { id: "comms", label: "Comms verified", checked: checklist.comms, required: true },
    { id: "ppe", label: "PPE complete", checked: checklist.ppe, required: true },
    { id: "deck", label: "Deck clear", checked: checklist.deck, required: true }
  ];
  const completeChecks = checklistItems.filter((item) => item.checked).length;
  const completionPercent = Math.round((completeChecks / checklistItems.length) * 100);
  const riskTone = risk?.tier === "CRITICAL" || risk?.tier === "HIGH" ? "danger" : risk?.tier === "MODERATE" ? "warning" : "good";
  const activeMeta = moduleMeta[activeModule];

  function renderSafetyModule() {
    return (
      <Grid cols={2} gap="lg">
        <Card className="mission-card" glow={mode === "OFFSHORE" && offshoreReady}>
          <CardHeader>
            <div>
              <CardTitle>Mission safety gate</CardTitle>
              <CardDescription>{mode === "OFFSHORE" ? "Haul authorization readiness" : "Solo operator check-in cadence"}</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => togglePin("safety")}>
              <Icon name={pinnedModules.includes("safety") ? "PinOff" : "Pin"} size={16} />
              {pinnedModules.includes("safety") ? "Unpin" : "Pin"}
            </Button>
          </CardHeader>

          {mode === "OFFSHORE" ? (
            <>
              <div className="readiness-ring" aria-label={`${completionPercent}% ready`}>
                <div style={{ "--progress": `${completionPercent}%` } as React.CSSProperties}>
                  <strong>{completionPercent}%</strong>
                  <span>{completeChecks}/{checklistItems.length} checks</span>
                </div>
              </div>
              <Checklist
                items={checklistItems}
                onToggle={(id) => setChecklist((s) => ({ ...s, [id]: !s[id as keyof typeof s] }))}
              />
              <Button fullWidth disabled={!offshoreReady} onClick={handleAuthorizeHaul} rightIcon={<Icon name="ArrowRight" size={16} />}>
                {offshoreReady ? "Authorize haul cycle" : "Complete all checks"}
              </Button>
            </>
          ) : (
            <>
              <div className="operator-status">
                <MetricTile label="check-in window" value="20m" tone="warning" icon="Timer" />
                <MetricTile label="heater reminders" value={heaterOn ? "On" : "Paused"} tone={heaterOn ? "good" : "neutral"} icon="Flame" />
              </div>
              <div className="action-row">
                <Button onClick={handleScheduleCheckin} leftIcon={<Icon name="CalendarClock" size={16} />}>Schedule check-in</Button>
                <Button variant={checkinDone ? "success" : "secondary"} onClick={handleCompleteCheckin} leftIcon={<Icon name="CheckCircle2" size={16} />}>
                  {checkinDone ? "Check-in sent" : "I am safe"}
                </Button>
              </div>
              <label className="toggle">
                <input type="checkbox" checked={heaterOn} onChange={(e) => setHeaterOn(e.target.checked)} />
                Heater alert reminders
              </label>
              <p className={heaterOn ? "warn" : "meta"}>
                {heaterOn ? "CO reminder active every 25 minutes." : "CO reminder paused."}
              </p>
            </>
          )}
        </Card>

        <Card className="emergency-card" variant="solid">
          <CardHeader>
            <div>
              <CardTitle>Emergency and queue</CardTitle>
              <CardDescription>Critical broadcast and offline event control</CardDescription>
            </div>
            <Badge variant={isOnline ? "success" : "warning"} dot pulse={!isOnline}>{isOnline ? "Online" : "Offline"}</Badge>
          </CardHeader>
          <div className="action-stack">
            <Button variant="danger" size="lg" fullWidth onClick={() => handleReportHazard(5)} leftIcon={<Icon name="Siren" size={20} />}>
              Send emergency alert
            </Button>
            <Button variant="secondary" fullWidth onClick={handleSyncDrafts} disabled={!drafts.length} leftIcon={<Icon name="UploadCloud" size={16} />}>
              Sync queue now
            </Button>
          </div>
          <div className="metric-row">
            <MetricTile label="queued events" value={drafts.length} tone={drafts.length ? "warning" : "good"} icon="Inbox" />
            <MetricTile label="sync state" value={effectiveSyncState} tone={effectiveSyncState === "ERROR" ? "danger" : effectiveSyncState === "PENDING" ? "warning" : "good"} icon="RefreshCw" />
          </div>
          <div className="device-signing-panel">
            <div>
              <strong>
                {deviceRegistered
                  ? "Trusted device registered"
                  : deviceSigningReady
                    ? "Trusted device key ready"
                    : "Device key not installed"}
              </strong>
              <span>{deviceIdentity.deviceId ?? "No device id"}</span>
            </div>
            <div className="device-key-actions">
              <Button variant="ghost" size="sm" onClick={handleGenerateDeviceIdentity} leftIcon={<Icon name="KeyRound" size={16} />}>
                {deviceSigningReady ? "Rotate" : "Generate"}
              </Button>
              <Button variant="ghost" size="sm" onClick={handleRegisterDeviceIdentity} disabled={!deviceSigningReady || deviceRegistered}>
                Register
              </Button>
              <Button variant="ghost" size="sm" onClick={handleClearDeviceIdentity} disabled={!deviceSigningReady}>
                Clear
              </Button>
            </div>
            {deviceIdentity.publicKey && (
              <code title={deviceIdentity.publicKey}>{deviceIdentity.publicKey.slice(0, 22)}...</code>
            )}
          </div>
        </Card>
      </Grid>
    );
  }

  function renderOperationsModule() {
    return (
      <Grid cols={2} gap="lg">
        <Card className="risk-panel" glow={Boolean(risk)}>
          <CardHeader>
            <div>
              <CardTitle>Risk copilot</CardTitle>
              <CardDescription>Current workload, weather, and safety signal blend</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => togglePin("operations")}>
              <Icon name={pinnedModules.includes("operations") ? "PinOff" : "Pin"} size={16} />
              {pinnedModules.includes("operations") ? "Unpin" : "Pin"}
            </Button>
          </CardHeader>
          <Button onClick={handleRiskScore} leftIcon={<Icon name="Activity" size={16} />}>Recompute risk</Button>
          {risk ? (
            <div className={`risk-result ${riskTone}`}>
              <div>
                <RiskBadge tier={risk.tier} score={risk.score} size="lg" />
                <p>{risk.rationale[0] ?? "Risk profile generated."}</p>
              </div>
              <ul className="compact-list">
                {risk.rationale.slice(0, 3).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="empty-state">No live score yet. Run a risk check before the next operating decision.</p>
          )}
        </Card>

        <Card className="workflow-panel">
          <CardHeader>
            <div>
              <CardTitle>{mode === "OFFSHORE" ? "Gear transition" : "Route confidence"}</CardTitle>
              <CardDescription>{mode === "OFFSHORE" ? "Update gear state with a synced field event" : "Return window and solo travel checks"}</CardDescription>
            </div>
          </CardHeader>
          {mode === "OFFSHORE" ? (
            <>
              <Stack gap="sm">
                <Input label="Trip id" value={tripId} onChange={(e) => setTripId(e.target.value)} placeholder="Trip id" />
                <Input label="Gear id" value={gearId} onChange={(e) => setGearId(e.target.value)} placeholder="Gear id" />
                <Select
                  label="Transition"
                  value={transition}
                  onChange={(e) => setTransition(e.target.value as Transition)}
                  options={[
                    { value: "SET", label: "Set" },
                    { value: "CHECKED", label: "Checked" },
                    { value: "HAULED", label: "Hauled" },
                    { value: "MISSING", label: "Missing" },
                    { value: "RECOVERED", label: "Recovered" },
                    { value: "REMOVED", label: "Removed" }
                  ]}
                />
                <Button onClick={handleGearTransition} rightIcon={<Icon name="Send" size={16} />}>Submit transition</Button>
              </Stack>
              <ul className="compact-list">
                {gearRows.slice(0, 5).map((row) => (
                  <li key={row.gear_id}>{row.gear_id} <strong>{row.status}</strong></li>
                ))}
                {!gearRows.length ? <li>No gear rows loaded.</li> : null}
              </ul>
            </>
          ) : (
            <div className="route-grid">
              <MetricTile label="return window" value="17:40" tone="good" icon="Clock3" />
              <MetricTile label="daylight left" value="1h 55m" tone="warning" icon="Sun" />
              <MetricTile label="draft queue" value={drafts.length} tone={drafts.length ? "warning" : "good"} icon="Archive" />
            </div>
          )}
        </Card>
      </Grid>
    );
  }

  function renderHazardsModule() {
    return (
      <Card className="wide-panel">
        <CardHeader>
          <div>
            <CardTitle>Shared hazard layer</CardTitle>
            <CardDescription>Report, refresh, and review hazards across connected crews</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => togglePin("hazards")}>
            <Icon name={pinnedModules.includes("hazards") ? "PinOff" : "Pin"} size={16} />
            {pinnedModules.includes("hazards") ? "Unpin" : "Pin"}
          </Button>
        </CardHeader>
        <div className="action-row">
          <Button onClick={refreshAll} leftIcon={<Icon name="RefreshCw" size={16} />}>Refresh feed</Button>
          <Button variant="secondary" onClick={() => handleReportHazard()} leftIcon={<Icon name="MapPinPlus" size={16} />}>Report hazard</Button>
        </div>
        <ul className="hazard-list">
          {hazards.map((hazard) => (
            <li key={hazard.hazard_id}>
              <span>
                <strong>{hazard.type}</strong>
                <small>Confidence {Math.round(hazard.confidence * 100)}%</small>
              </span>
              <Badge variant={hazard.confidence >= 0.8 ? "danger" : "warning"}>{hazard.confidence >= 0.8 ? "High confidence" : "Needs review"}</Badge>
              <em>{hazard.sharing_scope}</em>
            </li>
          ))}
          {!hazards.length ? <li>No hazards synced yet.</li> : null}
        </ul>
      </Card>
    );
  }

  function renderLearningModule() {
    return (
      <Card className="wide-panel">
        <CardHeader>
          <div>
            <CardTitle>Training coach</CardTitle>
            <CardDescription>Assignments driven by check-ins, compliance, and near misses</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => togglePin("learning")}>
            <Icon name={pinnedModules.includes("learning") ? "PinOff" : "Pin"} size={16} />
            {pinnedModules.includes("learning") ? "Unpin" : "Pin"}
          </Button>
        </CardHeader>
        <Button onClick={handleTraining} leftIcon={<Icon name="Sparkles" size={16} />}>Generate assignments</Button>
        <ul className="training-list">
          {training.slice(0, 5).map((item) => (
            <li key={item.module_id}>
              <span>
                <strong>{item.title}</strong>
                <small>Recommended for current shift profile</small>
              </span>
              <em>{item.module_id}</em>
            </li>
          ))}
          {!training.length ? <li>No recommendations yet.</li> : null}
        </ul>
      </Card>
    );
  }

  const navItems = modules.map((m) => ({
    id: m.id,
    label: m.label,
    icon: <Icon name={m.id === "safety" ? "Shield" : m.id === "operations" ? "Anchor" : m.id === "hazards" ? "AlertTriangle" : "GraduationCap"} size={20} />,
  }));

  const syncStateMap: Record<SyncState, "synced" | "syncing" | "pending" | "error" | "offline"> = {
    SYNCED: "synced",
    SYNCING: "syncing",
    PENDING: "pending",
    ERROR: "error",
  };

  return (
    <AppShell maxWidth="xl" className="field-shell">
      <section className="mission-hero">
        <div className="hero-copy">
          <Badge variant={mode === "OFFSHORE" ? "cyan" : "teal"} dot>{mode === "OFFSHORE" ? "Offshore crew" : "Ice operator"}</Badge>
          <h1>Field Operations</h1>
          <p>{headerSubtitle}</p>
          <div className="hero-actions">
            <Button onClick={handleRiskScore} loading={syncState === "SYNCING"} leftIcon={<Icon name="Activity" size={16} />}>Risk now</Button>
            <Button variant="secondary" onClick={refreshAll} leftIcon={<Icon name="RefreshCw" size={16} />}>Refresh</Button>
            <Button variant="secondary" onClick={handleSyncDrafts} disabled={drafts.length === 0} leftIcon={<Icon name="Upload" size={16} />}>
              Sync {drafts.length ? `(${drafts.length})` : ""}
            </Button>
          </div>
        </div>

        <Card className="hero-panel" hover={false}>
          <div className="hero-panel-top">
            <SyncIndicator
              state={syncStateMap[effectiveSyncState]}
              pendingCount={drafts.length}
              lastSync={drafts.length === 0 ? new Date() : undefined}
            />
            <Badge variant={isOnline ? "success" : "warning"} dot pulse={!isOnline}>{isOnline ? "Signal live" : "Offline"}</Badge>
          </div>
          <Input
            label="Active trip"
            value={tripId}
            onChange={(e) => setTripId(e.target.value)}
            placeholder="Trip id"
            leftIcon={<Icon name="Route" size={16} />}
          />
          <Navigation
            items={[
              { id: "OFFSHORE", label: "Offshore", icon: <Icon name="Ship" size={20} /> },
              { id: "ICE", label: "Ice", icon: <Icon name="Snowflake" size={20} /> },
            ]}
            activeId={mode}
            onSelect={(id) => setMode(id as Mode)}
            variant="pills"
          />
        </Card>
      </section>

      <Section className="command-section">
        <Grid cols={3} gap="md">
          <Card variant="glass" className="command-card">
            <CardHeader>
              <CardTitle>Quick Command</CardTitle>
              <Icon name="Command" size={20} />
            </CardHeader>
            <Input
              value={commandQuery}
              onChange={(e) => setCommandQuery(e.target.value)}
              placeholder="Search actions..."
              leftIcon={<Icon name="Search" size={16} />}
            />
            <div className="command-results">
              {(filteredCommands.length ? filteredCommands.slice(0, 5) : quickCommands.slice(0, 3)).map((command) => (
                <button key={command.id} className="command-option" onClick={() => command.run()}>
                  <span>{command.label}</span>
                  <Badge variant={command.hint === "Critical" ? "danger" : "default"} size="sm">{command.hint}</Badge>
                </button>
              ))}
            </div>
          </Card>

          <Card variant="glass" className="queue-card">
            <CardHeader>
              <CardTitle>Offline Queue</CardTitle>
              <Badge variant={drafts.length > 0 ? "warning" : "success"}>{drafts.length} events</Badge>
            </CardHeader>
            <div className="queue-actions">
              <Button variant="secondary" size="sm" onClick={handleExportDrafts} disabled={drafts.length === 0} leftIcon={<Icon name="Download" size={16} />}>Export</Button>
              <Button variant="ghost" size="sm" onClick={handleClearQueue} disabled={drafts.length === 0} leftIcon={<Icon name="Trash2" size={16} />}>Clear</Button>
            </div>
            <div className="queue-list">
              {drafts.slice(0, 4).map((event) => (
                <div key={event.event_id} className="queue-item">
                  <span>
                    <StatusBadge status={event.event_type.includes("SAFETY") ? "active" : "synced"} size="sm">
                      {formatEventLabel(event.event_type)}
                    </StatusBadge>
                    <small>{formatTime(event.ts_device)}</small>
                  </span>
                  <IconButton icon="X" label="Remove" size="sm" onClick={() => handleRemoveDraft(event.event_id)} />
                </div>
              ))}
              {drafts.length === 0 && <p className="empty-state">No queued events.</p>}
            </div>
            {syncRepairReport && (
              <div className={`sync-repair-panel ${syncRepairReport.deviceChainIssue ? "danger" : "review"}`}>
                <div className="sync-repair-summary">
                  <span>
                    <strong>Last sync review</strong>
                    <small>{formatTime(syncRepairReport.checkedAt)}</small>
                  </span>
                  <Badge variant={syncRepairReport.rejected.length ? "warning" : "success"} size="sm">
                    {syncRepairReport.accepted}/{syncRepairReport.attempted} accepted
                  </Badge>
                </div>
                {syncRepairReport.rejected.length > 0 && (
                  <ul>
                    {syncRepairReport.rejected.slice(0, 3).map((item, index) => (
                      <li key={`${item.event_id ?? "unknown"}-${index}`}>
                        <span>{item.event_id ? item.event_id.slice(0, 8) : "unknown"}</span>
                        <em>{item.reason}</em>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="queue-actions">
                  <Button variant="secondary" size="sm" onClick={handleReconcileSyncChain} leftIcon={<Icon name="RefreshCw" size={16} />}>
                    Reconcile
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleQuarantineRejectedDrafts} disabled={!syncRepairReport.rejected.length}>
                    Quarantine rejected
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <Card variant="glass" className="notes-card">
            <CardHeader>
              <CardTitle>Shift Notes</CardTitle>
              <Badge variant="default">{shiftNotes.length}</Badge>
            </CardHeader>
            <Textarea
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="Write handoff notes..."
              rows={2}
            />
            <div className="queue-actions">
              <Button size="sm" onClick={saveShiftNote} disabled={!noteInput.trim()} leftIcon={<Icon name="Save" size={16} />}>Save</Button>
              <Button variant="ghost" size="sm" onClick={copyHandoffSummary} leftIcon={<Icon name="Copy" size={16} />}>Copy</Button>
            </div>
          </Card>
        </Grid>
      </Section>

      <Section className="module-picker">
        <div className="module-grid">
          {modules.map((module) => {
            const meta = moduleMeta[module.id];
            return (
              <button
                key={module.id}
                className={`module-switch ${activeModule === module.id ? "active" : ""}`}
                onClick={() => setActiveModule(module.id)}
              >
                <Icon name={meta.icon} size={24} />
                <span>
                  <strong>{meta.label}</strong>
                  <small>{meta.description}</small>
                </span>
                {pinnedModules.includes(module.id) && <Badge variant="teal" size="sm">Pinned</Badge>}
              </button>
            );
          })}
        </div>
      </Section>

      {statusMessage && (
        <Card variant="outline" padding="sm" className="status-callout">
          <Icon name="Info" size={20} />
          <p>{statusMessage}</p>
        </Card>
      )}

      <Section
        title={activeMeta.label}
        description={activeMeta.description}
        className="active-module"
      >
        <Stack gap="lg">
          {activeModule === "safety" && renderSafetyModule()}
          {activeModule === "operations" && renderOperationsModule()}
          {activeModule === "hazards" && renderHazardsModule()}
          {activeModule === "learning" && renderLearningModule()}
        </Stack>
      </Section>

      <Section title="Recent Activity" className="activity-section">
        <Grid cols={2} gap="lg">
          <Card variant="glass">
            <ActivityList
              items={recentActivity.slice(0, 8).map((item) => ({
                id: item.id,
                title: item.text,
                timestamp: new Date(item.createdAt),
                type: item.tone === "danger" ? "danger" : item.tone === "warning" ? "warning" : item.tone === "success" ? "success" : "info",
              }))}
            />
            {recentActivity.length === 0 && <p className="empty-state">Activity appears here as the shift progresses.</p>}
          </Card>
          <Card variant="glass">
            <CardHeader>
              <CardTitle>Latest Handoff Notes</CardTitle>
              <Icon name="ClipboardList" size={20} />
            </CardHeader>
            <div className="note-list">
              {todayNotes.map((note) => (
                <div key={note.id} className="note-item">
                  <span>
                    <strong>{note.text}</strong>
                    <small>{formatTime(note.createdAt)}</small>
                  </span>
                  <IconButton icon="Trash2" label="Delete note" size="sm" onClick={() => deleteShiftNote(note.id)} />
                </div>
              ))}
              {todayNotes.length === 0 && <p className="empty-state">No handoff notes saved.</p>}
            </div>
          </Card>
        </Grid>
      </Section>

      <BottomNavigation
        items={navItems}
        activeId={activeModule}
        onSelect={(id) => setActiveModule(id as Module)}
      />
    </AppShell>
  );
}
