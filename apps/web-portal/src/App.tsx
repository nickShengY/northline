import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  createLot,
  generateComplianceExport,
  getDashboard,
  getOpenIncidents,
  getTripState,
  getTripTimeline,
  listDevices,
  listAuditEvents,
  listIntegrations,
  listLots,
  listRulesets,
  listTrips,
  registerDevice,
  revokeDevice,
  getSyncMetrics,
  scoreRisk,
  signCompliance,
  upsertRuleset,
  verifyCertificate,
  type AuditEventsResponse
} from "./lib/api";
import {
  clearPendingAction,
  clearPendingActions,
  queuePendingAction,
  readPendingActions,
  type PendingAction
} from "./lib/offline";
import type { KpiCard } from "./types";
import {
  BarChart,
  DonutChart,
  Sparkline,
  FleetMap,
  TripTimeline,
  RiskHeatMap,
  GearHealthDashboard,
  ComplianceProgress,
  SyncHealthMonitor,
  TraceabilityFlow
} from "./components/charts";
import {
  useFleetData,
  useRiskData,
  useGearData,
  useSyncData,
  useTripTimelineData,
  useComplianceData
} from "./hooks/useVisualizationData";
import { useMobileDetect, useChartExport } from "./hooks/useResizeObserver";
import { RealTimeFleetAI } from "./components/RealTimeFleetAI";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  ConfirmModal,
  Input,
  Textarea,
  Select,
  Badge,
  StatusBadge,
  RiskBadge,
  AppShell,
  PageHeader,
  Section,
  Grid,
  Stack,
  Icon,
  IconButton,
  ActivityList,
  useToast,
} from "@northline/ui";
import "@northline/ui/styles.css";

interface DashboardData {
  active_trips: number;
  missing_gear: number;
  compliance_issues_open: number;
  hazard_count: number;
}

interface TripLookupData {
  trip: { status: string; mode: string } | null;
  gear: Array<{ gear_id: string; status: string }>;
  hazards: Record<string, unknown>;
  // The server returns errors/warnings (no `issues` field).
  compliance: {
    completion_meter: number;
    errors: Array<{ code: string; severity: string; message: string }>;
    warnings: Array<{ code: string; severity: string; message: string }>;
  };
}

interface CertificateVerifyData {
  verified: boolean;
  reason?: string;
  certificate?: { certificate_id: string; lot_id: string; trip_id: string; issued_at: string };
}

interface RiskResultData {
  score: number;
  tier: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  rationale: string[];
  mitigations: string[];
}

interface OpenIncident {
  case_id: string;
  category: string;
  severity: number;
  summary: string;
}

interface AuditEventRow {
  audit_id: string;
  actor_id: string;
  actor_role: string;
  action: string;
  subject_type: string;
  subject_id: string;
  outcome: string;
  created_at: string;
}

interface TripRow {
  trip_id: string;
  status: string;
  mode: string;
}

interface WorkspacePreset {
  id: string;
  name: string;
  tripId: string;
  certificateId: string;
  lotId: string;
  createdAt: string;
}

interface ActivityLogItem {
  id: string;
  message: string;
  tone: "info" | "success" | "warning" | "danger";
  createdAt: string;
}

type RoleView = "CAPTAIN" | "COMPLIANCE" | "ADMIN" | "OWNER";
type CloseoutStepStatus = "READY" | "BLOCKED" | "DONE";
type DeviceSubjectType = "VESSEL" | "USER" | "GROUP" | "ORG";

interface DeviceRow {
  device_id: string;
  subject_type: DeviceSubjectType;
  subject_id?: string;
  revoked: boolean;
  key_version?: number;
  last_seen_at?: string;
}

function formatConnectionName(type: string) {
  const normalizedType = type.replace(/_/g, " ").toLowerCase();
  if (normalizedType.includes("ais")) return "Vessel position feed";
  if (normalizedType.includes("ai")) return "Decision support feed";
  return `${normalizedType.charAt(0).toUpperCase()}${normalizedType.slice(1)} feed`;
}

function formatDeviceLabel(subjectType: string) {
  return subjectType === "VESSEL"
    ? "Vessel station"
    : subjectType === "GROUP"
      ? "Crew group"
      : subjectType === "USER"
        ? "Crew device"
        : "Operations device";
}

function formatDeviceName(subjectType: string, index: number) {
  const label = formatDeviceLabel(subjectType);
  return index === 0 ? label : `${label} ${index + 1}`;
}

function formatTripLabel(id?: string) {
  if (!id) return "Not selected";
  const match = id.match(/trip_(ice_)?(?:demo_)?(\d+)$/i);
  if (match?.[2]) return `${match[1] ? "Ice trip" : "Trip"} ${match[2].padStart(3, "0")}`;
  return id;
}

function formatLotLabel(id?: string) {
  if (!id) return "Not created";
  const match = id.match(/lot_(?:demo_)?(\d+)$/i);
  return match?.[1] ? `Lot ${match[1].padStart(3, "0")}` : id;
}

function formatCertificateLabel(id?: string) {
  if (!id) return "Not verified";
  const match = id.match(/cert_(?:demo_)?(\d+)$/i);
  return match?.[1] ? `Certificate ${match[1].padStart(3, "0")}` : id;
}

function formatRulesetLabel(id: string) {
  if (id.includes("ice")) return "Ice operations";
  if (id.includes("offshore")) return "Offshore operations";
  return id.replace(/[_-]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function closeoutStatusLabel(status: CloseoutStepStatus) {
  if (status === "DONE") return "Done";
  if (status === "READY") return "Ready";
  return "Blocked";
}

const defaultDashboard: DashboardData = {
  active_trips: 0,
  missing_gear: 0,
  compliance_issues_open: 0,
  hazard_count: 0
};

const WORKSPACE_PRESETS_KEY = "northline.webportal.workspace_presets";
const ACTIVITY_LOG_KEY = "northline.webportal.activity_log";

// Hoisted so RealTimeFleetAI receives stable prop references; inline array
// literals would re-create props each render and churn its fetch intervals.
const FLEET_BOUNDING_BOX: [[number, number], [number, number]] = [[-170, 50], [-130, 70]]; // Bering Sea
const WEATHER_POSITION: [number, number] = [55, -165]; // Dutch Harbor area

function readJsonStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    // Validate the parsed shape: the callers store arrays, so reject anything else.
    if (Array.isArray(fallback) && !Array.isArray(parsed)) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable (private mode, quota); state stays in memory.
  }
}

