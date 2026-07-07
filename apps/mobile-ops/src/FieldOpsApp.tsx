import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
  verifyDeviceIdentity,
  type DeviceIdentitySummary
} from "./lib/deviceIdentity";
import { type OpsEvent } from "@northline/shared";
import {
  AppShell,
  Badge,
  BottomNavigation,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Checklist,
  ConfirmModal,
  Grid,
  Icon,
  IconButton,
  Input,
  Navigation,
  RiskBadge,
  SafetyAlert,
  Section,
  Select,
  Stack,
  StatusBadge,
  SyncIndicator,
  Textarea,
  ActivityList,
  useToast,
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

interface PendingConfirm {
  title: string;
  message: string;
  confirmText: string;
  variant: "default" | "danger";
  action: () => void | Promise<void>;
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
const DEVICE_REGISTERED_KEY = "northline.mobile_ops.device_registered";
const MAX_NOTES = 30;
const MAX_ACTIVITY = 20;
const CO_REMINDER_INTERVAL_MS = 25 * 60 * 1000;
const GEOLOCATION_TIMEOUT_MS = 8000;
const RECONCILE_MAX_PAGES = 10;

function readStorageJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatEventLabel(eventType: string) {
  const labels: Record<string, string> = {
    SAFETY_PROMPT_ACKED: "Safety checklist"
  };
  return labels[eventType] ?? eventType.replace(/_/g, " ").toLowerCase().replace(/^\w/, (char) => char.toUpperCase());
}

function errorReason(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function readInitialAuthIdentity(): AuthIdentity {
  try {
    const auth = parseDevToken();
    return { tenantId: auth.tenantId, actorId: auth.actorId, role: auth.role };
  } catch {
    return { tenantId: "", actorId: "", role: "CREW" };
  }
}

/** Resolve the startup module from ?module= (PWA shortcuts), falling back to saved prefs. */
function readInitialModule(fallback: Module): Module {
  try {
    const param = new URLSearchParams(window.location.search).get("module");
    // Older installed shortcuts used the removed "gear" id.
    const mapped = param === "gear" ? "operations" : param;
    return modules.some((module) => module.id === mapped) ? (mapped as Module) : fallback;
  } catch {
    return fallback;
  }
}

/** Acquire a real GPS fix. Resolves null (never fabricated coordinates) on failure. */
function getCurrentPosition(timeoutMs = GEOLOCATION_TIMEOUT_MS): Promise<{ lat: number; lon: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 }
    );
  });
}

