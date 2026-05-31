import { useEffect, useMemo, useState, useCallback } from "react";
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
import { queuePendingAction, readPendingActions } from "./lib/offline";
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
import { LLMUsageDashboard } from "./components/LLMUsageDashboard";
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
  Badge,
  StatusBadge,
  RiskBadge,
  Spinner,
  StatusIndicator,
  ConnectionStatus,
  SyncIndicator,
  AppShell,
  PageHeader,
  Section,
  Grid,
  Stack,
  Divider,
  Navigation,
  Breadcrumbs,
  Icon,
  IconButton,
  ActivityList,
  List,
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
  compliance: { completion_meter: number; issues: Array<{ code: string; severity: string; message: string }> };
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

function readJsonStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
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
  const [timelineCount, setTimelineCount] = useState<number | null>(null);
  const [lotId, setLotId] = useState("");
  const [lotActionResult, setLotActionResult] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(() => readPendingActions().length);
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

  // Live data hooks for visualizations
  const { vessels: liveVessels, loading: vesselsLoading, error: vesselsError, refetch: refetchVessels } = useFleetData(tripId || undefined, 30000);
  const { zones: liveRiskZones, loading: riskLoading, error: riskError2, refetch: refetchRisk } = useRiskData(60000);
  const { items: liveGearItems, loading: gearLoading, error: gearError, refetch: refetchGear } = useGearData(tripId || undefined, 30000);
  const { nodes: liveSyncNodes, loading: syncLoading, error: syncError, refetch: refetchSync } = useSyncData(15000);
  const { phases: liveTripPhases, loading: phasesLoading, error: phasesError, refetch: refetchPhases } = useTripTimelineData(tripId || undefined);
  const { checkpoints: liveCheckpoints, loading: complianceLoading, error: complianceError, refetch: refetchCompliance } = useComplianceData(tripId || undefined);

  // Mobile detection for responsive sizing
  const { isMobile, isTablet } = useMobileDetect();

  // Export functionality
  const { exportToPNG } = useChartExport();

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

  useEffect(() => {
    let mounted = true;

    const loadInitialTrips = async () => {
      try {
        const response = (await listTrips()) as { trips?: TripRow[] };
        const rows = response.trips ?? [];
        if (!mounted) return;

        setTripRows(rows.slice(0, 6));
        if (!tripId && rows[0]?.trip_id) {
          const nextTripId = rows[0].trip_id;
          setTripId(nextTripId);
          if (!lotId) {
            setLotId(`lot_${nextTripId}`);
          }
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
  }, [tripId, lotId]);

  const addActivity = useCallback((message: string, tone: ActivityLogItem["tone"] = "info") => {
    setActivityLog((previous) =>
      [{ id: crypto.randomUUID(), message, tone, createdAt: new Date().toISOString() }, ...previous].slice(0, 25)
    );
  }, []);

  useEffect(() => {
    localStorage.setItem(WORKSPACE_PRESETS_KEY, JSON.stringify(workspacePresets));
  }, [workspacePresets]);

  useEffect(() => {
    localStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(activityLog));
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

  async function handleTripLookup() {
    if (!tripId.trim()) {
      setTripError("Trip id is required.");
      return;
    }
    try {
      const data = (await getTripState(tripId)) as TripLookupData;
      setTripState(data);
      setTripError(null);
      addActivity(`Loaded trip state for ${formatTripLabel(tripId)}.`, "success");
    } catch {
      setTripState(null);
      setTripError("Trip state unavailable for that id.");
      addActivity(`Trip lookup failed for ${formatTripLabel(tripId)}.`, "danger");
    }
  }

  async function handleVerifyCertificate() {
    if (!certificateId.trim()) {
      setCertificateError("Certificate id is required.");
      return;
    }
    try {
      const data = (await verifyCertificate(certificateId)) as CertificateVerifyData;
      setCertificateResult(data);
      setCertificateError(null);
      addActivity(`Verified ${formatCertificateLabel(certificateId)}.`, "success");
    } catch {
      setCertificateResult(null);
      setCertificateError("Certificate not found or unavailable in this workspace.");
      addActivity(`${formatCertificateLabel(certificateId)} verification failed.`, "warning");
    }
  }

  function handleQueueOfflineLookup() {
    queuePendingAction({
      id: crypto.randomUUID(),
      action: "OPEN_TRIP",
      payload: { tripId },
      createdAt: new Date().toISOString()
    });
    setPendingCount(readPendingActions().length);
    addActivity(`Queued offline lookup for ${formatTripLabel(tripId)}.`, "info");
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
    } catch {
      setRiskError("Risk feed unavailable. Retry after connection recovery.");
      addActivity("Risk refresh failed.", "warning");
    }
  }

  async function handleCreateLot() {
    if (!tripId.trim() || !lotId.trim()) {
      setLotActionResult("Trip id and lot id are required.");
      return;
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
      addActivity(`Created or refreshed ${formatLotLabel(lotId)}.`, "success");
    } catch {
      setLotActionResult("Lot creation failed.");
      addActivity(`${formatLotLabel(lotId)} action failed.`, "danger");
    }
  }

  async function handleSignCompliance() {
    if (!tripId.trim()) {
      setLotActionResult("Trip id is required.");
      return;
    }
    try {
      const pkgId = `pkg_${tripId}`;
      const response = (await signCompliance(tripId, pkgId)) as { compliance?: { completion_meter: number } };
      setLotActionResult(`Compliance signed. Completion meter ${response.compliance?.completion_meter ?? 0}%`);
      addActivity(`Signed compliance for ${formatTripLabel(tripId)}.`, "success");
    } catch {
      setLotActionResult("Compliance sign-off failed.");
      addActivity(`Compliance sign failed for ${formatTripLabel(tripId)}.`, "danger");
    }
  }

  async function handleExportPackage() {
    if (!tripId.trim()) {
      setLotActionResult("Trip id is required.");
      return;
    }
    try {
      const response = (await generateComplianceExport(tripId)) as { artifact_id?: string };
      setLotActionResult(response.artifact_id ? "Export generated." : "Export generated with pending artifact label.");
      addActivity(`Generated export for ${formatTripLabel(tripId)}.`, "success");
    } catch {
      setLotActionResult("Export generation failed.");
      addActivity(`Export failed for ${formatTripLabel(tripId)}.`, "danger");
    }
  }

  async function handleLoadTimeline() {
    if (!tripId.trim()) {
      addActivity("Set a trip id before loading timeline.", "warning");
      return;
    }
    try {
      const [tripsResponse, timelineResponse] = await Promise.all([
        listTrips(),
        getTripTimeline(tripId, 120)
      ]);

      const trips = (tripsResponse as { trips?: TripRow[] }).trips ?? [];
      const timeline = timelineResponse as { count?: number };

      setTripRows(trips.slice(0, 6));
      setTimelineCount(timeline.count ?? 0);
      addActivity(`Loaded timeline and trip rows for ${formatTripLabel(tripId)}.`, "success");
    } catch {
      setTimelineCount(null);
      addActivity("Timeline load failed.", "warning");
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
      await handleLoadDevices();
    } catch {
      setAdminResult("Device registration failed. Check role, key format, and network state.");
      addActivity(`Device registration failed for ${deviceAdmin.deviceId || "new device"}.`, "danger");
    }
  }

  async function handleRevokeAdminDevice(deviceId = deviceAdmin.deviceId) {
    if (!deviceId.trim()) {
      setAdminResult("Select or enter a device id to revoke.");
      return;
    }

    try {
      await revokeDevice(deviceId.trim());
      setAdminResult(`Revoked ${deviceId.trim()}.`);
      addActivity(`Revoked trusted device ${deviceId.trim()}.`, "warning");
      await handleLoadDevices();
    } catch {
      setAdminResult("Device revocation failed. Check permissions and try again.");
      addActivity(`Device revocation failed for ${deviceId.trim()}.`, "danger");
    }
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
        effective_from: new Date().toISOString(),
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
      await handleLoadRulesets();
    } catch {
      setRulesetActionResult("Ruleset publish failed. Check admin role and policy values.");
      addActivity(`Ruleset publish failed for ${rulesetDraft.rulesetId}.`, "danger");
    }
  }

  async function handleGuidedCloseout() {
    if (!tripId.trim()) {
      setCloseoutResult("Select a trip before running closeout.");
      return;
    }

    await handleTripLookup();
    await handleCreateLot();
    await handleSignCompliance();
    await handleExportPackage();
    setCloseoutResult("Closeout run completed. Review warnings, audit events, and generated export status.");
    addActivity(`Guided closeout run completed for ${formatTripLabel(tripId)}.`, "success");
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
      CRITICAL: "#ff0040"
    } as const;

    return (Object.keys(counts) as Array<keyof typeof counts>)
      .filter((key) => counts[key] > 0)
      .map((key) => ({ label: key, value: counts[key], color: colors[key] }));
  }, [riskZones]);

  const traceabilityStages = useMemo<Array<{ name: string; status: "COMPLETE" | "ACTIVE" | "PENDING"; data?: string }>>(() => {
    const complianceMeter = tripState?.compliance?.completion_meter ?? 0;
    return [
      { name: "Trip", status: tripId ? "COMPLETE" : "PENDING", data: formatTripLabel(tripId) },
      { name: "Lot", status: lotActionResult ? "COMPLETE" : "PENDING", data: formatLotLabel(lotId) },
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
      { name: "Export", status: lotActionResult?.includes("Export generated") ? "COMPLETE" : "PENDING" }
    ];
  }, [tripState, tripId, lotActionResult, lotId, certificateResult, certificateId]);

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
    const issueCount = tripState?.compliance?.issues?.length ?? 0;
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
        status: lotActionResult?.includes("Lot ready") ? "DONE" : lotId.trim() ? "READY" : "BLOCKED"
      },
      {
        id: "issues",
        label: "Compliance blockers",
        detail: issueCount ? `${issueCount} issue ${issueCount === 1 ? "requires" : "require"} review` : "No loaded blockers.",
        status: issueCount > 0 ? "BLOCKED" : completion >= 100 ? "DONE" : "READY"
      },
      {
        id: "sign",
        label: "Sign package",
        detail: "Create an auditable sign-off package for the selected trip.",
        status: lotActionResult?.includes("Compliance signed") ? "DONE" : tripId.trim() ? "READY" : "BLOCKED"
      },
      {
        id: "export",
        label: "Generate export",
        detail: "Produce the regulator or processor package artifact.",
        status: lotActionResult?.includes("Export generated") ? "DONE" : tripId.trim() ? "READY" : "BLOCKED"
      }
    ];
  }, [tripState, tripId, lotId, lotActionResult]);

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
    { id: "cmd-rules-publish", label: "Publish Ruleset Draft", run: handlePublishRulesetDraft },
    { id: "cmd-save", label: "Save Workspace Preset", run: handleSaveWorkspace }
  ];

  const filteredCommands = commandQuery.trim()
    ? commandList.filter((item) => item.label.toLowerCase().includes(commandQuery.trim().toLowerCase()))
    : [];

  return (
    <AppShell maxWidth="xl">
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
              className={`role-view-button ${roleView === role ? "active" : ""}`}
              onClick={() => setRoleView(role)}
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
                    {workflow.tone}
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
              <Input
                value={commandQuery}
                onChange={(e) => setCommandQuery(e.target.value)}
                placeholder="Type command..."
                leftIcon={<Icon name="Search" size={16} />}
              />
              {filteredCommands.length > 0 && (
                <Stack gap="sm" className="mt-4">
                  {filteredCommands.slice(0, 6).map((command) => (
                    <Button key={command.id} variant="ghost" size="sm" onClick={() => command.run()}>
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
                        <IconButton icon="Trash2" label="Delete" size="sm" onClick={() => handleDeleteWorkspace(preset.id)} />
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
                <Button size="sm" onClick={handleLoadTimeline}>Load Trips</Button>
                <Button variant="secondary" size="sm" onClick={handleBatchSignCompliance}>Batch Sign</Button>
                <Button variant="secondary" size="sm" onClick={handleBatchExport}>Batch Export</Button>
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
              <Input
                value={tripId}
                onChange={(e) => setTripId(e.target.value)}
                placeholder="Enter trip ID..."
              />
              <div className="flex gap-2 mt-3">
                <Button size="sm" onClick={handleTripLookup}>Load</Button>
                <Button variant="secondary" size="sm" onClick={handleQueueOfflineLookup}>Queue Offline</Button>
              </div>
              <p className="text-xs text-[var(--ink-muted)] mt-3">
                Pending: <Badge variant="info" size="sm">{pendingCount}</Badge>
              </p>
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
              <Input
                value={certificateId}
                onChange={(e) => setCertificateId(e.target.value)}
                placeholder="Enter certificate ID..."
              />
              <Button size="sm" className="mt-3" onClick={handleVerifyCertificate}>Verify</Button>
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
              <Button size="sm" onClick={handleRiskRefresh}>Refresh Risk</Button>
              {riskError && <p className="text-sm text-[var(--danger)] mt-2">{riskError}</p>}
              {riskResult && (
                <Stack gap="sm" className="mt-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-[var(--ink-muted)]">Deck Risk:</span>
                    <RiskBadge tier={riskResult.tier} score={riskResult.score} />
                  </div>
                  {riskResult.rationale.slice(0, 2).map((line) => (
                    <p key={line} className="text-xs text-[var(--ink-secondary)]">{line}</p>
                  ))}
                </Stack>
              )}
              {!riskResult && <p className="text-sm text-[var(--ink-muted)] mt-4">No live risk computation yet.</p>}

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
                value={lotId}
                onChange={(e) => setLotId(e.target.value)}
                placeholder="Enter lot ID..."
              />
              <div className="flex flex-wrap gap-2 mt-3">
                <Button size="sm" onClick={handleCreateLot}>Create Lot</Button>
                <Button variant="secondary" size="sm" onClick={handleSignCompliance}>Sign</Button>
                <Button variant="secondary" size="sm" onClick={handleExportPackage}>Export</Button>
                <Button variant="success" size="sm" onClick={handleGuidedCloseout}>Run</Button>
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
                <Button size="sm" onClick={handleLoadIntegrations}>Load Connections</Button>
                <Button variant="secondary" size="sm" onClick={handleLoadDevices}>Load Devices</Button>
                <Button variant="secondary" size="sm" onClick={handleLoadSyncMetrics}>Sync Metrics</Button>
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
                            <IconButton icon="XCircle" label="Revoke device" size="sm" onClick={() => handleRevokeAdminDevice(dev.device_id)} />
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
                  value={deviceAdmin.deviceId}
                  onChange={(event) => setDeviceAdmin((current) => ({ ...current, deviceId: event.target.value }))}
                  placeholder="Device id"
                />
                <div className="admin-inline mt-2">
                  <select
                    value={deviceAdmin.subjectType}
                    onChange={(event) => setDeviceAdmin((current) => ({ ...current, subjectType: event.target.value as DeviceSubjectType }))}
                  >
                    <option value="VESSEL">Vessel</option>
                    <option value="USER">User</option>
                    <option value="GROUP">Group</option>
                    <option value="ORG">Org</option>
                  </select>
                  <Input
                    value={deviceAdmin.subjectId}
                    onChange={(event) => setDeviceAdmin((current) => ({ ...current, subjectId: event.target.value }))}
                    placeholder="Subject id"
                  />
                </div>
                <Textarea
                  value={deviceAdmin.publicKey}
                  onChange={(event) => setDeviceAdmin((current) => ({ ...current, publicKey: event.target.value }))}
                  placeholder="Ed25519 public key"
                  rows={2}
                  className="mt-2"
                />
                <div className="flex flex-wrap gap-2 mt-2">
                  <Button size="sm" onClick={handleRegisterAdminDevice}>Register</Button>
                  <Button variant="secondary" size="sm" onClick={() => handleRevokeAdminDevice()}>Revoke Entered</Button>
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
                <Button size="sm" onClick={handleLoadRulesets}>Load Rulesets</Button>
                <Button variant="secondary" size="sm" onClick={handlePublishRulesetDraft}>Publish Draft</Button>
              </div>

              <div className="admin-form mt-4">
                <Input
                  value={rulesetDraft.rulesetId}
                  onChange={(event) => setRulesetDraft((current) => ({ ...current, rulesetId: event.target.value }))}
                  placeholder="Ruleset id"
                />
                <div className="admin-inline mt-2">
                  <select
                    value={rulesetDraft.mode}
                    onChange={(event) => setRulesetDraft((current) => ({ ...current, mode: event.target.value as "OFFSHORE" | "ICE" }))}
                  >
                    <option value="OFFSHORE">Offshore</option>
                    <option value="ICE">Ice</option>
                  </select>
                  <Input
                    value={rulesetDraft.regionCode}
                    onChange={(event) => setRulesetDraft((current) => ({ ...current, regionCode: event.target.value }))}
                    placeholder="Region"
                  />
                </div>
                <Input
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
              <Button size="sm" onClick={handleLoadAuditEvents}>Load Audit Events</Button>
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
      <section className="panel-grid">
        <div className="viz-section-header" style={{ gridColumn: "1 / -1", marginTop: "2rem", marginBottom: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>Operations Visualizations</h2>
        </div>

        {/* Real-Time Fleet & Weather Section */}
        <article className="panel" style={{ gridColumn: "1 / -1" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <div>
              <h3>Real-Time Fleet and Weather</h3>
              <p className="muted">Live vessel positions and marine conditions for the active operating area.</p>
            </div>
          </div>
          <RealTimeFleetAI
            boundingBox={[[-170, 50], [-130, 70]]} // Bering Sea
            weatherPosition={[55, -165]} // Dutch Harbor area
            width={isMobile ? 300 : 600}
            height={isMobile ? 200 : 300}
            enableAI={true}
            mode="OFFSHORE"
          />
        </article>

        {/* Fleet Map */}
        <article className="glass-card panel viz-panel animate-fade-in">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <h3>Fleet Tactical Map</h3>
            <button
              className="secondary"
              style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
              onClick={() => {
                const svg = document.querySelector(".fleet-map") as SVGSVGElement;
                if (svg) exportToPNG(svg, `fleet-map-${new Date().toISOString().slice(0, 10)}.png`);
              }}
            >
              Export PNG
            </button>
          </div>
          <p className="muted">{vesselsLoading ? "Loading live data..." : vesselsError ? `Error: ${vesselsError}` : `${vessels.length} vessels tracked`}</p>
          <FleetMap vessels={vessels} width={chartWidth} height={chartHeight} />
        </article>

        {/* Risk Heat Map */}
        <article className="glass-card panel animate-fade-in">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <h3>Risk Heat Map</h3>
            <button
              className="secondary"
              style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
              onClick={() => {
                const svg = document.querySelector(".risk-heatmap") as SVGSVGElement;
                if (svg) exportToPNG(svg, `risk-heatmap-${new Date().toISOString().slice(0, 10)}.png`);
              }}
            >
              Export PNG
            </button>
          </div>
          <p className="muted">{riskLoading ? "Loading risk data..." : riskError2 ? `Error: ${riskError2}` : `${riskZones.length} risk zones`}</p>
          <RiskHeatMap zones={riskZones} width={isMobile ? 280 : 300} height={isMobile ? 160 : 200} />
        </article>

        {/* Trip Timeline */}
        <article className="glass-card panel animate-fade-in">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <h3>Trip Phase Timeline</h3>
            <button
              className="secondary"
              style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
              onClick={() => {
                const svg = document.querySelector(".trip-timeline") as SVGSVGElement;
                if (svg) exportToPNG(svg, `trip-timeline-${new Date().toISOString().slice(0, 10)}.png`);
              }}
            >
              Export PNG
            </button>
          </div>
          <p className="muted">{phasesLoading ? "Loading timeline..." : phasesError ? `Error: ${phasesError}` : `${tripPhases.length} phases`}</p>
          {tripPhases.length > 0 ? (
            <TripTimeline phases={tripPhases} width={isMobile ? 280 : 400} height={isMobile ? 60 : 80} />
          ) : (
            <p className="muted">No trip timeline events available.</p>
          )}
        </article>

        {/* Catch Analytics */}
        <article className="glass-card panel animate-fade-in">
          <h3>Gear Status Distribution</h3>
          <p className="muted">Live counts from current trip gear state</p>
          {gearStatusChart ? (
            <BarChart data={gearStatusChart} height={isMobile ? 120 : 150} />
          ) : (
            <p className="muted">No gear data available.</p>
          )}
        </article>

        {/* Risk Distribution */}
        <article className="glass-card panel animate-fade-in">
          <h3>Risk Distribution</h3>
          <p className="muted">Fleet-wide risk tier breakdown</p>
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
            <p className="muted">No risk-zone data available.</p>
          )}
        </article>

        {/* Gear Health Dashboard */}
        <article className="glass-card panel viz-panel animate-fade-in">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <h3>Gear Health Monitor</h3>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                className="secondary"
                style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                onClick={refetchGear}
              >
                Refresh
              </button>
            </div>
          </div>
          <p className="muted">{gearLoading ? "Loading gear data..." : gearError ? `Error: ${gearError}` : `${gearItems.length} gear items`}</p>
          <GearHealthDashboard items={gearItems} />
        </article>

        {/* Compliance Progress */}
        <article className="glass-card panel animate-fade-in">
          <h3>Compliance Checklist</h3>
          <p className="muted">{complianceLoading ? "Loading..." : complianceError ? `Error: ${complianceError}` : `${checkpoints.filter(c => c.completed).length}/${checkpoints.length} complete`}</p>
          {checkpoints.length > 0 ? (
            <ComplianceProgress checkpoints={checkpoints} />
          ) : (
            <p className="muted">No compliance checkpoints loaded.</p>
          )}
        </article>

        {/* Sync Health */}
        <article className="glass-card panel animate-fade-in">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <h3>Sync Network Health</h3>
            <button
              className="secondary"
              style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
              onClick={() => {
                const svg = document.querySelector(".sync-network-viz") as SVGSVGElement;
                if (svg) exportToPNG(svg, `sync-health-${new Date().toISOString().slice(0, 10)}.png`);
              }}
            >
              Export PNG
            </button>
          </div>
          <p className="muted">{syncLoading ? "Loading sync data..." : syncError ? `Error: ${syncError}` : `${syncNodes.length} devices`}</p>
          <SyncHealthMonitor nodes={syncNodes} />
        </article>

        {/* Traceability Flow */}
        <article className="glass-card panel viz-panel animate-fade-in">
          <h3>Traceability Flow</h3>
          <p className="muted">Lot lifecycle from catch to certificate</p>
          <TraceabilityFlow
            stages={traceabilityStages}
            currentStage={Math.max(0, traceabilityStages.findIndex((stage) => stage.status === "ACTIVE"))}
          />
        </article>

        {/* Trend Sparklines */}
        <article className="glass-card panel animate-fade-in">
          <h3>24h Trends</h3>
          {syncTrendData ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem", padding: "1rem" }}>
              <div>
                <span className="muted">Sync Metric Snapshot</span>
                <Sparkline data={syncTrendData} color="var(--accent)" width={isMobile ? 200 : 300} />
              </div>
            </div>
          ) : (
            <p className="muted">Load sync metrics to view trend data.</p>
          )}
        </article>

        {/* Historical Trends - NEW */}
        <article className="glass-card panel viz-panel animate-fade-in">
          <h3>Trip Status Trends</h3>
          <p className="muted">Distribution of currently loaded trip states</p>
          {statusTrendData ? (
            <BarChart data={statusTrendData} height={isMobile ? 100 : 120} />
          ) : (
            <p className="muted">Load trip timeline data to view status trends.</p>
          )}
        </article>
      </section>
    </AppShell>
  );
}