export function App() {
  const [roleView, setRoleView] = useState<RoleView>("OWNER");
  const [tripId, setTripId] = useState("");
  const [certificateId, setCertificateId] = useState("");
  const [dashboard, setDashboard] = useState<DashboardData>(defaultDashboard);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [tripState, setTripState] = useState<TripLookupData | null>(null);
  const [tripError, setTripError] = useState<string | null>(null);
  const [certificateResult, setCertificateResult] = useState<CertificateVerifyData | null>(null);
  const [certificateError, setCertificateError] = useState<string | null>(null);
  const [riskResult, setRiskResult] = useState<RiskResultData | null>(null);
  const [riskError, setRiskError] = useState<string | null>(null);
  const [openIncidents, setOpenIncidents] = useState<OpenIncident[]>([]);
  const [tripRows, setTripRows] = useState<TripRow[]>([]);
  const [lotId, setLotId] = useState("");
  const [lotActionResult, setLotActionResult] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<PendingAction[]>(() => readPendingActions());
  const [showPendingActions, setShowPendingActions] = useState(false);
  const [integrations, setIntegrations] = useState<Array<{ integration_id: string; integration_type: string; enabled: boolean }>>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [syncMetrics, setSyncMetrics] = useState<Array<{ metric_name: string; avg_value: number; samples: number }> | null>(null);
  const [rulesets, setRulesets] = useState<Array<{ ruleset_id: string; mode: string; region_code: string; priority: number }>>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEventRow[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("Ops preset");
  const [workspacePresets, setWorkspacePresets] = useState<WorkspacePreset[]>(() =>
    readJsonStorage<WorkspacePreset[]>(WORKSPACE_PRESETS_KEY, [])
  );
  const [activityLog, setActivityLog] = useState<ActivityLogItem[]>(() =>
    readJsonStorage<ActivityLogItem[]>(ACTIVITY_LOG_KEY, [])
  );
  const [commandQuery, setCommandQuery] = useState("");
  const [selectedTripIds, setSelectedTripIds] = useState<string[]>([]);
  const [batchResult, setBatchResult] = useState<string | null>(null);
  const [deviceAdmin, setDeviceAdmin] = useState({
    deviceId: "",
    subjectType: "VESSEL" as DeviceSubjectType,
    subjectId: "",
    publicKey: ""
  });
  const [adminResult, setAdminResult] = useState<string | null>(null);
  const [rulesetDraft, setRulesetDraft] = useState({
    rulesetId: "ruleset_offshore_ops",
    mode: "OFFSHORE" as "OFFSHORE" | "ICE",
    regionCode: "AK",
    priority: 100
  });
  const [rulesetActionResult, setRulesetActionResult] = useState<string | null>(null);
  const [closeoutResult, setCloseoutResult] = useState<string | null>(null);
  // Per-step closeout completion, tracked explicitly instead of substring
  // matching the lotActionResult message.
  const [closeoutFlags, setCloseoutFlags] = useState({
    lotCreated: false,
    complianceSigned: false,
    exportGenerated: false
  });
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmText?: string;
    variant?: "default" | "danger";
    action: () => void | Promise<void>;
  } | null>(null);
  // Busy-state per action key: disables buttons in flight to prevent duplicate mutations.
  const [busyActions, setBusyActions] = useState<Record<string, boolean>>({});
  const inFlightRef = useRef<Set<string>>(new Set());

  const {
    success: toastSuccess,
    error: toastError,
    warning: toastWarning,
    info: toastInfo,
    container: toastContainer
  } = useToast();

  const isBusy = useCallback((key: string) => Boolean(busyActions[key]), [busyActions]);

  const runAction = useCallback(async (key: string, fn: () => Promise<unknown> | unknown): Promise<boolean> => {
    if (inFlightRef.current.has(key)) return false;
    inFlightRef.current.add(key);
    setBusyActions((previous) => ({ ...previous, [key]: true }));
    try {
      await fn();
      return true;
    } finally {
      inFlightRef.current.delete(key);
      setBusyActions((previous) => ({ ...previous, [key]: false }));
    }
  }, []);

  // Live data hooks for visualizations
  const { vessels: liveVessels, approximate: vesselsApproximate, loading: vesselsLoading, error: vesselsError, refetch: refetchVessels } = useFleetData(tripId || undefined, 30000);
  const { zones: liveRiskZones, loading: riskLoading, error: riskError2, refetch: refetchRisk } = useRiskData(60000);
  const { items: liveGearItems, loading: gearLoading, error: gearError, refetch: refetchGear } = useGearData(tripId || undefined, 30000);
  const { nodes: liveSyncNodes, loading: syncLoading, error: syncError, refetch: refetchSync } = useSyncData(15000);
  const { phases: liveTripPhases, loading: phasesLoading, error: phasesError, refetch: refetchPhases } = useTripTimelineData(tripId || undefined);
  const { checkpoints: liveCheckpoints, loading: complianceLoading, error: complianceError, refetch: refetchCompliance } = useComplianceData(tripId || undefined);

  // Mobile detection for responsive sizing
  const { isMobile, isTablet } = useMobileDetect();

  // Export functionality: each exportable chart gets its own container ref so
  // exports never grab the wrong SVG via document-wide selectors.
  const { exportToPNG } = useChartExport();
  const fleetMapRef = useRef<HTMLDivElement>(null);
  const riskHeatmapRef = useRef<HTMLDivElement>(null);
  const tripTimelineRef = useRef<HTMLDivElement>(null);
  const syncHealthRef = useRef<HTMLDivElement>(null);

  const handleExportChart = useCallback(async (container: HTMLDivElement | null, filenamePrefix: string) => {
    const svg = container?.querySelector("svg");
    if (!svg) {
      toastError("Export failed", "Chart is not ready to export yet.");
      return;
    }
    const filename = `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.png`;
    try {
      await exportToPNG(svg, filename);
      toastSuccess("Chart exported", filename);
    } catch {
      toastError("Export failed", "The chart could not be rendered to PNG.");
    }
  }, [exportToPNG, toastSuccess, toastError]);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const data = (await getDashboard()) as DashboardData;
        if (!mounted) return;
        setDashboard(data);
        setDashboardError(null);
      } catch {
        if (!mounted) return;
        setDashboardError("Dashboard unavailable. Check connection and sign in again.");
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, []);

  // Load initial trips exactly once on mount. Functional updates only fill the
  // trip/lot inputs when they are still empty, so a user's typed (or cleared)
  // value is never clobbered by a late response.
  useEffect(() => {
    let mounted = true;

    const loadInitialTrips = async () => {
      try {
        const response = (await listTrips()) as { trips?: TripRow[] };
        const rows = response.trips ?? [];
        if (!mounted) return;

        setTripRows(rows.slice(0, 6));
        const firstTripId = rows[0]?.trip_id;
        if (firstTripId) {
          setTripId((current) => current || firstTripId);
          setLotId((current) => current || `lot_${firstTripId}`);
        }
      } catch {
        if (!mounted) return;
        setTripRows([]);
      }
    };

    loadInitialTrips();
    return () => {
      mounted = false;
    };
  }, []);

  // A different trip means the closeout steps have to be redone.
  useEffect(() => {
    setCloseoutFlags({ lotCreated: false, complianceSigned: false, exportGenerated: false });
  }, [tripId]);

  const addActivity = useCallback((message: string, tone: ActivityLogItem["tone"] = "info") => {
    setActivityLog((previous) =>
      [{ id: crypto.randomUUID(), message, tone, createdAt: new Date().toISOString() }, ...previous].slice(0, 25)
    );
  }, []);

  useEffect(() => {
    writeJsonStorage(WORKSPACE_PRESETS_KEY, workspacePresets);
  }, [workspacePresets]);

  useEffect(() => {
    writeJsonStorage(ACTIVITY_LOG_KEY, activityLog);
  }, [activityLog]);

  const cards: KpiCard[] = useMemo(
    () => [
      { label: "Active trips", value: String(dashboard.active_trips), trend: "Live from event timeline" },
      { label: "Missing gear", value: String(dashboard.missing_gear), trend: "Gear watch active" },
      {
        label: "Compliance issues",
        value: String(dashboard.compliance_issues_open),
        trend: "Open blockers + warnings"
      },
      { label: "Known hazards", value: String(dashboard.hazard_count), trend: "Shared hazard layer" }
    ],
    [dashboard]
  );

  async function handleTripLookup(): Promise<boolean> {
    if (!tripId.trim()) {
      setTripError("Trip id is required.");
      return false;
    }
    try {
      const data = (await getTripState(tripId)) as TripLookupData;
      setTripState(data);
      setTripError(null);
      addActivity(`Loaded trip state for ${formatTripLabel(tripId)}.`, "success");
      toastSuccess("Trip state loaded", formatTripLabel(tripId));
      return true;
    } catch {
      setTripState(null);
      setTripError("Trip state unavailable for that id.");
      addActivity(`Trip lookup failed for ${formatTripLabel(tripId)}.`, "danger");
      toastError("Trip lookup failed", "Trip state unavailable for that id.");
      return false;
    }
  }

  async function handleVerifyCertificate(): Promise<boolean> {
    if (!certificateId.trim()) {
      setCertificateError("Certificate id is required.");
      return false;
    }
    try {
      const data = (await verifyCertificate(certificateId)) as CertificateVerifyData;
      setCertificateResult(data);
      setCertificateError(null);
      addActivity(`Verified ${formatCertificateLabel(certificateId)}.`, "success");
      toastSuccess("Certificate verified", formatCertificateLabel(certificateId));
      return true;
    } catch {
      setCertificateResult(null);
      setCertificateError("Certificate not found or unavailable in this workspace.");
      addActivity(`${formatCertificateLabel(certificateId)} verification failed.`, "warning");
      toastError("Verification failed", "Certificate not found or unavailable.");
      return false;
    }
  }

  function refreshPendingActions() {
    setPendingActions(readPendingActions());
  }

  function handleQueueOfflineLookup() {
    if (!tripId.trim()) {
      setTripError("Enter a trip id before queueing an offline lookup.");
      toastWarning("Nothing queued", "Enter a trip id before queueing an offline lookup.");
      return;
    }
    queuePendingAction({
      id: crypto.randomUUID(),
      action: "OPEN_TRIP",
      payload: { tripId: tripId.trim() },
      createdAt: new Date().toISOString()
    });
    refreshPendingActions();
    addActivity(`Queued offline lookup for ${formatTripLabel(tripId)}.`, "info");
    toastInfo("Lookup queued", `Offline lookup queued for ${formatTripLabel(tripId)}.`);
  }

  function handleClearPendingAction(id: string) {
    clearPendingAction(id);
    refreshPendingActions();
    addActivity("Removed one pending offline action.", "info");
  }

  function handleClearAllPendingActions() {
    clearPendingActions();
    refreshPendingActions();
    addActivity("Cleared the offline action queue.", "warning");
    toastInfo("Offline queue cleared");
  }

  async function handleRiskRefresh() {
    try {
      const [risk, incidents] = await Promise.all([
        scoreRisk({
          mode: "OFFSHORE",
          workloadIntensity: 64,
          weatherSeverity: 58,
          nearMissCount: 2,
          daylightHoursLeft: 4
        }),
        getOpenIncidents()
      ]);

      setRiskResult(risk as RiskResultData);
      setOpenIncidents(((incidents as { incidents?: OpenIncident[] }).incidents ?? []).slice(0, 3));
      setRiskError(null);
      addActivity("Risk monitor refreshed.", "success");
      toastSuccess("Risk monitor refreshed");
    } catch {
      setRiskError("Risk feed unavailable. Retry after connection recovery.");
      addActivity("Risk refresh failed.", "warning");
      toastError("Risk refresh failed", "Risk feed unavailable.");
    }
  }

  async function handleCreateLot(): Promise<boolean> {
    if (!tripId.trim() || !lotId.trim()) {
      setLotActionResult("Trip id and lot id are required.");
      return false;
    }
    try {
      await createLot({
        lot_id: lotId,
        trip_id: tripId,
        mode: "OFFSHORE",
        species_totals: { king_crab: 120 }
      });
      const lots = (await listLots()) as { lots?: Array<{ lot_id: string }> };
      setLotActionResult(`Lot ready. Total listed lots: ${(lots.lots ?? []).length}`);
      setCloseoutFlags((flags) => ({ ...flags, lotCreated: true }));
      addActivity(`Created or refreshed ${formatLotLabel(lotId)}.`, "success");
      toastSuccess("Lot ready", formatLotLabel(lotId));
      return true;
    } catch {
      setLotActionResult("Lot creation failed.");
      addActivity(`${formatLotLabel(lotId)} action failed.`, "danger");
      toastError("Lot creation failed", formatLotLabel(lotId));
      return false;
    }
  }

  async function handleSignCompliance(): Promise<boolean> {
    if (!tripId.trim()) {
      setLotActionResult("Trip id is required.");
      return false;
    }
    try {
      const pkgId = `pkg_${tripId}`;
      const response = (await signCompliance(tripId, pkgId)) as { compliance?: { completion_meter: number } };
      setLotActionResult(`Compliance signed. Completion meter ${response.compliance?.completion_meter ?? 0}%`);
      setCloseoutFlags((flags) => ({ ...flags, complianceSigned: true }));
      addActivity(`Signed compliance for ${formatTripLabel(tripId)}.`, "success");
      toastSuccess("Compliance signed", formatTripLabel(tripId));
      return true;
    } catch {
      setLotActionResult("Compliance sign-off failed.");
      addActivity(`Compliance sign failed for ${formatTripLabel(tripId)}.`, "danger");
      toastError("Compliance sign-off failed", formatTripLabel(tripId));
      return false;
    }
  }

  async function handleExportPackage(): Promise<boolean> {
    if (!tripId.trim()) {
      setLotActionResult("Trip id is required.");
      return false;
    }
    try {
      const response = (await generateComplianceExport(tripId)) as { artifact_id?: string };
      setLotActionResult(response.artifact_id ? "Export generated." : "Export generated with pending artifact label.");
      setCloseoutFlags((flags) => ({ ...flags, exportGenerated: true }));
      addActivity(`Generated export for ${formatTripLabel(tripId)}.`, "success");
      toastSuccess("Export generated", formatTripLabel(tripId));
      return true;
    } catch {
      setLotActionResult("Export generation failed.");
      addActivity(`Export failed for ${formatTripLabel(tripId)}.`, "danger");
      toastError("Export generation failed", formatTripLabel(tripId));
      return false;
    }
  }

  async function handleLoadTimeline() {
    if (!tripId.trim()) {
      addActivity("Set a trip id before loading timeline.", "warning");
      toastWarning("Timeline not loaded", "Set a trip id first.");
      return;
    }
    try {
      const [tripsResponse] = await Promise.all([
        listTrips(),
        getTripTimeline(tripId, 120)
      ]);

      const trips = (tripsResponse as { trips?: TripRow[] }).trips ?? [];

      setTripRows(trips.slice(0, 6));
      addActivity(`Loaded timeline and trip rows for ${formatTripLabel(tripId)}.`, "success");
      toastSuccess("Trips loaded", `${trips.length} trips available.`);
    } catch {
      addActivity("Timeline load failed.", "warning");
      toastError("Timeline load failed");
    }
  }

  async function handleLoadIntegrations() {
    try {
      const response = await listIntegrations() as {
        integrations?: Array<{ integration_id: string; integration_type: string; enabled: boolean }>;
        configs?: Array<{ integration_id: string; integration_type: string; enabled: boolean }>;
      };
      setIntegrations(response.integrations ?? response.configs ?? []);
      addActivity("Loaded integration status.", "success");
    } catch {
      setIntegrations([]);
      addActivity("Integration load failed.", "warning");
    }
  }

  async function handleLoadDevices() {
    try {
      const response = await listDevices() as { devices: DeviceRow[] };
      setDevices(response.devices ?? []);
      addActivity("Loaded registered devices.", "success");
    } catch {
      setDevices([]);
      addActivity("Device load failed.", "warning");
    }
  }

  async function handleLoadSyncMetrics() {
    try {
      const response = await getSyncMetrics(24) as { metrics: Array<{ metric_name: string; avg_value: number; samples: number }> };
      setSyncMetrics(response.metrics ?? null);
      addActivity("Loaded sync metrics.", "success");
    } catch {
      setSyncMetrics(null);
      addActivity("Sync metrics load failed.", "warning");
    }
  }

  async function handleLoadRulesets() {
    try {
      const response = await listRulesets() as { rulesets: Array<{ ruleset_id: string; mode: string; region_code: string; priority: number }> };
      setRulesets(response.rulesets ?? []);
      addActivity("Loaded rulesets.", "success");
    } catch {
      setRulesets([]);
      addActivity("Ruleset load failed.", "warning");
    }
  }

  async function handleLoadAuditEvents() {
    try {
      const response = await listAuditEvents(25) as AuditEventsResponse;
      setAuditEvents((response.events ?? []).map((event) => ({
        audit_id: event.audit_id,
        actor_id: event.actor_id,
        actor_role: event.actor_role,
        action: event.action,
        subject_type: event.subject_type,
        subject_id: event.subject_id,
        outcome: event.outcome,
        created_at: event.created_at
      })));
      setAuditError(null);
      addActivity("Loaded audit events.", "success");
    } catch {
      setAuditEvents([]);
      setAuditError("Audit events require an admin or owner session.");
      addActivity("Audit event load failed.", "warning");
    }
  }

  function handleSaveWorkspace() {
    const next: WorkspacePreset = {
      id: crypto.randomUUID(),
      name: workspaceName.trim() || `Workspace ${workspacePresets.length + 1}`,
      tripId,
      certificateId,
      lotId,
      createdAt: new Date().toISOString()
    };
    setWorkspacePresets((previous) => [next, ...previous].slice(0, 12));
    addActivity(`Saved workspace preset "${next.name}".`, "success");
    toastSuccess("Workspace preset saved", next.name);
  }

  function handleApplyWorkspace(preset: WorkspacePreset) {
    setTripId(preset.tripId);
    setCertificateId(preset.certificateId);
    setLotId(preset.lotId);
    addActivity(`Applied workspace preset "${preset.name}".`, "info");
  }

  function handleDeleteWorkspace(id: string) {
    setWorkspacePresets((previous) => previous.filter((preset) => preset.id !== id));
    addActivity("Deleted workspace preset.", "warning");
    toastInfo("Workspace preset deleted");
  }

  function toggleTripSelection(id: string) {
    setSelectedTripIds((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]
    );
  }

  async function handleBatchSignCompliance() {
    if (!selectedTripIds.length) {
      setBatchResult("No trips selected.");
      return;
    }

    let successCount = 0;
    for (const selectedTripId of selectedTripIds) {
      try {
        await signCompliance(selectedTripId, `pkg_${selectedTripId}`);
        successCount += 1;
      } catch {
        // continue and summarize partial result
      }
    }

    setBatchResult(`Compliance signed for ${successCount}/${selectedTripIds.length} selected trips.`);
    addActivity(`Batch compliance run completed (${successCount}/${selectedTripIds.length}).`, successCount ? "success" : "danger");
    if (successCount === selectedTripIds.length) {
      toastSuccess("Batch sign complete", `${successCount}/${selectedTripIds.length} trips signed.`);
    } else {
      toastWarning("Batch sign finished with failures", `${successCount}/${selectedTripIds.length} trips signed.`);
    }
  }

  async function handleBatchExport() {
    if (!selectedTripIds.length) {
      setBatchResult("No trips selected.");
      return;
    }

    let successCount = 0;
    for (const selectedTripId of selectedTripIds) {
      try {
        await generateComplianceExport(selectedTripId);
        successCount += 1;
      } catch {
        // continue and summarize partial result
      }
    }

    setBatchResult(`Export generated for ${successCount}/${selectedTripIds.length} selected trips.`);
    addActivity(`Batch export run completed (${successCount}/${selectedTripIds.length}).`, successCount ? "success" : "danger");
    if (successCount === selectedTripIds.length) {
      toastSuccess("Batch export complete", `${successCount}/${selectedTripIds.length} exports generated.`);
    } else {
      toastWarning("Batch export finished with failures", `${successCount}/${selectedTripIds.length} exports generated.`);
    }
  }

  async function handleRegisterAdminDevice() {
    if (!deviceAdmin.deviceId.trim() || !deviceAdmin.subjectId.trim() || !deviceAdmin.publicKey.trim()) {
      setAdminResult("Device id, subject id, and public key are required.");
      return;
    }

    try {
      await registerDevice({
        device_id: deviceAdmin.deviceId.trim(),
        subject_type: deviceAdmin.subjectType,
        subject_id: deviceAdmin.subjectId.trim(),
        public_key: deviceAdmin.publicKey.trim(),
        key_version: 1
      });
      setAdminResult(`Registered trusted ${formatDeviceLabel(deviceAdmin.subjectType).toLowerCase()}.`);
      addActivity(`Registered trusted device ${deviceAdmin.deviceId}.`, "success");
      toastSuccess("Device registered", deviceAdmin.deviceId);
      await handleLoadDevices();
    } catch {
      setAdminResult("Device registration failed. Check role, key format, and network state.");
      addActivity(`Device registration failed for ${deviceAdmin.deviceId || "new device"}.`, "danger");
      toastError("Device registration failed", "Check role, key format, and network state.");
    }
  }

  async function handleRevokeAdminDevice(deviceId = deviceAdmin.deviceId) {
    if (!deviceId.trim()) {
      setAdminResult("Select or enter a device id to revoke.");
      toastWarning("No device selected", "Select or enter a device id to revoke.");
      return;
    }

    try {
      await revokeDevice(deviceId.trim());
      setAdminResult(`Revoked ${deviceId.trim()}.`);
      addActivity(`Revoked trusted device ${deviceId.trim()}.`, "warning");
      toastSuccess("Device revoked", deviceId.trim());
      await handleLoadDevices();
    } catch {
      setAdminResult("Device revocation failed. Check permissions and try again.");
      addActivity(`Device revocation failed for ${deviceId.trim()}.`, "danger");
      toastError("Device revocation failed", "Check permissions and try again.");
    }
  }

  function requestRevokeDevice(deviceId = deviceAdmin.deviceId) {
    if (!deviceId.trim()) {
      setAdminResult("Select or enter a device id to revoke.");
      toastWarning("No device selected", "Select or enter a device id to revoke.");
      return;
    }
    setConfirmDialog({
      title: "Revoke trusted device",
      message: `Revoke ${deviceId.trim()}? The device can no longer sign or sync until re-registered.`,
      confirmText: "Revoke",
      variant: "danger",
      action: () => {
        void runAction(`revoke:${deviceId.trim()}`, () => handleRevokeAdminDevice(deviceId));
      }
    });
  }

  async function handlePublishRulesetDraft() {
    if (!rulesetDraft.rulesetId.trim() || !rulesetDraft.regionCode.trim()) {
      setRulesetActionResult("Ruleset id and region are required.");
      return;
    }

    try {
      await upsertRuleset({
        ruleset_id: rulesetDraft.rulesetId.trim(),
        mode: rulesetDraft.mode,
        region_code: rulesetDraft.regionCode.trim().toUpperCase(),
        // The API expects a calendar date (YYYY-MM-DD), not a full timestamp.
        effective_from: new Date().toISOString().slice(0, 10),
        priority: rulesetDraft.priority,
        rules_json: {
          source: "portal_policy_console",
          controls: {
            require_checkins: true,
            require_trace_lot_before_export: true,
            require_device_signature: true
          }
        }
      });
      setRulesetActionResult(`Published ${formatRulesetLabel(rulesetDraft.rulesetId)}.`);
      addActivity(`Published ruleset ${rulesetDraft.rulesetId}.`, "success");
      toastSuccess("Ruleset published", formatRulesetLabel(rulesetDraft.rulesetId));
      await handleLoadRulesets();
    } catch {
      setRulesetActionResult("Ruleset publish failed. Check admin role and policy values.");
      addActivity(`Ruleset publish failed for ${rulesetDraft.rulesetId}.`, "danger");
      toastError("Ruleset publish failed", "Check admin role and policy values.");
    }
  }

  function requestPublishRulesetDraft() {
    if (!rulesetDraft.rulesetId.trim() || !rulesetDraft.regionCode.trim()) {
      setRulesetActionResult("Ruleset id and region are required.");
      toastWarning("Draft incomplete", "Ruleset id and region are required.");
      return;
    }
    setConfirmDialog({
      title: "Publish ruleset",
      message: `Publish ${formatRulesetLabel(rulesetDraft.rulesetId)} for region ${rulesetDraft.regionCode.trim().toUpperCase()}? The policy takes effect immediately for the whole tenant.`,
      confirmText: "Publish",
      action: () => {
        void runAction("ruleset-publish", handlePublishRulesetDraft);
      }
    });
  }

  function requestBatchSignCompliance() {
    if (!selectedTripIds.length) {
      setBatchResult("No trips selected.");
      toastWarning("No trips selected", "Select trips before batch signing.");
      return;
    }
    setConfirmDialog({
      title: "Batch sign compliance",
      message: `Sign compliance packages for ${selectedTripIds.length} selected ${selectedTripIds.length === 1 ? "trip" : "trips"}? Sign-offs are recorded in the audit trail.`,
      confirmText: "Sign all",
      action: () => {
        void runAction("batch-sign", handleBatchSignCompliance);
      }
    });
  }

  function requestDeleteWorkspace(preset: WorkspacePreset) {
    setConfirmDialog({
      title: "Delete workspace preset",
      message: `Delete the preset "${preset.name}"? This cannot be undone.`,
      confirmText: "Delete",
      variant: "danger",
      action: () => handleDeleteWorkspace(preset.id)
    });
  }

  async function handleGuidedCloseout() {
    if (!tripId.trim()) {
      setCloseoutResult("Select a trip before running closeout.");
      toastWarning("Closeout not started", "Select a trip first.");
      return;
    }

    // Run every step and report real outcomes instead of assuming success.
    const steps: Array<{ name: string; run: () => Promise<boolean> }> = [
      { name: "trip state", run: handleTripLookup },
      { name: "trace lot", run: handleCreateLot },
      { name: "compliance sign", run: handleSignCompliance },
      { name: "export", run: handleExportPackage }
    ];

    const failures: string[] = [];
    for (const step of steps) {
      const succeeded = await step.run();
      if (!succeeded) failures.push(step.name);
    }

    const successCount = steps.length - failures.length;
    if (failures.length === 0) {
      setCloseoutResult(`Closeout completed: ${successCount}/${steps.length} steps succeeded.`);
      addActivity(`Guided closeout completed for ${formatTripLabel(tripId)} (${successCount}/${steps.length}).`, "success");
      toastSuccess("Closeout complete", `${successCount}/${steps.length} steps succeeded.`);
    } else {
      setCloseoutResult(
        `Closeout finished with issues: ${successCount}/${steps.length} steps succeeded. Failed: ${failures.join(", ")}.`
      );
      addActivity(
        `Guided closeout for ${formatTripLabel(tripId)} finished with failures (${failures.join(", ")}).`,
        "danger"
      );
      toastError("Closeout incomplete", `Failed steps: ${failures.join(", ")}.`);
    }
  }

  // Responsive chart dimensions
  const chartWidth = isMobile ? 280 : isTablet ? 350 : 400;
  const chartHeight = isMobile ? 180 : 250;
  const donutSize = isMobile ? 100 : 120;

  const vessels = liveVessels;
  const riskZones = liveRiskZones;
  const gearItems = liveGearItems;
  const syncNodes = liveSyncNodes;
  const tripPhases = liveTripPhases;
  const checkpoints = liveCheckpoints;

  const gearStatusChart = useMemo(() => {
    const counts = gearItems.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    }, {});
    const labels = Object.keys(counts);
    return labels.length
      ? {
          labels,
          datasets: [{ label: "Gear Items", data: labels.map((label) => counts[label] ?? 0), color: "var(--accent)" }]
        }
      : null;
  }, [gearItems]);

  const riskDistribution = useMemo(() => {
    const counts = riskZones.reduce<Record<"LOW" | "MODERATE" | "HIGH" | "CRITICAL", number>>(
      (acc, zone) => {
        acc[zone.severity] += 1;
        return acc;
      },
      { LOW: 0, MODERATE: 0, HIGH: 0, CRITICAL: 0 }
    );

    const colors = {
      LOW: "var(--success)",
      MODERATE: "var(--warning)",
      HIGH: "var(--danger)",
      // Token-derived critical tone, distinct from the HIGH danger color.
      CRITICAL: "var(--critical)"
    } as const;

    return (Object.keys(counts) as Array<keyof typeof counts>)
      .filter((key) => counts[key] > 0)
      .map((key) => ({ label: key, value: counts[key], color: colors[key] }));
  }, [riskZones]);

  const traceabilityStages = useMemo<Array<{ name: string; status: "COMPLETE" | "ACTIVE" | "PENDING"; data?: string }>>(() => {
    const complianceMeter = tripState?.compliance?.completion_meter ?? 0;
    return [
      { name: "Trip", status: tripId ? "COMPLETE" : "PENDING", data: formatTripLabel(tripId) },
      { name: "Lot", status: closeoutFlags.lotCreated ? "COMPLETE" : "PENDING", data: formatLotLabel(lotId) },
      {
        name: "Certificate",
        status: certificateResult?.verified ? "COMPLETE" : "PENDING",
        data: formatCertificateLabel(certificateId)
      },
      {
        name: "Compliance",
        status: complianceMeter >= 100 ? "COMPLETE" : complianceMeter > 0 ? "ACTIVE" : "PENDING",
        data: `${complianceMeter}%`
      },
      { name: "Export", status: closeoutFlags.exportGenerated ? "COMPLETE" : "PENDING" }
    ];
  }, [tripState, tripId, closeoutFlags, lotId, certificateResult, certificateId]);

  const statusTrendData = useMemo(() => {
    const byStatus = tripRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    }, {});
    const labels = Object.keys(byStatus);
    return labels.length
      ? {
          labels,
          datasets: [{ label: "Trips", data: labels.map((label) => byStatus[label] ?? 0), color: "var(--accent)" }]
        }
      : null;
  }, [tripRows]);

  const syncTrendData = useMemo(() => {
    const values = syncMetrics?.map((metric) => metric.avg_value) ?? [];
    return values.length ? values : null;
  }, [syncMetrics]);

  const closeoutSteps = useMemo<Array<{ id: string; label: string; detail: string; status: CloseoutStepStatus }>>(() => {
    // Server compliance payload carries errors + warnings (no `issues` field).
    const issueCount =
      (tripState?.compliance?.errors?.length ?? 0) + (tripState?.compliance?.warnings?.length ?? 0);
    const completion = tripState?.compliance?.completion_meter ?? 0;
    return [
      {
        id: "trip",
        label: "Trip state",
        detail: tripState?.trip ? `${formatTripLabel(tripId)} loaded` : "Load trip state before signing.",
        status: tripState?.trip ? "DONE" : tripId.trim() ? "READY" : "BLOCKED"
      },
      {
        id: "lot",
        label: "Trace lot",
        detail: lotId.trim() ? `${formatLotLabel(lotId)} selected` : "Create or select a lot id.",
        status: closeoutFlags.lotCreated ? "DONE" : lotId.trim() ? "READY" : "BLOCKED"
      },
      {
        id: "issues",
        label: "Compliance blockers",
        detail: issueCount ? `${issueCount} issue${issueCount === 1 ? " requires" : "s require"} review` : "No loaded blockers.",
        status: issueCount > 0 ? "BLOCKED" : completion >= 100 ? "DONE" : "READY"
      },
      {
        id: "sign",
        label: "Sign package",
        detail: "Create an auditable sign-off package for the selected trip.",
        status: closeoutFlags.complianceSigned ? "DONE" : tripId.trim() ? "READY" : "BLOCKED"
      },
      {
        id: "export",
        label: "Generate export",
        detail: "Produce the regulator or processor package artifact.",
        status: closeoutFlags.exportGenerated ? "DONE" : tripId.trim() ? "READY" : "BLOCKED"
      }
    ];
  }, [tripState, tripId, lotId, closeoutFlags]);

  const roleWorkflows: Record<RoleView, Array<{ title: string; metric: string; action: string; tone: "info" | "success" | "warning" | "danger" }>> = useMemo(
    () => ({
      OWNER: [
        { title: "Fleet health", metric: `${dashboard.active_trips} active trips`, action: "Review operating posture and export readiness.", tone: "info" },
        { title: "Compliance exposure", metric: `${dashboard.compliance_issues_open} open issues`, action: "Prioritize closeout blockers before landings.", tone: dashboard.compliance_issues_open ? "warning" : "success" },
        { title: "Risk posture", metric: `${openIncidents.length} open incidents loaded`, action: "Refresh risk and audit unresolved events.", tone: openIncidents.length ? "danger" : "success" }
      ],
      CAPTAIN: [
        { title: "Trip command", metric: formatTripLabel(tripId), action: "Load trip, inspect gear health, and run risk refresh.", tone: tripId ? "info" : "warning" },
        { title: "Deck safety", metric: riskResult ? `${riskResult.tier} ${Math.round(riskResult.score)}` : "No score", action: "Run risk scoring before haul or transit decisions.", tone: riskResult?.tier === "CRITICAL" || riskResult?.tier === "HIGH" ? "danger" : "info" },
        { title: "Incident control", metric: `${openIncidents.length} incidents`, action: "Confirm incident ownership and mitigations.", tone: openIncidents.length ? "warning" : "success" }
      ],
      COMPLIANCE: [
        { title: "Closeout readiness", metric: `${closeoutSteps.filter((step) => step.status === "DONE").length}/${closeoutSteps.length} steps`, action: "Run guided closeout and resolve blockers.", tone: closeoutSteps.some((step) => step.status === "BLOCKED") ? "warning" : "success" },
        { title: "Trace package", metric: formatLotLabel(lotId), action: "Verify lot, certificate, and export lineage.", tone: lotId ? "info" : "warning" },
        { title: "Audit evidence", metric: `${auditEvents.length} loaded events`, action: "Load audit events after sign/export actions.", tone: auditEvents.length ? "success" : "info" }
      ],
      ADMIN: [
        { title: "Trusted devices", metric: `${devices.filter((device) => !device.revoked).length} active`, action: "Register, revoke, and review signing devices.", tone: devices.some((device) => device.revoked) ? "warning" : "info" },
        { title: "Policy controls", metric: `${rulesets.length} rulesets loaded`, action: "Publish policy updates with audit trail.", tone: rulesets.length ? "success" : "info" },
        { title: "Sync health", metric: syncMetrics ? `${syncMetrics.length} metrics` : "Not loaded", action: "Load metrics and investigate rejection spikes.", tone: syncMetrics ? "success" : "warning" }
      ]
    }),
    [dashboard, openIncidents, tripId, riskResult, closeoutSteps, lotId, auditEvents, devices, rulesets, syncMetrics]
  );

  // Refresh all visualizations
  const handleRefreshAll = useCallback(() => {
    refetchVessels();
    refetchRisk();
    refetchGear();
    refetchSync();
    refetchPhases();
    refetchCompliance();
    addActivity("Refreshed all live visualizations.", "info");
  }, [refetchVessels, refetchRisk, refetchGear, refetchSync, refetchPhases, refetchCompliance]);

  const commandList = [
    { id: "cmd-trip", label: "Load Trip State", run: handleTripLookup },
    { id: "cmd-cert", label: "Verify Certificate", run: handleVerifyCertificate },
    { id: "cmd-risk", label: "Refresh Risk and Incidents", run: handleRiskRefresh },
    { id: "cmd-refresh", label: "Refresh All Visualizations", run: handleRefreshAll },
    { id: "cmd-timeline", label: "Load Timeline and Trips", run: handleLoadTimeline },
    { id: "cmd-integrations", label: "Load Connections", run: handleLoadIntegrations },
    { id: "cmd-devices", label: "Load Devices", run: handleLoadDevices },
    { id: "cmd-sync", label: "Load Sync Metrics", run: handleLoadSyncMetrics },
    { id: "cmd-rules", label: "Load Rulesets", run: handleLoadRulesets },
    { id: "cmd-audit", label: "Load Audit Events", run: handleLoadAuditEvents },
    { id: "cmd-closeout", label: "Run Guided Closeout", run: handleGuidedCloseout },
    { id: "cmd-rules-publish", label: "Publish Ruleset Draft", run: requestPublishRulesetDraft },
    { id: "cmd-save", label: "Save Workspace Preset", run: handleSaveWorkspace }
  ];

  const filteredCommands = commandQuery.trim()
    ? commandList.filter((item) => item.label.toLowerCase().includes(commandQuery.trim().toLowerCase()))
    : [];

  function runCommand(command: { id: string; label: string; run: () => void | Promise<unknown> }) {
    void runAction(`command:${command.id}`, command.run).then((ran) => {
      if (ran) toastInfo("Ran command", command.label);
    });
  }

  const toneLabels: Record<"info" | "success" | "warning" | "danger", string> = {
    info: "Overview",
    success: "Healthy",
    warning: "Attention",
    danger: "Action needed"
  };

  return (
    <AppShell maxWidth="xl">
      {/* Toast stack (rendered once near the root) */}
      {toastContainer}

      {/* Shared confirmation dialog for destructive / high-impact actions */}
      <ConfirmModal
        open={confirmDialog !== null}
        onClose={() => setConfirmDialog(null)}
        onConfirm={() => {
          const pending = confirmDialog;
          setConfirmDialog(null);
          if (pending) void pending.action();
        }}
        title={confirmDialog?.title ?? ""}
        message={confirmDialog?.message ?? ""}
        confirmText={confirmDialog?.confirmText ?? "Confirm"}
        variant={confirmDialog?.variant ?? "default"}
      />

      {/* Header */}
      <PageHeader
        title="Fleet Operations Portal"
        subtitle="Fleet, safety, and traceability in one operational timeline"
        eyebrow="Northline Command Surface"
      />

      {/* KPI Cards */}
      <Section>
        <Grid cols={4} gap="md">
          {cards.map((card, index) => (
            <Card key={card.label} variant="glass" className="animate-fade-in" style={{ animationDelay: `${index * 100}ms` }}>
              <CardContent>
                <p className="text-sm text-[var(--ink-muted)] mb-1">{card.label}</p>
                <p className="text-3xl font-bold text-[var(--ink-primary)]">{card.value}</p>
                <p className="text-xs text-[var(--ink-secondary)] mt-2">{card.trend}</p>
              </CardContent>
            </Card>
          ))}
        </Grid>
      </Section>

      {dashboardError && (
        <Section>
          <Card variant="outline" padding="sm">
            <p className="text-sm text-[var(--danger)]">{dashboardError}</p>
          </Card>
        </Section>
      )}

      <Section title="Role Command Center" description="Operational views tuned for the people who act on the data.">
        <Grid cols={4} gap="md">
          {(["OWNER", "CAPTAIN", "COMPLIANCE", "ADMIN"] as RoleView[]).map((role) => (
            <button
              key={role}
              type="button"
              className={`role-view-button ${roleView === role ? "active" : ""}`}
              onClick={() => setRoleView(role)}
              aria-pressed={roleView === role}
            >
              <span>{role === "OWNER" ? "Owner" : role === "CAPTAIN" ? "Captain" : role === "COMPLIANCE" ? "Compliance" : "Admin"}</span>
              <small>
                {role === "OWNER"
                  ? "Portfolio posture"
                  : role === "CAPTAIN"
                    ? "Trip command"
                    : role === "COMPLIANCE"
                      ? "Closeout desk"
                      : "Controls and devices"}
              </small>
            </button>
          ))}
        </Grid>
        <Grid cols={3} gap="md" className="mt-4">
          {roleWorkflows[roleView].map((workflow) => (
            <Card key={workflow.title} variant="glass">
              <CardContent>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-[var(--ink-muted)]">{workflow.title}</p>
                    <p className="text-xl font-bold">{workflow.metric}</p>
                  </div>
                  <Badge
                    variant={workflow.tone === "danger" ? "danger" : workflow.tone === "warning" ? "warning" : workflow.tone === "success" ? "success" : "info"}
                    size="sm"
                  >
                    {toneLabels[workflow.tone]}
                  </Badge>
                </div>
                <p className="text-sm text-[var(--ink-secondary)] mt-3">{workflow.action}</p>
              </CardContent>
            </Card>
          ))}
        </Grid>
      </Section>

      {/* Command Center & Workspace */}
      <Section>
        <Grid cols={3} gap="md">
          {/* Command Center */}
          <Card variant="glass">
            <CardHeader>
              <CardTitle>Command Center</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const first = filteredCommands[0];
                  if (first) {
                    runCommand(first);
                  } else {
                    toastWarning("No matching command", "Refine the search to find a command.");
                  }
                }}
              >
                <Input
                  label="Command search"
                  value={commandQuery}
                  onChange={(e) => setCommandQuery(e.target.value)}
                  placeholder="Type command..."
                  hint="Press Enter to run the first match."
                  leftIcon={<Icon name="Search" size={16} />}
                />
              </form>
              {filteredCommands.length > 0 && (
                <Stack gap="sm" className="mt-4">
                  {filteredCommands.slice(0, 6).map((command) => (
                    <Button
                      key={command.id}
                      variant="ghost"
                      size="sm"
                      loading={isBusy(`command:${command.id}`)}
                      onClick={() => runCommand(command)}
                    >
                      {command.label}
                    </Button>
                  ))}
                </Stack>
              )}
              {filteredCommands.length === 0 && (
                <p className="text-sm text-[var(--ink-muted)] mt-4">Search and run high-frequency operations.</p>
              )}
            </CardContent>
          </Card>

          {/* Workspace Presets */}
          <Card variant="glass">
            <CardHeader>
              <CardTitle>Workspace Presets</CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                label="Preset name"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder="Preset name"
              />
              <Button size="sm" className="mt-3" onClick={handleSaveWorkspace}>Save Current Context</Button>
              {workspacePresets.length > 0 && (
                <Stack gap="sm" className="mt-4">
                  {workspacePresets.slice(0, 4).map((preset) => (
                    <div key={preset.id} className="flex items-center justify-between p-2 rounded bg-[var(--bg-secondary)]">
                      <span className="text-sm">
                        <strong>{preset.name}</strong>
                        <span className="text-[var(--ink-muted)] ml-2">{formatTripLabel(preset.tripId)}</span>
                      </span>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => handleApplyWorkspace(preset)}>Apply</Button>
                        <IconButton icon="Trash2" label={`Delete preset ${preset.name}`} size="sm" onClick={() => requestDeleteWorkspace(preset)} />
                      </div>
                    </div>
                  ))}
                </Stack>
              )}
              {workspacePresets.length === 0 && (
                <p className="text-sm text-[var(--ink-muted)] mt-4">No saved presets yet.</p>
              )}
            </CardContent>
          </Card>

          {/* Batch Trip Tools */}
          <Card variant="glass">
            <CardHeader>
              <CardTitle>Batch Trip Tools</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" loading={isBusy("load-trips")} onClick={() => runAction("load-trips", handleLoadTimeline)}>Load Trips</Button>
                <Button variant="secondary" size="sm" loading={isBusy("batch-sign")} onClick={requestBatchSignCompliance}>Batch Sign</Button>
                <Button variant="secondary" size="sm" loading={isBusy("batch-export")} onClick={() => runAction("batch-export", handleBatchExport)}>Batch Export</Button>
              </div>
              {batchResult && <p className="text-sm text-[var(--ink-muted)] mt-3">{batchResult}</p>}
              {tripRows.length > 0 && (
                <Stack gap="sm" className="mt-4">
                  <p className="text-xs font-semibold text-[var(--ink-secondary)]">Select Trips</p>
                  {tripRows.map((trip) => (
                    <label key={trip.trip_id} className="flex items-center gap-2 p-2 rounded bg-[var(--bg-secondary)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedTripIds.includes(trip.trip_id)}
                        onChange={() => toggleTripSelection(trip.trip_id)}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">
                        <strong>{formatTripLabel(trip.trip_id)}</strong>
                        <StatusBadge status={trip.status === 'ACTIVE' ? 'synced' : 'pending'} size="sm" className="ml-2">{trip.status}</StatusBadge>
                        <span className="text-[var(--ink-muted)] ml-2">{trip.mode}</span>
                      </span>
                    </label>
                  ))}
                </Stack>
              )}
              {tripRows.length === 0 && (
                <p className="text-sm text-[var(--ink-muted)] mt-4">Load timeline to enable batch operations.</p>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Section>

      {/* Trip State & Certificate & Risk */}
      <Section>
        <Grid cols={4} gap="md">
          {/* Trip State Lookup */}
          <Card variant="glass">
            <CardHeader>
              <CardTitle>Trip State Lookup</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void runAction("trip-lookup", handleTripLookup);
                }}
              >
                <Input
                  label="Trip ID"
                  value={tripId}
                  onChange={(e) => setTripId(e.target.value)}
                  placeholder="Enter trip ID..."
                />
                <div className="flex gap-2 mt-3">
                  <Button type="submit" size="sm" loading={isBusy("trip-lookup")}>Load</Button>
                  <Button variant="secondary" size="sm" onClick={handleQueueOfflineLookup}>Queue Offline</Button>
                </div>
              </form>
              <p className="text-xs text-[var(--ink-muted)] mt-3">
                Pending: <Badge variant="info" size="sm">{pendingActions.length}</Badge>
                {pendingActions.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-2"
                    aria-expanded={showPendingActions}
                    onClick={() => setShowPendingActions((value) => !value)}
                  >
                    {showPendingActions ? "Hide" : "Review"}
                  </Button>
                )}
              </p>
              {showPendingActions && pendingActions.length > 0 && (
                <Stack gap="sm" className="mt-2">
                  {pendingActions.map((action) => (
                    <div key={action.id} className="flex items-center justify-between p-2 rounded bg-[var(--bg-secondary)]">
                      <span className="text-xs">
                        <strong>{action.action.replace(/_/g, " ")}</strong>
                        <span className="text-[var(--ink-muted)] ml-2">
                          {new Date(action.createdAt).toLocaleString()}
                        </span>
                      </span>
                      <IconButton
                        icon="XCircle"
                        label="Remove pending action"
                        size="sm"
                        onClick={() => handleClearPendingAction(action.id)}
                      />
                    </div>
                  ))}
                  <Button variant="secondary" size="sm" onClick={handleClearAllPendingActions}>
                    Clear All Pending
                  </Button>
                </Stack>
              )}
              {tripError && <p className="text-sm text-[var(--danger)] mt-2">{tripError}</p>}
              {tripState && (
                <Stack gap="sm" className="mt-4">
                  <div className="flex justify-between">
                    <span className="text-sm text-[var(--ink-muted)]">Status:</span>
                    <StatusBadge status={tripState.trip?.status === 'ACTIVE' ? 'synced' : 'pending'}>{tripState.trip?.status ?? 'UNKNOWN'}</StatusBadge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-[var(--ink-muted)]">Mode:</span>
                    <span className="text-sm">{tripState.trip?.mode ?? 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-[var(--ink-muted)]">Gear rows:</span>
                    <span className="text-sm">{tripState.gear.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-[var(--ink-muted)]">Compliance:</span>
                    <span className="text-sm">{tripState.compliance.completion_meter}%</span>
                  </div>
                </Stack>
              )}
            </CardContent>
          </Card>

          {/* Certificate Verification */}
          <Card variant="glass">
            <CardHeader>
              <CardTitle>Certificate Verification</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void runAction("verify-certificate", handleVerifyCertificate);
                }}
              >
                <Input
                  label="Certificate ID"
                  value={certificateId}
                  onChange={(e) => setCertificateId(e.target.value)}
                  placeholder="Enter certificate ID..."
                />
                <Button type="submit" size="sm" className="mt-3" loading={isBusy("verify-certificate")}>Verify</Button>
              </form>
              {certificateError && <p className="text-sm text-[var(--danger)] mt-2">{certificateError}</p>}
              {certificateResult?.verified && certificateResult.certificate && (
                <Stack gap="sm" className="mt-4">
                  <div className="flex justify-between">
                    <span className="text-sm text-[var(--ink-muted)]">Certificate:</span>
                    <Badge variant="success">{formatCertificateLabel(certificateResult.certificate.certificate_id)}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-[var(--ink-muted)]">Lot:</span>
                    <span className="text-sm">{formatLotLabel(certificateResult.certificate.lot_id)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-[var(--ink-muted)]">Trip:</span>
                    <span className="text-sm">{formatTripLabel(certificateResult.certificate.trip_id)}</span>
                  </div>
                </Stack>
              )}
            </CardContent>
          </Card>

          {/* Risk Monitor */}
          <Card variant="glass">
            <CardHeader>
              <CardTitle>Risk Monitor</CardTitle>
            </CardHeader>
            <CardContent>
              <Button size="sm" loading={isBusy("risk-refresh")} onClick={() => runAction("risk-refresh", handleRiskRefresh)}>Refresh Risk</Button>
              {riskError && <p className="text-sm text-[var(--danger)] mt-2">{riskError}</p>}
              {riskResult && (
                <Stack gap="sm" className="mt-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-[var(--ink-muted)]">Estimated posture score:</span>
                    <RiskBadge tier={riskResult.tier} score={riskResult.score} />
                  </div>
                  <p className="text-xs text-[var(--ink-muted)]">
                    Estimate computed from preset workload and weather inputs — not live deck telemetry.
                  </p>
                  {riskResult.rationale.slice(0, 2).map((line) => (
                    <p key={line} className="text-xs text-[var(--ink-secondary)]">{line}</p>
                  ))}
                </Stack>
              )}
              {!riskResult && <p className="text-sm text-[var(--ink-muted)] mt-4">No risk estimate computed yet.</p>}

              <p className="text-xs font-semibold text-[var(--ink-secondary)] mt-4 mb-2">Open Incidents</p>
              <Stack gap="sm">
                {openIncidents.slice(0, 3).map((incident) => (
                  <div key={incident.case_id} className="p-2 rounded bg-[var(--bg-secondary)]">
                    <div className="flex items-center gap-2">
                      <Badge variant="danger" size="sm">{incident.category}</Badge>
                      <span className="text-xs text-[var(--ink-muted)]">sev {incident.severity}</span>
                    </div>
                    <p className="text-xs text-[var(--ink-secondary)] mt-1">{incident.summary}</p>
                  </div>
                ))}
                {openIncidents.length === 0 && (
                  <p className="text-xs text-[var(--ink-muted)]">No open incidents.</p>
                )}
              </Stack>
            </CardContent>
          </Card>

          {/* Trace & Compliance */}
          <Card variant="glass">
            <CardHeader>
              <CardTitle>Guided Closeout</CardTitle>
              <CardDescription>Trace lot, sign, and export in one controlled workflow</CardDescription>
            </CardHeader>
            <CardContent>
              <Input
                label="Lot ID"
                value={lotId}
                onChange={(e) => setLotId(e.target.value)}
                placeholder="Enter lot ID..."
              />
              <div className="flex flex-wrap gap-2 mt-3">
                <Button size="sm" loading={isBusy("create-lot")} onClick={() => runAction("create-lot", handleCreateLot)}>Create Lot</Button>
                <Button variant="secondary" size="sm" loading={isBusy("sign-compliance")} onClick={() => runAction("sign-compliance", handleSignCompliance)}>Sign</Button>
                <Button variant="secondary" size="sm" loading={isBusy("export-package")} onClick={() => runAction("export-package", handleExportPackage)}>Export</Button>
                <Button variant="success" size="sm" loading={isBusy("guided-closeout")} onClick={() => runAction("guided-closeout", handleGuidedCloseout)}>Run</Button>
              </div>
              <Stack gap="sm" className="mt-4">
                {closeoutSteps.map((step) => (
                  <div key={step.id} className="workflow-step">
                    <span>
                      <strong>{step.label}</strong>
                      <small>{step.detail}</small>
                    </span>
                    <StatusBadge
                      status={step.status === "DONE" ? "synced" : step.status === "READY" ? "pending" : "error"}
                      size="sm"
                    >
                      {closeoutStatusLabel(step.status)}
                    </StatusBadge>
                  </div>
                ))}
              </Stack>
              {lotActionResult && <p className="text-sm text-[var(--ink-muted)] mt-3">{lotActionResult}</p>}
              {closeoutResult && <p className="text-sm text-[var(--success)] mt-2">{closeoutResult}</p>}
            </CardContent>
          </Card>
        </Grid>
      </Section>

      {/* Data Connections & Devices */}
      <Section>
        <Grid cols={3} gap="md">
          <Card variant="glass">
            <CardHeader>
              <CardTitle>Data Connections & Devices</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Button size="sm" loading={isBusy("load-integrations")} onClick={() => runAction("load-integrations", handleLoadIntegrations)}>Load Connections</Button>
                <Button variant="secondary" size="sm" loading={isBusy("load-devices")} onClick={() => runAction("load-devices", handleLoadDevices)}>Load Devices</Button>
                <Button variant="secondary" size="sm" loading={isBusy("load-sync-metrics")} onClick={() => runAction("load-sync-metrics", handleLoadSyncMetrics)}>Sync Metrics</Button>
              </div>

              {integrations.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold text-[var(--ink-secondary)] mb-2">Connections</p>
                  <Stack gap="sm">
                    {integrations.map((int) => (
                      <div key={int.integration_id} className="flex items-center justify-between p-2 rounded bg-[var(--bg-secondary)]">
                        <span className="text-sm">
                          <strong>{formatConnectionName(int.integration_type)}</strong>
                          <span className="text-[var(--ink-muted)] ml-2">Operational data</span>
                        </span>
                        <StatusBadge status={int.enabled ? 'synced' : 'pending'}>{int.enabled ? 'Enabled' : 'Disabled'}</StatusBadge>
                      </div>
                    ))}
                  </Stack>
                </div>
              )}

              {devices.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold text-[var(--ink-secondary)] mb-2">Registered Devices</p>
                  <Stack gap="sm">
                    {devices.map((dev, index) => (
                      <div key={dev.device_id} className="flex items-center justify-between p-2 rounded bg-[var(--bg-secondary)]">
                        <span className="text-sm">
                          <strong>{formatDeviceName(dev.subject_type, index)}</strong>
                          <span className="text-[var(--ink-muted)] ml-2">{dev.subject_id ?? formatDeviceLabel(dev.subject_type)}</span>
                        </span>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={dev.revoked ? 'error' : 'synced'}>{dev.revoked ? 'Revoked' : 'Active'}</StatusBadge>
                          {!dev.revoked && (
                            <IconButton icon="XCircle" label="Revoke device" size="sm" onClick={() => requestRevokeDevice(dev.device_id)} />
                          )}
                        </div>
                      </div>
                    ))}
                  </Stack>
                </div>
              )}

              <div className="admin-form mt-4">
                <p className="text-xs font-semibold text-[var(--ink-secondary)] mb-2">Register Trusted Device</p>
                <Input
                  label="Device ID"
                  value={deviceAdmin.deviceId}
                  onChange={(event) => setDeviceAdmin((current) => ({ ...current, deviceId: event.target.value }))}
                  placeholder="Device id"
                />
                <div className="admin-inline mt-2">
                  <Select
                    label="Subject type"
                    value={deviceAdmin.subjectType}
                    onChange={(event) => setDeviceAdmin((current) => ({ ...current, subjectType: event.target.value as DeviceSubjectType }))}
                    options={[
                      { value: "VESSEL", label: "Vessel" },
                      { value: "USER", label: "User" },
                      { value: "GROUP", label: "Group" },
                      { value: "ORG", label: "Org" }
                    ]}
                  />
                  <Input
                    label="Subject ID"
                    value={deviceAdmin.subjectId}
                    onChange={(event) => setDeviceAdmin((current) => ({ ...current, subjectId: event.target.value }))}
                    placeholder="Subject id"
                  />
                </div>
                <Textarea
                  label="Ed25519 public key"
                  value={deviceAdmin.publicKey}
                  onChange={(event) => setDeviceAdmin((current) => ({ ...current, publicKey: event.target.value }))}
                  placeholder="Ed25519 public key"
                  rows={2}
                  className="mt-2"
                />
                <div className="flex flex-wrap gap-2 mt-2">
                  <Button size="sm" loading={isBusy("register-device")} onClick={() => runAction("register-device", handleRegisterAdminDevice)}>Register</Button>
                  <Button variant="secondary" size="sm" onClick={() => requestRevokeDevice()}>Revoke Entered</Button>
                </div>
                {adminResult && <p className="text-sm text-[var(--ink-muted)] mt-2">{adminResult}</p>}
              </div>

              {syncMetrics && (
                <div className="mt-4">
                  <p className="text-xs font-semibold text-[var(--ink-secondary)] mb-2">Sync Health (24h)</p>
                  <Stack gap="sm">
                    {syncMetrics.map((m) => (
                      <div key={m.metric_name} className="flex items-center justify-between p-2 rounded bg-[var(--bg-secondary)]">
                        <span className="text-sm">{m.metric_name}</span>
                        <span className="text-sm">
                          <strong>{m.avg_value.toFixed(2)}</strong>
                          <span className="text-[var(--ink-muted)] ml-2">({m.samples} samples)</span>
                        </span>
                      </div>
                    ))}
                  </Stack>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Ruleset Management */}
          <Card variant="glass">
            <CardHeader>
              <CardTitle>Ruleset Management</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" loading={isBusy("load-rulesets")} onClick={() => runAction("load-rulesets", handleLoadRulesets)}>Load Rulesets</Button>
                <Button variant="secondary" size="sm" loading={isBusy("ruleset-publish")} onClick={requestPublishRulesetDraft}>Publish Draft</Button>
              </div>

              <div className="admin-form mt-4">
                <Input
                  label="Ruleset ID"
                  value={rulesetDraft.rulesetId}
                  onChange={(event) => setRulesetDraft((current) => ({ ...current, rulesetId: event.target.value }))}
                  placeholder="Ruleset id"
                />
                <div className="admin-inline mt-2">
                  <Select
                    label="Mode"
                    value={rulesetDraft.mode}
                    onChange={(event) => setRulesetDraft((current) => ({ ...current, mode: event.target.value as "OFFSHORE" | "ICE" }))}
                    options={[
                      { value: "OFFSHORE", label: "Offshore" },
                      { value: "ICE", label: "Ice" }
                    ]}
                  />
                  <Input
                    label="Region code"
                    value={rulesetDraft.regionCode}
                    onChange={(event) => setRulesetDraft((current) => ({ ...current, regionCode: event.target.value }))}
                    placeholder="Region"
                  />
                </div>
                <Input
                  label="Priority"
                  type="number"
                  value={rulesetDraft.priority}
                  onChange={(event) => setRulesetDraft((current) => ({ ...current, priority: Number(event.target.value) || 1 }))}
                  placeholder="Priority"
                  className="mt-2"
                />
                {rulesetActionResult && <p className="text-sm text-[var(--ink-muted)] mt-2">{rulesetActionResult}</p>}
              </div>

              {rulesets.length > 0 && (
                <Stack gap="sm" className="mt-4">
                  {rulesets.map((rs) => (
                    <div key={rs.ruleset_id} className="flex items-center justify-between p-2 rounded bg-[var(--bg-secondary)]">
                      <span className="text-sm">
                        <strong>{formatRulesetLabel(rs.ruleset_id)}</strong>
                        <Badge variant="info" size="sm" className="ml-2">{rs.mode}</Badge>
                      </span>
                      <span className="text-xs text-[var(--ink-muted)]">{rs.region_code} (P{rs.priority})</span>
                    </div>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>

          {/* Audit Console */}
          <Card variant="glass">
            <CardHeader>
              <CardTitle>Audit Console</CardTitle>
            </CardHeader>
            <CardContent>
              <Button size="sm" loading={isBusy("load-audit")} onClick={() => runAction("load-audit", handleLoadAuditEvents)}>Load Audit Events</Button>
              {auditError && <p className="text-sm text-[var(--danger)] mt-3">{auditError}</p>}
              {auditEvents.length > 0 && (
                <Stack gap="sm" className="mt-4">
                  {auditEvents.slice(0, 8).map((event) => (
                    <div key={event.audit_id} className="p-2 rounded bg-[var(--bg-secondary)]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm">
                          <strong>{event.action.replace(/_/g, " ")}</strong>
                          <span className="text-[var(--ink-muted)] ml-2">{event.actor_role}</span>
                        </span>
                        <StatusBadge status={event.outcome === "SUCCESS" ? "synced" : "error"} size="sm">
                          {event.outcome}
                        </StatusBadge>
                      </div>
                      <p className="text-xs text-[var(--ink-muted)] mt-1">
                        {event.actor_id} {"->"} {event.subject_type}:{event.subject_id}
                      </p>
                    </div>
                  ))}
                </Stack>
              )}
              {!auditError && auditEvents.length === 0 && (
                <p className="text-sm text-[var(--ink-muted)] mt-4">No audit events loaded.</p>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Section>

      {/* Activity Feed */}
      <Section title="Operations Activity Feed">
        <ActivityList
          items={activityLog.slice(0, 12).map((item) => ({
            id: item.id,
            title: item.message,
            timestamp: new Date(item.createdAt),
            type: item.tone === 'danger' ? 'danger' : item.tone === 'warning' ? 'warning' : item.tone === 'success' ? 'success' : 'info',
          }))}
        />
      </Section>

      {/* VISUALIZATION DASHBOARD */}
      <Section title="Operations Visualizations" description="Live charts built from trips, gear, hazards, and sync telemetry.">
        <Stack gap="md">
          {/* Real-Time Fleet & Weather */}
          <Card variant="glass">
            <CardHeader>
              <CardTitle>Real-Time Fleet and Weather</CardTitle>
              <CardDescription>
                Vessel positions from the AIS feed projected onto the Bering Sea operating region, with marine
                conditions sampled near Dutch Harbor.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RealTimeFleetAI
                boundingBox={FLEET_BOUNDING_BOX}
                weatherPosition={WEATHER_POSITION}
                width={isMobile ? 300 : 600}
                height={isMobile ? 200 : 300}
                enableAI={true}
              />
            </CardContent>
          </Card>

          {/* Fleet Map */}
          <Card variant="glass">
            <CardHeader
              actions={
                <Button
                  variant="secondary"
                  size="sm"
                  loading={isBusy("export-fleet-map")}
                  onClick={() => runAction("export-fleet-map", () => handleExportChart(fleetMapRef.current, "fleet-map"))}
                >
                  Export PNG
                </Button>
              }
            >
              <CardTitle>Fleet Tactical Map</CardTitle>
              <CardDescription>
                {vesselsLoading
                  ? "Loading live data..."
                  : vesselsError
                    ? `Error: ${vesselsError}`
                    : `${vessels.length} vessels tracked${vesselsApproximate ? " — approximate positions (no live geo data for some vessels)" : ""}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div ref={fleetMapRef}>
                <FleetMap vessels={vessels} width={chartWidth} height={chartHeight} />
              </div>
            </CardContent>
          </Card>

          <Grid cols={2} gap="md">
            {/* Risk Heat Map */}
            <Card variant="glass">
              <CardHeader
                actions={
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={isBusy("export-risk-heatmap")}
                    onClick={() => runAction("export-risk-heatmap", () => handleExportChart(riskHeatmapRef.current, "risk-heatmap"))}
                  >
                    Export PNG
                  </Button>
                }
              >
                <CardTitle>Risk Heat Map</CardTitle>
                <CardDescription>
                  {riskLoading ? "Loading risk data..." : riskError2 ? `Error: ${riskError2}` : `${riskZones.length} risk zones`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div ref={riskHeatmapRef}>
                  <RiskHeatMap zones={riskZones} width={isMobile ? 280 : 300} height={isMobile ? 160 : 200} />
                </div>
              </CardContent>
            </Card>

            {/* Trip Timeline */}
            <Card variant="glass">
              <CardHeader
                actions={
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={isBusy("export-trip-timeline")}
                    onClick={() => runAction("export-trip-timeline", () => handleExportChart(tripTimelineRef.current, "trip-timeline"))}
                  >
                    Export PNG
                  </Button>
                }
              >
                <CardTitle>Trip Phase Timeline</CardTitle>
                <CardDescription>
                  {phasesLoading ? "Loading timeline..." : phasesError ? `Error: ${phasesError}` : `${tripPhases.length} phases`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {tripPhases.length > 0 ? (
                  <div ref={tripTimelineRef}>
                    <TripTimeline phases={tripPhases} width={isMobile ? 280 : 400} height={isMobile ? 60 : 80} />
                  </div>
                ) : (
                  <p className="text-sm text-[var(--ink-muted)]">No trip timeline events available.</p>
                )}
              </CardContent>
            </Card>

            {/* Catch Analytics */}
            <Card variant="glass">
              <CardHeader>
                <CardTitle>Gear Status Distribution</CardTitle>
                <CardDescription>Live counts from current trip gear state</CardDescription>
              </CardHeader>
              <CardContent>
                {gearStatusChart ? (
                  <BarChart data={gearStatusChart} height={isMobile ? 120 : 150} />
                ) : (
                  <p className="text-sm text-[var(--ink-muted)]">No gear data available.</p>
                )}
              </CardContent>
            </Card>

            {/* Risk Distribution */}
            <Card variant="glass">
              <CardHeader>
                <CardTitle>Risk Distribution</CardTitle>
                <CardDescription>Fleet-wide risk tier breakdown</CardDescription>
              </CardHeader>
              <CardContent>
                {riskDistribution.length > 0 ? (
                  <div style={{ display: "flex", justifyContent: "center", padding: "1rem" }}>
                    <DonutChart
                      data={riskDistribution}
                      size={donutSize}
                      centerLabel={
                        <span style={{ fontSize: isMobile ? "1.2rem" : "1.5rem", fontWeight: 700, color: "var(--accent)" }}>
                          {riskDistribution.reduce((sum, item) => sum + item.value, 0)}
                        </span>
                      }
                    />
                  </div>
                ) : (
                  <p className="text-sm text-[var(--ink-muted)]">No risk-zone data available.</p>
                )}
              </CardContent>
            </Card>
          </Grid>

          {/* Gear Health Dashboard */}
          <Card variant="glass">
            <CardHeader
              actions={
                <Button variant="secondary" size="sm" onClick={refetchGear}>
                  Refresh
                </Button>
              }
            >
              <CardTitle>Gear Health Monitor</CardTitle>
              <CardDescription>
                {gearLoading ? "Loading gear data..." : gearError ? `Error: ${gearError}` : `${gearItems.length} gear items`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <GearHealthDashboard items={gearItems} />
            </CardContent>
          </Card>

          <Grid cols={2} gap="md">
            {/* Compliance Progress */}
            <Card variant="glass">
              <CardHeader>
                <CardTitle>Compliance Checklist</CardTitle>
                <CardDescription>
                  {complianceLoading
                    ? "Loading..."
                    : complianceError
                      ? `Error: ${complianceError}`
                      : `${checkpoints.filter(c => c.completed).length}/${checkpoints.length} complete`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {checkpoints.length > 0 ? (
                  <ComplianceProgress checkpoints={checkpoints} />
                ) : (
                  <p className="text-sm text-[var(--ink-muted)]">No compliance checkpoints loaded.</p>
                )}
              </CardContent>
            </Card>

            {/* Sync Health */}
            <Card variant="glass">
              <CardHeader
                actions={
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={isBusy("export-sync-health")}
                    onClick={() => runAction("export-sync-health", () => handleExportChart(syncHealthRef.current, "sync-health"))}
                  >
                    Export PNG
                  </Button>
                }
              >
                <CardTitle>Sync Network Health</CardTitle>
                <CardDescription>
                  {syncLoading ? "Loading sync data..." : syncError ? `Error: ${syncError}` : `${syncNodes.length} devices`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div ref={syncHealthRef}>
                  <SyncHealthMonitor nodes={syncNodes} />
                </div>
              </CardContent>
            </Card>
          </Grid>

          {/* Traceability Flow */}
          <Card variant="glass">
            <CardHeader>
              <CardTitle>Traceability Flow</CardTitle>
              <CardDescription>Lot lifecycle from catch to certificate</CardDescription>
            </CardHeader>
            <CardContent>
              <TraceabilityFlow
                stages={traceabilityStages}
                currentStage={Math.max(0, traceabilityStages.findIndex((stage) => stage.status === "ACTIVE"))}
              />
            </CardContent>
          </Card>

          <Grid cols={2} gap="md">
            {/* Trend Sparklines */}
            <Card variant="glass">
              <CardHeader>
                <CardTitle>24h Trends</CardTitle>
                <CardDescription>Sync metric snapshot</CardDescription>
              </CardHeader>
              <CardContent>
                {syncTrendData ? (
                  <Sparkline data={syncTrendData} color="var(--accent)" width={isMobile ? 200 : 300} />
                ) : (
                  <p className="text-sm text-[var(--ink-muted)]">Load sync metrics to view trend data.</p>
                )}
              </CardContent>
            </Card>

            {/* Trip Status Trends */}
            <Card variant="glass">
              <CardHeader>
                <CardTitle>Trip Status Trends</CardTitle>
                <CardDescription>Distribution of currently loaded trip states</CardDescription>
              </CardHeader>
              <CardContent>
                {statusTrendData ? (
                  <BarChart data={statusTrendData} height={isMobile ? 100 : 120} />
                ) : (
                  <p className="text-sm text-[var(--ink-muted)]">Load trip timeline data to view status trends.</p>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Stack>
      </Section>
    </AppShell>
  );
}
