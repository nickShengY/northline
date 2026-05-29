import { useEffect, useMemo, useState } from "react";
import {
  appendDraftEvent,
  clearDraftEvents,
  readDraftEvents,
  removeDraftEvent,
  replaceDraftEvents
} from "./lib/offlineLog";
import {
  completeCheckin,
  getTripGear,
  listHazards,
  listTrips,
  parseDevToken,
  recommendTraining,
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
import { computeEventHash, type OpsEvent } from "@northline/shared";
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

const modules: Array<{ id: Module; label: string }> = [
  { id: "safety", label: "Safety" },
  { id: "operations", label: "Operations" },
  { id: "hazards", label: "Hazards" },
  { id: "learning", label: "Training" }
];

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

  const [tripId, setTripId] = useState(initialPrefs.tripId);
  const [gearId, setGearId] = useState("STR-021");
  const [transition, setTransition] = useState<Transition>("CHECKED");
  const [checkinDone, setCheckinDone] = useState(false);
  const [checkinId] = useState(() => `chk_${crypto.randomUUID().slice(0, 8)}`);
  const [risk, setRisk] = useState<RiskScoreResult | null>(null);
  const [training, setTraining] = useState<TrainingRecommendation[]>([]);
  const [hazards, setHazards] = useState<HazardRow[]>([]);
  const [gearRows, setGearRows] = useState<GearRow[]>([]);
  const [heaterOn, setHeaterOn] = useState(true);
  const [draftVersion, setDraftVersion] = useState(0);
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

  const drafts = useMemo(() => readDraftEvents(), [draftVersion, syncState]);
  const offshoreReady = checklist.pinch && checklist.tension && checklist.comms && checklist.ppe && checklist.deck;
  const effectiveSyncState: SyncState = drafts.length > 0 && syncState === "SYNCED" ? "PENDING" : syncState;
  const syncClass = `sync-pill ${effectiveSyncState.toLowerCase()}`;
  const headerSubtitle = !isOnline
    ? "Offline mode active"
    : drafts.length > 0
      ? `${drafts.length} draft ${drafts.length === 1 ? "event" : "events"} waiting to sync`
      : "Online and synced";
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
    const auth = parseDevToken();
    const baseEvent = {
      event_id: crypto.randomUUID(),
      tenant_id: auth.tenantId,
      subject_type: "USER" as const,
      subject_id: auth.actorId,
      actor_id: auth.actorId,
      device_id: "mobile_ops_pwa",
      ts_device: new Date().toISOString(),
      event_type: eventType,
      schema_version: 1,
      payload_json: payload,
      signature: `dev:${auth.actorId}`
    };

    return {
      ...baseEvent,
      event_hash: await computeEventHash(baseEvent)
    };
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
        await scheduleCheckin({
          checkin_id: checkinId,
          trip_id: tripId,
          due_at: new Date(Date.now() + 20 * 60 * 1000).toISOString()
        });
      },
      {
        pendingOnError: true,
        successMessage: "Check-in scheduled for the next 20-minute window.",
        successActivity: "Scheduled operator check-in.",
        errorMessage: "Check-in was queued locally. Sync when online.",
        errorActivity: "Check-in scheduling queued offline."
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
        pendingOnError: true,
        successMessage: "Hazard submitted and feed updated.",
        successActivity: severity >= 5 ? "Emergency hazard report sent." : "Hazard report submitted.",
        errorMessage: "Hazard was captured. It will sync when connection returns.",
        errorActivity: "Hazard captured for deferred sync."
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
        pendingOnError: true,
        successMessage: `Gear ${gearId} updated to ${transition}.`,
        successActivity: `Gear ${gearId} transitioned to ${transition}.`,
        errorMessage: "Transition queued locally. Sync pending.",
        errorActivity: "Gear transition queued for sync."
      }
    );
  }

  async function handleAuthorizeHaul() {
    if (!tripId.trim()) {
      setStatusMessage("Enter a trip id before authorizing haul.");
      trackActivity("Haul authorization blocked: missing trip id.", "warning");
      return;
    }
    const event = await createDraftEvent("SAFETY_PROMPT_ACKED", { trip_id: tripId, checklist });
    appendDraftEvent(event);
    setDraftVersion((value) => value + 1);
    setSyncState("PENDING");
    setStatusMessage("Checklist captured offline and queued for sync.");
    trackActivity("Captured haul authorization checklist offline.", "warning");
  }

  async function handleSyncDrafts() {
    if (!drafts.length) {
      setStatusMessage("No queued draft events.");
      return;
    }
    try {
      setSyncState("SYNCING");
      const response = await uploadEvents(drafts);
      const acceptedSet = new Set(response.accepted ?? []);
      const remaining = drafts.filter((event) => !acceptedSet.has(event.event_id));
      replaceDraftEvents(remaining);
      setDraftVersion((value) => value + 1);
      if (remaining.length > 0) {
        setSyncState("PENDING");
        setStatusMessage(`Partial sync complete. ${remaining.length} drafts still queued.`);
        trackActivity("Partial queue sync completed.", "warning");
      } else {
        setSyncState("SYNCED");
        setStatusMessage("Draft queue synced.");
        trackActivity("Uploaded queued offline events.", "success");
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

  function handleRemoveDraft(eventId: string) {
    removeDraftEvent(eventId);
    setDraftVersion((value) => value + 1);
    trackActivity(`Removed queued event ${eventId.slice(0, 8)}.`, "info");
  }

  function handleClearQueue() {
    clearDraftEvents();
    setDraftVersion((value) => value + 1);
    setStatusMessage("Draft queue cleared.");
    trackActivity("Cleared local draft queue.", "warning");
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

  function renderSafetyModule() {
    return (
      <>
        <article className="module-card">
          <div className="card-head">
            <h2>Mission safety gate</h2>
            <button className="ghost" onClick={() => togglePin("safety")}>
              {pinnedModules.includes("safety") ? "Pinned" : "Pin"}
            </button>
          </div>
          <p className="meta">Trip {tripId}</p>

          {mode === "OFFSHORE" ? (
            <>
              <div className="check-grid">
                <label><input type="checkbox" checked={checklist.pinch} onChange={(e) => setChecklist((s) => ({ ...s, pinch: e.target.checked }))} />Pinch zones clear</label>
                <label><input type="checkbox" checked={checklist.tension} onChange={(e) => setChecklist((s) => ({ ...s, tension: e.target.checked }))} />Line tension confirmed</label>
                <label><input type="checkbox" checked={checklist.comms} onChange={(e) => setChecklist((s) => ({ ...s, comms: e.target.checked }))} />Comms verified</label>
                <label><input type="checkbox" checked={checklist.ppe} onChange={(e) => setChecklist((s) => ({ ...s, ppe: e.target.checked }))} />PPE complete</label>
                <label><input type="checkbox" checked={checklist.deck} onChange={(e) => setChecklist((s) => ({ ...s, deck: e.target.checked }))} />Deck clear</label>
              </div>
              <button disabled={!offshoreReady} onClick={handleAuthorizeHaul}>
                {offshoreReady ? "Authorize haul cycle" : "Complete all checks"}
              </button>
            </>
          ) : (
            <>
              <p>Operator check-in cadence: 20 minutes.</p>
              <div className="action-row">
                <button onClick={handleScheduleCheckin}>Schedule check-in</button>
                <button className="secondary" onClick={handleCompleteCheckin}>
                  {checkinDone ? "Check-in sent" : "I am safe"}
                </button>
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
        </article>

        <article className="module-card">
          <h2>Emergency and queue</h2>
          <p className="meta">Fast emergency broadcast and offline queue controls.</p>
          <div className="action-row">
            <button className="danger" onClick={() => handleReportHazard(5)}>Send emergency alert</button>
            <button className="secondary" onClick={handleSyncDrafts}>Sync queue now</button>
          </div>
          <ul>
            <li><strong>Queue depth</strong> {drafts.length}</li>
            <li><strong>Connection</strong> {isOnline ? "Online" : "Offline"}</li>
          </ul>
        </article>
      </>
    );
  }

  function renderOperationsModule() {
    return (
      <>
        <article className="module-card">
          <div className="card-head">
            <h2>Risk copilot</h2>
            <button className="ghost" onClick={() => togglePin("operations")}>
              {pinnedModules.includes("operations") ? "Pinned" : "Pin"}
            </button>
          </div>
          <p className="meta">On-demand risk scoring for current workload and weather.</p>
          <button onClick={handleRiskScore}>Recompute risk</button>
          {risk ? (
            <div className="result">
              <p><strong>{risk.tier}</strong> score {risk.score}</p>
              <ul>
                {risk.rationale.slice(0, 3).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="meta">No live score yet.</p>
          )}
        </article>

        <article className="module-card">
          <h2>{mode === "OFFSHORE" ? "Gear transition" : "Route confidence"}</h2>
          {mode === "OFFSHORE" ? (
            <>
              <input value={tripId} onChange={(e) => setTripId(e.target.value)} placeholder="Trip id" />
              <input value={gearId} onChange={(e) => setGearId(e.target.value)} placeholder="Gear id" />
              <select value={transition} onChange={(e) => setTransition(e.target.value as Transition)}>
                <option value="SET">SET</option>
                <option value="CHECKED">CHECKED</option>
                <option value="HAULED">HAULED</option>
                <option value="MISSING">MISSING</option>
                <option value="RECOVERED">RECOVERED</option>
                <option value="REMOVED">REMOVED</option>
              </select>
              <button onClick={handleGearTransition}>Submit transition</button>
              <ul>
                {gearRows.slice(0, 5).map((row) => (
                  <li key={row.gear_id}>{row.gear_id} <strong>{row.status}</strong></li>
                ))}
                {!gearRows.length ? <li>No gear rows loaded.</li> : null}
              </ul>
            </>
          ) : (
            <div className="result">
              <p><strong>Return window:</strong> 17:40</p>
              <p><strong>Daylight left:</strong> 1h 55m</p>
              <p><strong>Draft events queued:</strong> {drafts.length}</p>
            </div>
          )}
        </article>
      </>
    );
  }

  function renderHazardsModule() {
    return (
      <article className="module-card wide">
        <div className="card-head">
          <h2>Shared hazard layer</h2>
          <button className="ghost" onClick={() => togglePin("hazards")}>
            {pinnedModules.includes("hazards") ? "Pinned" : "Pin"}
          </button>
        </div>
        <p className="meta">Report and sync hazards across connected crews.</p>
        <div className="action-row">
          <button onClick={refreshAll}>Refresh feed</button>
          <button className="secondary" onClick={() => handleReportHazard()}>Report hazard</button>
        </div>
        <ul>
          {hazards.map((hazard) => (
            <li key={hazard.hazard_id}>
              <strong>{hazard.type}</strong> confidence {Math.round(hazard.confidence * 100)}%
              <em>{hazard.sharing_scope}</em>
            </li>
          ))}
          {!hazards.length ? <li>No hazards synced yet.</li> : null}
        </ul>
      </article>
    );
  }

  function renderLearningModule() {
    return (
      <article className="module-card wide">
        <div className="card-head">
          <h2>Training coach</h2>
          <button className="ghost" onClick={() => togglePin("learning")}>
            {pinnedModules.includes("learning") ? "Pinned" : "Pin"}
          </button>
        </div>
        <p className="meta">Targeted assignments driven by check-ins, compliance, and near misses.</p>
        <button onClick={handleTraining}>Generate assignments</button>
        <ul>
          {training.slice(0, 5).map((item) => (
            <li key={item.module_id}>
              <strong>{item.title}</strong>
              <em>{item.module_id}</em>
            </li>
          ))}
          {!training.length ? <li>No recommendations yet.</li> : null}
        </ul>
      </article>
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
    <AppShell>
      {/* Header with sync status */}
      <PageHeader
        title="Field Operations"
        subtitle={headerSubtitle}
        actions={
          <SyncIndicator
            state={syncStateMap[effectiveSyncState]}
            pendingCount={drafts.length}
            lastSync={drafts.length === 0 ? new Date() : undefined}
          />
        }
      />

      {/* Quick actions bar */}
      <Section>
        <div className="quick-row flex flex-row gap-2">
          <Button variant="primary" size="sm" onClick={handleRiskScore} loading={syncState === "SYNCING"}>
            <Icon name="Activity" size={16} />
            Risk Now
          </Button>
          <Button variant="secondary" size="sm" onClick={refreshAll}>
            <Icon name="RefreshCw" size={16} />
            Refresh
          </Button>
          <Button variant="secondary" size="sm" onClick={handleSyncDrafts} disabled={drafts.length === 0}>
            <Icon name="Upload" size={16} />
            Sync ({drafts.length})
          </Button>
        </div>
      </Section>

      {/* Mode switch */}
      <Section>
        <Navigation
          items={[
            { id: "OFFSHORE", label: "Offshore", icon: <Icon name="Ship" size={20} /> },
            { id: "ICE", label: "Ice", icon: <Icon name="Snowflake" size={20} /> },
          ]}
          activeId={mode}
          onSelect={(id) => setMode(id as Mode)}
          variant="pills"
        />
      </Section>

      {/* Pinned modules */}
      {pinned.length > 0 && (
        <Section>
          <div className="pinned-strip flex flex-row gap-2 items-center">
            <Badge variant="default">Pinned</Badge>
            {pinned.map((module) => (
              <Button key={module.id} variant="ghost" size="sm" onClick={() => setActiveModule(module.id)}>
                {module.label}
              </Button>
            ))}
          </div>
        </Section>
      )}

      {/* Utility cards */}
      <Section>
        <Grid cols={3} gap="md">
          {/* Quick command */}
          <Card variant="glass">
            <CardHeader>
              <CardTitle>Quick Command</CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                value={commandQuery}
                onChange={(e) => setCommandQuery(e.target.value)}
                placeholder="Type command..."
                leftIcon={<Icon name="Search" size={16} />}
              />
              {filteredCommands.length > 0 && (
                <Stack gap="sm" className="mt-4">
                  {filteredCommands.slice(0, 5).map((command) => (
                    <Button key={command.id} variant="ghost" size="sm" onClick={() => command.run()}>
                      {command.label}
                      <Badge variant="default" size="sm">{command.hint}</Badge>
                    </Button>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>

          {/* Offline queue */}
          <Card variant="glass">
            <CardHeader>
              <CardTitle>Offline Queue</CardTitle>
              <Badge variant={drafts.length > 0 ? "warning" : "success"}>{drafts.length} events</Badge>
            </CardHeader>
            <CardContent>
              <Stack gap="sm">
                <div className="flex flex-row gap-2">
                  <Button variant="secondary" size="sm" onClick={handleExportDrafts} disabled={drafts.length === 0}>
                    Export
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleClearQueue} disabled={drafts.length === 0}>
                    Clear
                  </Button>
                </div>
                {drafts.slice(0, 4).map((event) => (
                  <div key={event.event_id} className="flex items-center justify-between p-2 rounded bg-[var(--bg-secondary)]">
                    <span className="text-sm">
                      <StatusBadge status={event.event_type.includes("SAFETY") ? "active" : "synced"}>
                        {formatEventLabel(event.event_type)}
                      </StatusBadge>
                      <span className="ml-2 text-[var(--ink-muted)]">{formatTime(event.ts_device)}</span>
                    </span>
                    <IconButton icon="X" label="Remove" size="sm" onClick={() => handleRemoveDraft(event.event_id)} />
                  </div>
                ))}
                {drafts.length === 0 && <p className="text-sm text-[var(--ink-muted)]">No queued events.</p>}
              </Stack>
            </CardContent>
          </Card>

          {/* Shift notes */}
          <Card variant="glass">
            <CardHeader>
              <CardTitle>Shift Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                placeholder="Write handoff notes..."
                rows={2}
              />
              <div className="flex flex-row gap-2 mt-3">
                <Button size="sm" onClick={saveShiftNote} disabled={!noteInput.trim()}>Save</Button>
                <Button variant="ghost" size="sm" onClick={copyHandoffSummary}>Copy Summary</Button>
              </div>
            </CardContent>
          </Card>
        </Grid>
      </Section>

      {/* Status message */}
      {statusMessage && (
        <Section>
          <Card variant="outline" padding="sm">
            <p className="text-sm text-[var(--ink-secondary)]">{statusMessage}</p>
          </Card>
        </Section>
      )}

      {/* Main content */}
      <Section>
        <Stack gap="lg">
          {activeModule === "safety" && renderSafetyModule()}
          {activeModule === "operations" && renderOperationsModule()}
          {activeModule === "hazards" && renderHazardsModule()}
          {activeModule === "learning" && renderLearningModule()}
        </Stack>
      </Section>

      {/* Recent activity */}
      <Section title="Recent Activity">
        <ActivityList
          items={recentActivity.slice(0, 10).map((item) => ({
            id: item.id,
            title: item.text,
            timestamp: new Date(item.createdAt),
            type: item.tone === "danger" ? "danger" : item.tone === "warning" ? "warning" : item.tone === "success" ? "success" : "info",
          }))}
        />
      </Section>

      {/* Bottom navigation for mobile */}
      <BottomNavigation
        items={navItems}
        activeId={activeModule}
        onSelect={(id) => setActiveModule(id as Module)}
      />
    </AppShell>
  );
}