function readInitialDeviceRegistered(): boolean {
  try {
    const registeredDeviceId = localStorage.getItem(DEVICE_REGISTERED_KEY);
    return Boolean(registeredDeviceId) && registeredDeviceId === readDeviceIdentity().deviceId;
  } catch {
    return false;
  }
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

  const toast = useToast();
  const { success: toastSuccess, error: toastError, warning: toastWarning, info: toastInfo } = toast;

  const [mode, setMode] = useState<Mode>(initialPrefs.mode);
  const [activeModule, setActiveModule] = useState<Module>(() => readInitialModule(initialPrefs.activeModule));
  const [pinnedModules, setPinnedModules] = useState<Module[]>(initialPrefs.pinnedModules);
  const [syncState, setSyncState] = useState<SyncState>("SYNCED");
  const [statusMessage, setStatusMessage] = useState("Ready. Select a module to continue.");
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [authIdentity, setAuthIdentity] = useState<AuthIdentity>(() => readInitialAuthIdentity());
  const [deviceIdentity, setDeviceIdentity] = useState<DeviceIdentitySummary>(() => readDeviceIdentity());
  const [deviceRegistered, setDeviceRegistered] = useState(() => readInitialDeviceRegistered());

  const [tripId, setTripId] = useState(initialPrefs.tripId);
  const [gearId, setGearId] = useState("STR-021");
  const [transition, setTransition] = useState<Transition>("CHECKED");
  const [checkinScheduled, setCheckinScheduled] = useState(false);
  const [checkinDone, setCheckinDone] = useState(false);
  const [checkinId, setCheckinId] = useState(() => `chk_${crypto.randomUUID().slice(0, 8)}`);
  const [risk, setRisk] = useState<RiskScoreResult | null>(null);
  const [training, setTraining] = useState<TrainingRecommendation[]>([]);
  const [hazards, setHazards] = useState<HazardRow[]>([]);
  const [gearRows, setGearRows] = useState<GearRow[]>([]);
  const [heaterOn, setHeaterOn] = useState(true);
  const [coReminderDue, setCoReminderDue] = useState(false);
  const [nextCoReminderAt, setNextCoReminderAt] = useState<Date | null>(null);
  const [draftVersion, setDraftVersion] = useState(0);
  const [drafts, setDrafts] = useState<OpsEvent<Record<string, unknown>>[]>([]);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [emergencyRetryNeeded, setEmergencyRetryNeeded] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [pendingActions, setPendingActions] = useState<ReadonlySet<string>>(() => new Set());
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
  const headerSubtitle = !isOnline
    ? "Offline mode active"
    : drafts.length > 0
      ? `${drafts.length} draft ${drafts.length === 1 ? "event" : "events"} waiting to sync`
      : "Online and synced";
  const deviceSigningReady = deviceIdentity.hasPrivateKey && Boolean(deviceIdentity.deviceId);
  const todayNotes = shiftNotes.slice(0, 4);

  const trackActivity = useCallback((text: string, tone: ActivityItem["tone"] = "info") => {
    setRecentActivity((previous) =>
      [{ id: crypto.randomUUID(), text, tone, createdAt: new Date().toISOString() }, ...previous].slice(0, MAX_ACTIVITY)
    );
  }, []);

  const isPending = useCallback((key: string) => pendingActions.has(key), [pendingActions]);

  // Synchronous in-flight set: state updates lag a render, so a double-tap
  // between renders would otherwise run the task twice.
  const inFlightActionsRef = useRef(new Set<string>());

  async function withPending(key: string, task: () => Promise<void>) {
    if (inFlightActionsRef.current.has(key)) return;
    inFlightActionsRef.current.add(key);
    setPendingActions((previous) => {
      const next = new Set(previous);
      next.add(key);
      return next;
    });
    try {
      await task();
    } finally {
      inFlightActionsRef.current.delete(key);
      setPendingActions((previous) => {
        const next = new Set(previous);
        next.delete(key);
        return next;
      });
    }
  }

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

  // Verify the fast localStorage device-key summary against IndexedDB; the
  // "indexeddb" flag can outlive the actual key material.
  useEffect(() => {
    let mounted = true;
    void verifyDeviceIdentity()
      .then((verified) => {
        if (!mounted) return;
        setDeviceIdentity((previous) => {
          if (previous.hasPrivateKey && !verified.hasPrivateKey) {
            trackActivity("Stored device signing key is missing. Generate a new key before offline capture.", "warning");
          }
          return verified;
        });
      })
      .catch(() => {
        /* keep the optimistic summary; signing will fail loudly if the key is gone */
      });
    return () => {
      mounted = false;
    };
  }, [trackActivity]);

  // Surface PWA lifecycle notifications dispatched from main.tsx.
  useEffect(() => {
    const handleDetail = (detail: { type: string; message: string } | undefined) => {
      if (!detail) return;
      if (detail.type === "updated") {
        toastInfo("App updated", detail.message);
      } else {
        toastSuccess("Offline ready", detail.message);
      }
    };
    const onPwaStatus = (event: Event) => {
      handleDetail((event as CustomEvent<{ type: string; message: string }>).detail);
      // Handled live, so a later remount must not replay it from the buffer.
      delete (window as Window & { __northlinePwaStatus?: { type: string; message: string } }).__northlinePwaStatus;
    };
    // Consume a status the service worker reported before this listener
    // mounted (main.tsx buffers the latest one).
    const windowWithBuffer = window as Window & { __northlinePwaStatus?: { type: string; message: string } };
    if (windowWithBuffer.__northlinePwaStatus) {
      handleDetail(windowWithBuffer.__northlinePwaStatus);
      delete windowWithBuffer.__northlinePwaStatus;
    }
    window.addEventListener("northline:pwa-status", onPwaStatus);
    return () => window.removeEventListener("northline:pwa-status", onPwaStatus);
  }, [toastInfo, toastSuccess]);

  useEffect(() => {
    let cancelled = false;
    readDraftEvents()
      .then((events) => {
        if (!cancelled) setDrafts(events);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Draft queue read failed", error);
        setStatusMessage(`Offline queue could not be read. (${errorReason(error)})`);
      });
    return () => {
      cancelled = true;
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

  // Auto-select a trip only while the trip field is empty (on load and on
  // mode switch). Never overwrite an id the user is typing.
  const tripIdRef = useRef(tripId);
  useEffect(() => {
    tripIdRef.current = tripId;
  }, [tripId]);

  useEffect(() => {
    if (tripIdRef.current.trim()) return;
    let cancelled = false;

    void (async () => {
      try {
        const response = await listTrips();
        if (cancelled || tripIdRef.current.trim()) return;

        const match =
          response.trips.find((trip) => trip.mode === mode && trip.status === "ACTIVE") ??
          response.trips.find((trip) => trip.mode === mode) ??
          response.trips[0];

        if (match?.trip_id) {
          setTripId(match.trip_id);
          setStatusMessage(`Loaded active ${mode.toLowerCase()} trip.`);
          trackActivity(`Loaded active ${mode.toLowerCase()} trip.`, "info");
        } else {
          setStatusMessage("No trips are available for the selected mode.");
        }
      } catch {
        if (!cancelled) {
          setStatusMessage("Enter a trip id to start syncing field workflows.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, trackActivity]);

  // Reset check-in progress whenever the operating context changes.
  const skipCheckinResetRef = useRef(true);
  useEffect(() => {
    if (skipCheckinResetRef.current) {
      skipCheckinResetRef.current = false;
      return;
    }
    setCheckinScheduled(false);
    setCheckinDone(false);
    setCheckinId(`chk_${crypto.randomUUID().slice(0, 8)}`);
  }, [tripId, mode]);

  // Real CO reminder cadence for ice operations (M2). Fires every 25 minutes
  // while the toggle is on and surfaces a persistent in-app banner.
  useEffect(() => {
    if (!heaterOn || mode !== "ICE") {
      setCoReminderDue(false);
      setNextCoReminderAt(null);
      return;
    }
    setNextCoReminderAt(new Date(Date.now() + CO_REMINDER_INTERVAL_MS));
    const handle = window.setInterval(() => {
      setCoReminderDue(true);
      setNextCoReminderAt(new Date(Date.now() + CO_REMINDER_INTERVAL_MS));
      trackActivity("CO ventilation reminder due.", "warning");
    }, CO_REMINDER_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [heaterOn, mode, trackActivity]);

  // Debounced background refresh of hazards/gear when the trip or mode
  // changes. Silent: no global sync-state churn per keystroke (M1).
  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      try {
        const hazardResponse = await listHazards(mode === "ICE" ? "GROUP" : "ORG");
        if (!cancelled) setHazards(hazardResponse.hazards ?? []);
        if (mode === "OFFSHORE" && tripId.trim()) {
          const gearResponse = await getTripGear(tripId.trim(), mode);
          if (!cancelled) setGearRows(gearResponse.gear ?? []);
        } else if (!cancelled) {
          setGearRows([]);
        }
      } catch (error) {
        if (!cancelled) console.error("Background data refresh failed", error);
      }
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [mode, tripId]);

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
    } catch (error) {
      console.error(options?.errorMessage ?? "Field ops task failed", error);
      const reason = errorReason(error);
      setSyncState(options?.pendingOnError ? "PENDING" : "ERROR");
      if (options?.errorMessage) {
        setStatusMessage(`${options.errorMessage} (${reason})`);
        toastError(options.errorMessage, reason);
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
    const response = await getTripGear(tripId.trim(), mode);
    setGearRows(response.gear ?? []);
  }

  async function createDraftEvent(eventType: string, payload: Record<string, unknown>): Promise<OpsEvent<Record<string, unknown>>> {
    return createSignedDraftEvent(authIdentity, deviceIdentity, eventType, payload, {
      allowDevSignature: import.meta.env.DEV
    });
  }

  async function generateDeviceIdentityNow() {
    await withPending("device-key", async () => {
      try {
        const next = await generateAndStoreDeviceIdentity(authIdentity.actorId);
        setDeviceIdentity(next);
        setDeviceRegistered(false);
        localStorage.removeItem(DEVICE_REGISTERED_KEY);
        setStatusMessage("Device signing key generated. Register the public key before production sync.");
        toastSuccess("Device key generated", "Register the public key before production sync.");
        trackActivity("Generated local device signing key.", "success");
      } catch (error) {
        console.error("Device key generation failed", error);
        const reason = errorReason(error);
        setStatusMessage(`Device key generation failed. (${reason})`);
        toastError("Device key generation failed", reason);
        trackActivity("Device key generation failed.", "danger");
      }
    });
  }

  function requestGenerateDeviceIdentity() {
    if (deviceSigningReady) {
      setPendingConfirm({
        title: "Rotate device signing key?",
        message:
          "Rotating replaces the current signing key. Queued events signed with the old key stay valid, but the new public key must be registered before future events sync.",
        confirmText: "Rotate key",
        variant: "danger",
        action: generateDeviceIdentityNow
      });
    } else {
      void generateDeviceIdentityNow();
    }
  }

  async function handleRegisterDeviceIdentity() {
    if (!deviceIdentity.deviceId || !deviceIdentity.publicKey) {
      setStatusMessage("Generate a device signing key before registration.");
      trackActivity("Device registration blocked: missing local key.", "warning");
      return;
    }

    await withPending("register-device", () =>
      runWithSync(
        async () => {
          await registerCurrentDevice({
            device_id: deviceIdentity.deviceId as string,
            public_key: deviceIdentity.publicKey as string,
            key_version: 1
          });
          localStorage.setItem(DEVICE_REGISTERED_KEY, deviceIdentity.deviceId as string);
          setDeviceRegistered(true);
        },
        {
          successMessage: "Device signing key registered for this user.",
          successActivity: "Registered current device signing key.",
          errorMessage: "Device key registration failed. Try again when connected.",
          errorActivity: "Device key registration failed."
        }
      )
    );
  }

  async function clearDeviceIdentityNow() {
    await withPending("device-clear", async () => {
      try {
        await clearDeviceIdentity();
        setDeviceIdentity(readDeviceIdentity());
        setDeviceRegistered(false);
        localStorage.removeItem(DEVICE_REGISTERED_KEY);
        setStatusMessage("Device signing key removed from this browser.");
        trackActivity("Removed local device signing key.", "warning");
      } catch (error) {
        console.error("Device key removal failed", error);
        const reason = errorReason(error);
        setStatusMessage(`Device key removal failed. (${reason})`);
        toastError("Device key removal failed", reason);
        trackActivity("Device key removal failed.", "danger");
      }
    });
  }

  function requestClearDeviceIdentity() {
    setPendingConfirm({
      title: "Remove device signing key?",
      message:
        "Offline events can no longer be signed on this device until a new key is generated and registered.",
      confirmText: "Remove key",
      variant: "danger",
      action: clearDeviceIdentityNow
    });
  }

  async function copyPublicKey() {
    if (!deviceIdentity.publicKey) return;
    try {
      await navigator.clipboard.writeText(deviceIdentity.publicKey);
      toastSuccess("Public key copied");
    } catch {
      toastError("Clipboard unavailable", "The public key could not be copied.");
    }
  }

  async function refreshAll() {
    await withPending("refresh", () =>
      runWithSync(
        async () => {
          await loadHazards();
          await loadGear();
        },
        {
          pendingOnError: true,
          successMessage: "Data refreshed.",
          successActivity: "Refreshed hazards and gear state.",
          errorMessage: "Some data could not be refreshed. Offline values preserved.",
          errorActivity: "Refresh failed. Offline cache retained."
        }
      )
    );
  }

  async function handleScheduleCheckin() {
    if (!tripId.trim()) {
      setStatusMessage("Enter a trip id before scheduling check-ins.");
      trackActivity("Check-in scheduling blocked: missing trip id.", "warning");
      return;
    }
    await withPending("checkin-schedule", () =>
      runWithSync(
        async () => {
          const nextCheckinId = `chk_${crypto.randomUUID().slice(0, 8)}`;
          await scheduleCheckin({
            checkin_id: nextCheckinId,
            trip_id: tripId,
            due_at: new Date(Date.now() + 20 * 60 * 1000).toISOString()
          });
          setCheckinId(nextCheckinId);
          setCheckinScheduled(true);
          setCheckinDone(false);
        },
        {
          successMessage: "Check-in scheduled for the next 20-minute window.",
          successActivity: "Scheduled operator check-in.",
          errorMessage: "Check-in schedule failed. Try again when signal improves.",
          errorActivity: "Check-in scheduling failed."
        }
      )
    );
  }

  async function handleCompleteCheckin() {
    if (!tripId.trim()) {
      setStatusMessage("Enter a trip id before completing check-ins.");
      trackActivity("Check-in completion blocked: missing trip id.", "warning");
      return;
    }
    if (!checkinScheduled) {
      setStatusMessage("Schedule a check-in window before confirming you are safe.");
      trackActivity("Check-in completion blocked: nothing scheduled.", "warning");
      return;
    }
    await withPending("checkin-complete", () =>
      runWithSync(
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
      )
    );
  }

  async function handleRiskScore() {
    await withPending("risk", () =>
      runWithSync(
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
          successMessage: "Risk estimate recalculated from recent shift activity.",
          successActivity: "Computed updated risk estimate.",
          errorMessage: "Risk scoring unavailable. Keep operating in offline-safe mode.",
          errorActivity: "Risk computation failed."
        }
      )
    );
  }

  async function handleTraining() {
    await withPending("training", () =>
      runWithSync(
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
      )
    );
  }

  /**
   * Submit a hazard (or severity-5 emergency) report with a real GPS fix.
   * Never fabricates coordinates: the API requires a location, so submission
   * is blocked with clear guidance when no position is available.
   */
  async function submitHazardReport(severity = mode === "OFFSHORE" ? 3 : 4): Promise<boolean> {
    const isEmergency = severity >= 5;
    const trimmedTripId = tripId.trim();
    if (!isEmergency && !trimmedTripId) {
      setStatusMessage("Enter a trip id before reporting hazards.");
      trackActivity("Hazard reporting blocked: missing trip id.", "warning");
      return false;
    }

    const location = await getCurrentPosition();
    if (!location) {
      const message = "Position unavailable — enable location services and try again.";
      setStatusMessage(message);
      toastError(isEmergency ? "Emergency alert not sent" : "Hazard not sent", message);
      trackActivity(
        isEmergency ? "Emergency alert blocked: no GPS position." : "Hazard report blocked: no GPS position.",
        isEmergency ? "danger" : "warning"
      );
      return false;
    }

    try {
      setSyncState("SYNCING");
      await reportHazard({
        hazard_id: `hz_${crypto.randomUUID().slice(0, 8)}`,
        ...(trimmedTripId ? { trip_id: trimmedTripId } : {}),
        hazard_type: mode === "OFFSHORE" ? "WEATHER" : "RIDGE",
        severity,
        confidence: 0.76,
        sharing_scope: mode === "OFFSHORE" ? "ORG" : "GROUP",
        location
      });
      try {
        await loadHazards();
      } catch {
        /* report succeeded; feed refresh is best-effort */
      }
      setSyncState("SYNCED");
      if (isEmergency) {
        setStatusMessage("Emergency alert sent to connected crews.");
        toastSuccess("Emergency alert sent", "Connected crews have been notified.");
        trackActivity("Emergency hazard report sent.", "danger");
      } else {
        setStatusMessage("Hazard submitted and feed updated.");
        toastSuccess("Hazard submitted");
        trackActivity("Hazard report submitted.", "success");
      }
      return true;
    } catch (error) {
      console.error("Hazard report failed", error);
      const reason = errorReason(error);
      const guidance = isOnline
        ? "Try again when signal improves."
        : "You appear offline — retry as soon as signal returns.";
      setSyncState("ERROR");
      setStatusMessage(`${isEmergency ? "Emergency alert" : "Hazard report"} failed. ${guidance}`);
      toastError(isEmergency ? "Emergency alert failed" : "Hazard report failed", `${guidance} (${reason})`);
      trackActivity(isEmergency ? "Emergency alert failed to send." : "Hazard report failed.", "danger");
      return false;
    }
  }

  async function handleReportHazard() {
    await withPending("hazard", async () => {
      await submitHazardReport();
    });
  }

  async function sendEmergencyAlert() {
    await withPending("emergency", async () => {
      const sent = await submitHazardReport(5);
      setEmergencyRetryNeeded(!sent);
    });
  }

  function requestEmergencyAlert() {
    setPendingConfirm({
      title: "Send emergency alert?",
      message:
        "This broadcasts a severity-5 emergency to every connected crew and triggers response workflows. Confirm only if you need immediate assistance.",
      confirmText: "Send emergency alert",
      variant: "danger",
      action: sendEmergencyAlert
    });
  }

  async function handleGearTransition() {
    if (mode !== "OFFSHORE") return;
    if (!tripId.trim()) {
      setStatusMessage("Enter a trip id before transitioning gear.");
      trackActivity("Gear transition blocked: missing trip id.", "warning");
      return;
    }
    await withPending("gear", () =>
      runWithSync(
        async () => {
          await transitionGear({
            trip_id: tripId,
            gear_id: gearId,
            transition,
            mode,
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
      )
    );
  }

  async function handleAuthorizeHaul() {
    if (!tripId.trim()) {
      setStatusMessage("Enter a trip id before authorizing haul.");
      trackActivity("Haul authorization blocked: missing trip id.", "warning");
      return;
    }
    await withPending("haul", async () => {
      try {
        const event = await createDraftEvent("SAFETY_PROMPT_ACKED", { trip_id: tripId, checklist });
        await appendDraftEvent(event);
        setDraftVersion((value) => value + 1);
        setSyncState("PENDING");
        setStatusMessage("Checklist captured offline and queued for sync.");
        trackActivity("Captured haul authorization checklist offline.", "warning");
      } catch (error) {
        console.error("Offline event capture failed", error);
        setSyncState("ERROR");
        setStatusMessage("Device signing key is required before queueing production offline events.");
        toastError("Checklist not queued", "A trusted device signing key is required first.");
        trackActivity("Offline event capture blocked: missing device signing key.", "danger");
      }
    });
  }

  async function pullServerEventsAfterQueueSync() {
    const currentCursor = readSyncCursor();
    const response = await downloadEvents(currentCursor, 500);
    // Cache anything the server returned, even if the cursor did not move.
    if (response.events.length > 0) {
      await appendCachedServerEvents(response.events);
    }
    if (response.cursor && response.cursor !== currentCursor) {
      // Advance the local cursor only after the server acknowledges receipt;
      // re-downloads are deduplicated by event id.
      await ackSyncCursor(response.cursor);
      writeSyncCursor(response.cursor);
    }
    return response.events.length;
  }

  async function handleSyncDrafts() {
    await withPending("sync", async () => {
      // Re-read the store instead of trusting render state (C3/C4).
      const queued = await readDraftEvents();
      if (!queued.length) {
        setStatusMessage("No queued draft events.");
        return;
      }
      try {
        setSyncState("SYNCING");
        const batch = nextSyncUploadBatch(queued);
        const response = await uploadEvents(batch, readSyncCursor());
        const acceptedIds = response.accepted ?? [];
        updateDeviceChainHeadsFromAccepted(batch, acceptedIds);
        const rejectionCodes = rejectedReasonCodes(response);
        const acceptedCount = response.accepted?.length ?? response.accepted_count ?? 0;
        setSyncRepairReport({
          attempted: batch.length,
          accepted: acceptedCount,
          rejected: response.rejected.map((item, index) => ({
            event_id: item.event_id,
            reason: rejectionCodes[index] ?? (typeof item.reason === "string" ? item.reason : JSON.stringify(item.reason))
          })),
          deviceChainIssue: hasDeviceChainRejection(response),
          checkedAt: new Date().toISOString()
        });

        // Delete only the events the server accepted; anything queued during
        // the upload (or rejected) stays in the store untouched.
        for (const eventId of acceptedIds) {
          await removeDraftEvent(eventId);
        }
        const remaining = await readDraftEvents();
        setDrafts(remaining);
        setDraftVersion((value) => value + 1);

        if (hasDeviceChainRejection(response)) {
          setSyncState("PENDING");
          setStatusMessage(`Device event chain needs reconciliation. ${remaining.length} drafts still queued.`);
          toastError("Device chain rejected", "Run Reconcile in the offline queue to repair the sync chain.");
          trackActivity("Device chain rejection returned during queue sync.", "danger");
        } else if (rejectionCodes.length > 0) {
          setSyncState("PENDING");
          setStatusMessage(`Partial sync complete. ${remaining.length} drafts still queued. ${rejectionCodes.join(", ")}`);
          toastWarning("Partial sync", `${acceptedCount} accepted, ${rejectionCodes.length} rejected.`);
          trackActivity("Partial queue sync completed.", "warning");
        } else if (remaining.length > 0) {
          setLastSyncAt(new Date());
          setSyncState("PENDING");
          setStatusMessage(`Synced ${acceptedCount} events. ${remaining.length} newer drafts queued — run sync again.`);
          toastInfo("More to sync", `${remaining.length} drafts were queued during upload.`);
          trackActivity("Uploaded a batch of queued offline events.", "success");
        } else {
          try {
            const downloadedCount = await pullServerEventsAfterQueueSync();
            setLastSyncAt(new Date());
            setSyncState("SYNCED");
            setStatusMessage(
              downloadedCount > 0
                ? `Draft queue synced. Pulled ${downloadedCount} server ${downloadedCount === 1 ? "event" : "events"}.`
                : "Draft queue synced."
            );
            toastSuccess(
              "Queue synced",
              downloadedCount > 0 ? `${downloadedCount} server ${downloadedCount === 1 ? "event" : "events"} downloaded.` : undefined
            );
            trackActivity(
              downloadedCount > 0
                ? `Uploaded queued offline events and acknowledged ${downloadedCount} server events.`
                : "Uploaded queued offline events.",
              "success"
            );
          } catch (error) {
            console.error("Server download checkpoint failed", error);
            setLastSyncAt(new Date());
            setSyncState("ERROR");
            setStatusMessage(`Draft queue uploaded, but server download checkpoint failed. (${errorReason(error)})`);
            toastError("Download checkpoint failed", "Uploads succeeded; retry sync to pull server events.");
            trackActivity("Queued events uploaded; download checkpoint failed.", "danger");
          }
        }
      } catch (error) {
        console.error("Draft sync failed", error);
        const reason = errorReason(error);
        setSyncState("PENDING");
        setStatusMessage(`Draft sync failed. Events remain queued. (${reason})`);
        toastError("Draft sync failed", reason);
        trackActivity("Draft upload failed.", "danger");
      }
    });
  }

  function handleExportDrafts() {
    const blob = new Blob([JSON.stringify(drafts, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `northline-draft-events-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
    link.click();
    // Give the browser time to start the download before revoking.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    trackActivity("Exported queued draft events.", "info");
  }

  async function handleRemoveDraft(eventId: string) {
    try {
      await removeDraftEvent(eventId);
      setDraftVersion((value) => value + 1);
      trackActivity(`Removed queued event ${eventId.slice(0, 8)}.`, "info");
    } catch (error) {
      console.error("Draft removal failed", error);
      const reason = errorReason(error);
      setStatusMessage(`Could not remove the queued event. (${reason})`);
      toastError("Could not remove queued event", reason);
    }
  }

  async function clearQueueNow() {
    await withPending("clear-queue", async () => {
      try {
        await clearDraftEvents();
        setDraftVersion((value) => value + 1);
        setSyncRepairReport(null);
        setStatusMessage("Draft queue cleared.");
        toastSuccess("Draft queue cleared");
        trackActivity("Cleared local draft queue.", "warning");
      } catch (error) {
        console.error("Queue clear failed", error);
        const reason = errorReason(error);
        setStatusMessage(`Draft queue could not be cleared. (${reason})`);
        toastError("Queue clear failed", reason);
      }
    });
  }

  function requestClearQueue() {
    setPendingConfirm({
      title: "Clear offline queue?",
      message: `This permanently deletes ${drafts.length} unsynced draft ${drafts.length === 1 ? "event" : "events"}. Export the queue first if you need a backup.`,
      confirmText: "Clear queue",
      variant: "danger",
      action: clearQueueNow
    });
  }

  async function handleReconcileSyncChain() {
    await withPending("reconcile", async () => {
      try {
        setSyncState("SYNCING");
        clearSyncCursor();
        let cursor: string | null = null;
        let downloaded = 0;
        // Loop until the server is drained, with a hard page cap.
        for (let page = 0; page < RECONCILE_MAX_PAGES; page += 1) {
          const response = await downloadEvents(cursor, 1000);
          if (response.events.length > 0) {
            await appendCachedServerEvents(response.events);
          }
          downloaded += response.events.length;
          const nextCursor = response.cursor ?? null;
          const drained = response.events.length < 1000 || !nextCursor || nextCursor === cursor;
          if (nextCursor) cursor = nextCursor;
          if (drained) break;
        }
        if (cursor) {
          await ackSyncCursor(cursor);
          writeSyncCursor(cursor);
        }
        // Re-read the queue after the async reconciliation pass so the status
        // reflects any draft changes made while the repair was running.
        const currentDrafts = await readDraftEvents();
        setDrafts(currentDrafts);
        setSyncState(currentDrafts.length ? "PENDING" : "SYNCED");
        setStatusMessage(`Reconciled server event history (${downloaded} events). Retry sync with ${currentDrafts.length} queued drafts.`);
        toastSuccess("Sync chain reconciled", `${downloaded} server ${downloaded === 1 ? "event" : "events"} downloaded.`);
        trackActivity(`Reconciled ${downloaded} server events for sync repair.`, "success");
      } catch (error) {
        console.error("Sync repair failed", error);
        const reason = errorReason(error);
        setSyncState("ERROR");
        setStatusMessage(`Sync repair failed. Keep the queue exported until connectivity and device trust are verified. (${reason})`);
        toastError("Sync repair failed", reason);
        trackActivity("Sync repair checkpoint failed.", "danger");
      }
    });
  }

  async function quarantineRejectedDraftsNow() {
    await withPending("quarantine", async () => {
      const rejectedIds = [
        ...new Set(
          (syncRepairReport?.rejected ?? [])
            .map((item) => item.event_id)
            .filter((id): id is string => Boolean(id))
        )
      ];
      try {
        // Remove only the rejected ids; events queued meanwhile are untouched.
        for (const eventId of rejectedIds) {
          await removeDraftEvent(eventId);
        }
        setDraftVersion((value) => value + 1);
        setStatusMessage(`Quarantined ${rejectedIds.length} rejected draft ${rejectedIds.length === 1 ? "event" : "events"}.`);
        toastWarning("Rejected drafts quarantined", `${rejectedIds.length} removed from the queue.`);
        trackActivity(`Quarantined ${rejectedIds.length} rejected draft events after sync review.`, "warning");
      } catch (error) {
        console.error("Quarantine failed", error);
        const reason = errorReason(error);
        setStatusMessage(`Rejected drafts could not be quarantined. (${reason})`);
        toastError("Quarantine failed", reason);
      }
    });
  }

  function requestQuarantineRejected() {
    const rejectedCount = new Set(
      (syncRepairReport?.rejected ?? []).map((item) => item.event_id).filter(Boolean)
    ).size;
    if (!rejectedCount) {
      setStatusMessage("No specific rejected event ids to quarantine.");
      return;
    }
    setPendingConfirm({
      title: "Quarantine rejected drafts?",
      message: `Removes ${rejectedCount} rejected draft ${rejectedCount === 1 ? "event" : "events"} from the queue. Export the queue first if you need the raw payloads.`,
      confirmText: "Quarantine",
      variant: "danger",
      action: quarantineRejectedDraftsNow
    });
  }

  async function handleConfirmAction() {
    if (!pendingConfirm) return;
    const { action } = pendingConfirm;
    setConfirmBusy(true);
    try {
      await action();
    } finally {
      setConfirmBusy(false);
      setPendingConfirm(null);
    }
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
    { id: "hazard", label: "Report Hazard", hint: "Safety", run: handleReportHazard },
    { id: "emergency", label: "Emergency Alert", hint: "Critical", run: () => requestEmergencyAlert() },
    { id: "training", label: "Generate Training", hint: "Learning", run: handleTraining },
    { id: "open-safety", label: "Open Safety Module", hint: "Navigation", run: () => setActiveModule("safety") },
    { id: "open-ops", label: "Open Operations Module", hint: "Navigation", run: () => setActiveModule("operations") }
  ];

  const filteredCommands = commandQuery.trim()
    ? quickCommands.filter((command) =>
        `${command.label} ${command.hint}`.toLowerCase().includes(commandQuery.trim().toLowerCase())
      )
    : [];

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
          <CardHeader
            actions={
              <Button variant="ghost" size="sm" onClick={() => togglePin("safety")}>
                <Icon name={pinnedModules.includes("safety") ? "PinOff" : "Pin"} size={16} />
                {pinnedModules.includes("safety") ? "Unpin" : "Pin"}
              </Button>
            }
          >
            <CardTitle>Mission safety gate</CardTitle>
            <CardDescription>{mode === "OFFSHORE" ? "Haul authorization readiness" : "Solo operator check-in cadence"}</CardDescription>
          </CardHeader>

          {mode === "OFFSHORE" ? (
            <>
              <div
                className="readiness-ring"
                role="progressbar"
                aria-valuenow={completionPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Haul readiness ${completionPercent}%`}
              >
                <div style={{ "--progress": `${completionPercent}%` } as CSSProperties}>
                  <strong>{completionPercent}%</strong>
                  <span>{completeChecks}/{checklistItems.length} checks</span>
                </div>
              </div>
              <Checklist
                items={checklistItems}
                onToggle={(id) => setChecklist((s) => ({ ...s, [id]: !s[id as keyof typeof s] }))}
              />
              <Button
                fullWidth
                disabled={!offshoreReady}
                loading={isPending("haul")}
                onClick={handleAuthorizeHaul}
                rightIcon={<Icon name="ArrowRight" size={16} />}
              >
                {offshoreReady ? "Authorize haul cycle" : "Complete all checks"}
              </Button>
            </>
          ) : (
            <>
              <div className="operator-status">
                <MetricTile label="check-in window" value="20m" tone="warning" icon="Timer" />
                <MetricTile label="heater reminders" value={heaterOn ? "On" : "Paused"} tone={heaterOn ? "good" : "neutral"} icon="Flame" />
              </div>
              {coReminderDue && (
                <SafetyAlert
                  type="equipment"
                  severity="medium"
                  title="Carbon monoxide check due"
                  message="25 minutes elapsed. Ventilate the shelter and check the heater before continuing."
                  onAcknowledge={() => {
                    setCoReminderDue(false);
                    trackActivity("Acknowledged CO ventilation reminder.", "info");
                  }}
                />
              )}
              <div className="action-row">
                <Button
                  onClick={handleScheduleCheckin}
                  loading={isPending("checkin-schedule")}
                  leftIcon={<Icon name="CalendarClock" size={16} />}
                >
                  Schedule check-in
                </Button>
                <Button
                  variant={checkinDone ? "success" : "secondary"}
                  onClick={handleCompleteCheckin}
                  disabled={!checkinScheduled || checkinDone}
                  loading={isPending("checkin-complete")}
                  leftIcon={<Icon name="CheckCircle2" size={16} />}
                >
                  {checkinDone ? "Check-in sent" : "I am safe"}
                </Button>
              </div>
              {!checkinScheduled && (
                <p className="meta">Schedule a check-in window before confirming you are safe.</p>
              )}
              <label className="toggle">
                <input type="checkbox" checked={heaterOn} onChange={(e) => setHeaterOn(e.target.checked)} />
                Heater alert reminders
              </label>
              <p className={heaterOn ? "warn" : "meta"}>
                {heaterOn
                  ? nextCoReminderAt
                    ? `CO reminder armed — next alert around ${nextCoReminderAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
                    : "CO reminder armed for 25-minute intervals."
                  : "CO reminder paused."}
              </p>
            </>
          )}
        </Card>

        <Card className="emergency-card" variant="solid">
          <CardHeader actions={<Badge variant={isOnline ? "success" : "warning"} dot pulse={!isOnline}>{isOnline ? "Online" : "Offline"}</Badge>}>
            <CardTitle>Emergency and queue</CardTitle>
            <CardDescription>Critical broadcast and offline event control</CardDescription>
          </CardHeader>
          <div className="action-stack">
            <Button
              variant="danger"
              size="lg"
              fullWidth
              onClick={requestEmergencyAlert}
              loading={isPending("emergency")}
              leftIcon={<Icon name="Siren" size={20} />}
            >
              Send emergency alert
            </Button>
            {emergencyRetryNeeded && (
              <SafetyAlert
                type="hazard"
                severity="critical"
                title="Emergency alert not sent"
                message={
                  isOnline
                    ? "The alert could not reach the server. Retry now, and use radio or phone backup channels if it keeps failing."
                    : "You appear offline. Retry as soon as signal returns, and use radio or phone backup channels meanwhile."
                }
              >
                <Button variant="danger" onClick={() => void sendEmergencyAlert()} loading={isPending("emergency")}>
                  Retry emergency alert
                </Button>
              </SafetyAlert>
            )}
            <Button
              variant="secondary"
              fullWidth
              onClick={handleSyncDrafts}
              disabled={!drafts.length}
              loading={isPending("sync")}
              leftIcon={<Icon name="UploadCloud" size={16} />}
            >
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
              <Button
                variant="ghost"
                size="sm"
                onClick={requestGenerateDeviceIdentity}
                loading={isPending("device-key")}
                leftIcon={<Icon name="KeyRound" size={16} />}
              >
                {deviceSigningReady ? "Rotate" : "Generate"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRegisterDeviceIdentity}
                disabled={!deviceSigningReady || deviceRegistered}
                loading={isPending("register-device")}
              >
                Register
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={requestClearDeviceIdentity}
                disabled={!deviceSigningReady}
                loading={isPending("device-clear")}
              >
                Clear
              </Button>
            </div>
            {deviceIdentity.publicKey && (
              <div className="public-key-row">
                <code>{deviceIdentity.publicKey.slice(0, 22)}...</code>
                <IconButton icon="Copy" label="Copy public key" size="sm" onClick={() => void copyPublicKey()} />
              </div>
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
          <CardHeader
            actions={
              <Button variant="ghost" size="sm" onClick={() => togglePin("operations")}>
                <Icon name={pinnedModules.includes("operations") ? "PinOff" : "Pin"} size={16} />
                {pinnedModules.includes("operations") ? "Unpin" : "Pin"}
              </Button>
            }
          >
            <CardTitle>Risk copilot</CardTitle>
            <CardDescription>Estimated blend of workload, weather, and safety signals</CardDescription>
          </CardHeader>
          <Button onClick={handleRiskScore} loading={isPending("risk")} leftIcon={<Icon name="Activity" size={16} />}>Recompute risk</Button>
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
              <small className="meta">Estimated from recent shift activity — not a live sensor feed.</small>
            </div>
          ) : (
            <p className="empty-state">No estimate yet. Run a risk check before the next operating decision.</p>
          )}
        </Card>

        <Card className="workflow-panel">
          <CardHeader>
            <CardTitle>{mode === "OFFSHORE" ? "Gear transition" : "Route confidence"}</CardTitle>
            <CardDescription>{mode === "OFFSHORE" ? "Update gear state with a synced field event" : "Return window and solo travel checks"}</CardDescription>
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
                <Button onClick={handleGearTransition} loading={isPending("gear")} rightIcon={<Icon name="Send" size={16} />}>Submit transition</Button>
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
        <CardHeader
          actions={
            <Button variant="ghost" size="sm" onClick={() => togglePin("hazards")}>
              <Icon name={pinnedModules.includes("hazards") ? "PinOff" : "Pin"} size={16} />
              {pinnedModules.includes("hazards") ? "Unpin" : "Pin"}
            </Button>
          }
        >
          <CardTitle>Shared hazard layer</CardTitle>
          <CardDescription>Report, refresh, and review hazards across connected crews</CardDescription>
        </CardHeader>
        <div className="action-row">
          <Button onClick={refreshAll} loading={isPending("refresh")} leftIcon={<Icon name="RefreshCw" size={16} />}>Refresh feed</Button>
          <Button variant="secondary" onClick={handleReportHazard} loading={isPending("hazard")} leftIcon={<Icon name="MapPinPlus" size={16} />}>Report hazard</Button>
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
        <CardHeader
          actions={
            <Button variant="ghost" size="sm" onClick={() => togglePin("learning")}>
              <Icon name={pinnedModules.includes("learning") ? "PinOff" : "Pin"} size={16} />
              {pinnedModules.includes("learning") ? "Unpin" : "Pin"}
            </Button>
          }
        >
          <CardTitle>Training coach</CardTitle>
          <CardDescription>Assignments driven by check-ins, compliance, and near misses</CardDescription>
        </CardHeader>
        <Button onClick={handleTraining} loading={isPending("training")} leftIcon={<Icon name="Sparkles" size={16} />}>Generate assignments</Button>
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
      {toast.container}
      <section className="mission-hero">
        <div className="hero-copy">
          <Badge variant={mode === "OFFSHORE" ? "cyan" : "teal"} dot>{mode === "OFFSHORE" ? "Offshore crew" : "Ice operator"}</Badge>
          <h1>Field Operations</h1>
          <p>{headerSubtitle}</p>
          <div className="hero-actions">
            <Button onClick={handleRiskScore} loading={isPending("risk")} leftIcon={<Icon name="Activity" size={16} />}>Risk now</Button>
            <Button variant="secondary" onClick={refreshAll} loading={isPending("refresh")} leftIcon={<Icon name="RefreshCw" size={16} />}>Refresh</Button>
            <Button
              variant="secondary"
              onClick={handleSyncDrafts}
              disabled={drafts.length === 0}
              loading={isPending("sync")}
              leftIcon={<Icon name="Upload" size={16} />}
            >
              Sync {drafts.length ? `(${drafts.length})` : ""}
            </Button>
          </div>
        </div>

        <Card className="hero-panel" hover={false}>
          <div className="hero-panel-top">
            <SyncIndicator
              state={syncStateMap[effectiveSyncState]}
              pendingCount={drafts.length}
              lastSync={lastSyncAt ?? undefined}
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
            <CardHeader actions={<Icon name="Command" size={20} />}>
              <CardTitle>Quick Command</CardTitle>
            </CardHeader>
            <Input
              value={commandQuery}
              onChange={(e) => setCommandQuery(e.target.value)}
              placeholder="Search actions..."
              aria-label="Search quick actions"
              leftIcon={<Icon name="Search" size={16} />}
            />
            <p className="sr-only" role="status" aria-live="polite">
              {commandQuery.trim()
                ? `${filteredCommands.length} matching ${filteredCommands.length === 1 ? "action" : "actions"}`
                : ""}
            </p>
            <div className="command-results">
              {(filteredCommands.length ? filteredCommands.slice(0, 5) : quickCommands.slice(0, 3)).map((command) => (
                <button key={command.id} type="button" className="command-option" onClick={() => command.run()}>
                  <span>{command.label}</span>
                  <Badge variant={command.hint === "Critical" ? "danger" : "default"} size="sm">{command.hint}</Badge>
                </button>
              ))}
            </div>
          </Card>

          <Card variant="glass" className="queue-card">
            <CardHeader actions={<Badge variant={drafts.length > 0 ? "warning" : "success"}>{drafts.length} events</Badge>}>
              <CardTitle>Offline Queue</CardTitle>
            </CardHeader>
            <div className="queue-actions">
              <Button variant="secondary" size="sm" onClick={handleExportDrafts} disabled={drafts.length === 0} leftIcon={<Icon name="Download" size={16} />}>Export</Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={requestClearQueue}
                disabled={drafts.length === 0}
                loading={isPending("clear-queue")}
                leftIcon={<Icon name="Trash2" size={16} />}
              >
                Clear
              </Button>
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
                  <IconButton icon="X" label="Remove" size="sm" onClick={() => void handleRemoveDraft(event.event_id)} />
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
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleReconcileSyncChain}
                    loading={isPending("reconcile")}
                    leftIcon={<Icon name="RefreshCw" size={16} />}
                  >
                    Reconcile
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={requestQuarantineRejected}
                    disabled={!syncRepairReport.rejected.length}
                    loading={isPending("quarantine")}
                  >
                    Quarantine rejected
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <Card variant="glass" className="notes-card">
            <CardHeader actions={<Badge variant="default">{shiftNotes.length}</Badge>}>
              <CardTitle>Shift Notes</CardTitle>
            </CardHeader>
            <Textarea
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="Write handoff notes..."
              aria-label="Shift handoff notes"
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
                type="button"
                className={`module-switch ${activeModule === module.id ? "active" : ""}`}
                aria-pressed={activeModule === module.id}
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

      <Card variant="outline" padding="sm" className="status-callout" role="status" aria-live="polite">
        <Icon name="Info" size={20} />
        <p>{statusMessage}</p>
      </Card>

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
            <CardHeader actions={<Icon name="ClipboardList" size={20} />}>
              <CardTitle>Latest Handoff Notes</CardTitle>
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

      <ConfirmModal
        open={pendingConfirm !== null}
        onClose={() => {
          if (!confirmBusy) setPendingConfirm(null);
        }}
        onConfirm={() => void handleConfirmAction()}
        title={pendingConfirm?.title ?? ""}
        message={pendingConfirm?.message ?? ""}
        confirmText={pendingConfirm?.confirmText}
        variant={pendingConfirm?.variant ?? "danger"}
        loading={confirmBusy}
      />
    </AppShell>
  );
}
