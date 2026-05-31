import { useEffect, useState, useCallback } from "react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Textarea,
  Badge,
  StatusBadge,
  RiskBadge,
  ConnectionStatus,
  SyncIndicator,
  MOBAlert,
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
type GearStatus = "SET" | "CHECKED" | "HAULED" | "MISSING" | "RECOVERED" | "REMOVED";

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

type RiskTier = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

const STORAGE_KEY_NOTES = "northline.tablet_ops.shift_notes";
const STORAGE_KEY_ACTIVITY = "northline.tablet_ops.activity";

function readJsonStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
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
  const [vesselStatus, setVesselStatus] = useState<VesselStatus>("DOCKED");
  const [syncState, setSyncState] = useState<SyncState>("SYNCING");
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingEvents] = useState(0);
  const [tripId, setTripId] = useState("");
  const [tripOptions, setTripOptions] = useState<string[]>([]);
  const [vesselName] = useState("Northline Vessel Ops");
  const [gearItems, setGearItems] = useState<GearItem[]>([]);
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [safetyEvents, setSafetyEvents] = useState<SafetyEvent[]>([]);
  const [mobAlertActive, setMobAlertActive] = useState(false);
  const [shiftNotes, setShiftNotes] = useState<ShiftNote[]>(() => readJsonStorage<ShiftNote[]>(STORAGE_KEY_NOTES, []));
  const [noteInput, setNoteInput] = useState("");
  const [activityLog, setActivityLog] = useState<{ id: string; message: string; tone: string; createdAt: string }[]>(() =>
    readJsonStorage<{ id: string; message: string; tone: string; createdAt: string }[]>(STORAGE_KEY_ACTIVITY, [])
  );
  const [riskScore, setRiskScore] = useState<{ tier: RiskTier; score: number }>({ tier: "LOW", score: 0 });
  const [watchChecklist, setWatchChecklist] = useState({
    comms: false,
    deck: false,
    weather: false,
    gear: false
  });

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
    localStorage.setItem(STORAGE_KEY_NOTES, JSON.stringify(shiftNotes));
  }, [shiftNotes]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_ACTIVITY, JSON.stringify(activityLog));
  }, [activityLog]);

  const addActivity = useCallback((message: string, tone: "info" | "success" | "warning" | "danger" = "info") => {
    setActivityLog((prev) =>
      [{ id: crypto.randomUUID(), message, tone, createdAt: new Date().toISOString() }, ...prev].slice(0, 50)
    );
  }, []);

  const loadTripSnapshot = useCallback(
    async (nextTripId: string) => {
      if (!nextTripId) return;

      setSyncState("SYNCING");
      try {
        const [gearResponse, deviceResponse, incidentResponse] = await Promise.all([
          getTripGear(nextTripId),
          listDevices(),
          getOpenIncidents()
        ]);

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
          mode: "OFFSHORE",
          workloadIntensity: 60,
          weatherSeverity: 50,
          nearMissCount: incidents.length,
          daylightHoursLeft: 4
        });
        setRiskScore({ tier: risk.tier, score: Math.round(risk.score) });

        setVesselStatus("FISHING");
        setSyncState("SYNCED");
      } catch {
        setSyncState("ERROR");
        addActivity(`Failed to refresh live trip data for ${formatTripLabel(nextTripId)}.`, "danger");
      }
    },
    [addActivity]
  );

  useEffect(() => {
    let mounted = true;
    const bootstrap = async () => {
      try {
        const response = await listTrips();
        const rows = response.trips ?? [];
        if (!mounted) return;

        const ids = rows.map((row) => row.trip_id);
        setTripOptions(ids);
        const activeTripId = ids[0] ?? "";
        setTripId((prev) => prev || activeTripId);

        if (activeTripId) {
          await loadTripSnapshot(activeTripId);
        } else {
          setSyncState("PENDING");
        }
      } catch {
        if (!mounted) return;
        setSyncState("ERROR");
      }
    };

    bootstrap();
    return () => {
      mounted = false;
    };
  }, [loadTripSnapshot]);

  const transitionGear = useCallback(
    async (gearId: string, newStatus: GearStatus) => {
      if (!tripId) {
        addActivity("Select a trip before transitioning gear.", "warning");
        return;
      }

      setSyncState("SYNCING");
      try {
        await transitionTripGear({
          trip_id: tripId,
          gear_id: gearId,
          transition: newStatus,
          note: `Tablet transition: ${newStatus}`
        });
        await loadTripSnapshot(tripId);
        addActivity(`Gear ${gearId} transitioned to ${newStatus}.`, "success");
      } catch {
        setSyncState("ERROR");
        addActivity(`Gear transition failed for ${gearId}.`, "danger");
      }
    },
    [tripId, addActivity, loadTripSnapshot]
  );

  const triggerMOB = useCallback(async () => {
    if (!tripId) {
      addActivity("Select a trip before triggering emergency hazard.", "warning");
      return;
    }

    setMobAlertActive(true);
    setVesselStatus("EMERGENCY");
    setSyncState("SYNCING");
    try {
      await reportHazard({
        hazard_id: `hz_${crypto.randomUUID().slice(0, 8)}`,
        trip_id: tripId,
        hazard_type: "OPEN_WATER",
        severity: 5,
        confidence: 0.95,
        sharing_scope: "ORG",
        location: { lat: 55.5, lon: -165.2 }
      });
      await loadTripSnapshot(tripId);
      addActivity("Emergency MOB hazard report submitted.", "danger");
      setSyncState("SYNCED");
    } catch {
      setSyncState("ERROR");
      addActivity("Emergency report failed to submit.", "danger");
    }
  }, [tripId, addActivity, loadTripSnapshot]);

  const acknowledgeMOB = useCallback(() => {
    setMobAlertActive(false);
    setSafetyEvents((prev) =>
      prev.map((event) => (event.type === "MOB" || event.severity === "critical" ? { ...event, acknowledged: true } : event))
    );
    addActivity("Emergency alert acknowledged.", "warning");
  }, [addActivity]);

  const clearEmergency = useCallback(() => {
    setMobAlertActive(false);
    setVesselStatus("FISHING");
    addActivity("Emergency status cleared.", "success");
  }, [addActivity]);

  const saveNote = useCallback(() => {
    if (!noteInput.trim()) return;
    const note: ShiftNote = {
      id: crypto.randomUUID(),
      text: noteInput.trim(),
      author: "Bridge",
      createdAt: new Date().toISOString()
    };
    setShiftNotes((prev) => [note, ...prev]);
    setNoteInput("");
    addActivity("Shift note saved.", "info");
  }, [noteInput, addActivity]);

  const gearStatusColors: Record<GearStatus, "success" | "info" | "default" | "danger" | "warning"> = {
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

  const openCriticalEvents = safetyEvents.filter((event) => !event.acknowledged && (event.severity === "critical" || event.severity === "high")).length;
  const missingGearCount = gearItems.filter((gear) => gear.status === "MISSING").length;
  const watchReady = watchChecklist.comms && watchChecklist.deck && watchChecklist.weather && watchChecklist.gear;
  const bridgePlaybook = [
    {
      label: riskScore.tier === "HIGH" || riskScore.tier === "CRITICAL" ? "Hold haul decision" : "Haul decision clear",
      detail:
        riskScore.tier === "HIGH" || riskScore.tier === "CRITICAL"
          ? "Run mitigation review before changing vessel or gear state."
          : "Current loaded risk score does not block routine gear work.",
      tone: riskScore.tier === "HIGH" || riskScore.tier === "CRITICAL" ? "danger" : "success"
    },
    {
      label: missingGearCount ? "Gear exception review" : "Gear state normal",
      detail: missingGearCount ? `${missingGearCount} missing gear item ${missingGearCount === 1 ? "needs" : "need"} assignment.` : "No missing gear in the loaded trip snapshot.",
      tone: missingGearCount ? "warning" : "success"
    },
    {
      label: openCriticalEvents ? "Safety acknowledgement" : "Safety events acknowledged",
      detail: openCriticalEvents ? `${openCriticalEvents} high-priority event ${openCriticalEvents === 1 ? "is" : "are"} awaiting acknowledgement.` : "No loaded critical events require acknowledgement.",
      tone: openCriticalEvents ? "danger" : "success"
    }
  ];

  return (
    <AppShell maxWidth="full">
      {mobAlertActive && (
        <MOBAlert vesselName={vesselName} onCallEmergency={acknowledgeMOB} onAlertCrew={clearEmergency} />
      )}

      <PageHeader
        title={vesselName}
        subtitle={formatTripLabel(tripId)}
        eyebrow="Vessel Operations"
        actions={
          <div className="flex items-center gap-4">
            <StatusBadge status={vesselStatus === "EMERGENCY" ? "error" : vesselStatus === "FISHING" ? "synced" : "pending"} pulse={vesselStatus === "EMERGENCY"}>
              {vesselStatus}
            </StatusBadge>
            <SyncIndicator state={isOnline ? syncStateMap[syncState] : "offline"} pendingCount={pendingEvents} lastSync={new Date()} />
          </div>
        }
      />

      <Section>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-[var(--ink-secondary)]">Active Trip:</label>
          <select
            value={tripId}
            onChange={(event) => {
              const next = event.target.value;
              setTripId(next);
              void loadTripSnapshot(next);
            }}
            className="px-3 py-2 rounded border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--ink-primary)]"
          >
            {tripOptions.length === 0 && <option value="">No trips available</option>}
            {tripOptions.map((id) => (
              <option key={id} value={id}>
                {formatTripLabel(id)}
              </option>
            ))}
          </select>
          <Button variant="secondary" size="sm" onClick={() => void loadTripSnapshot(tripId)} disabled={!tripId}>
            <Icon name="RefreshCw" size={16} />
            Refresh
          </Button>
        </div>
      </Section>

      <Section>
        <div className="flex flex-wrap gap-3">
          <Button variant="danger" size="lg" onClick={() => void triggerMOB()} className="min-w-[120px]">
            <Icon name="AlertTriangle" size={24} />
            MOB ALERT
          </Button>
          <Button variant="primary" size="lg" onClick={() => setVesselStatus("HAULING")}>
            <Icon name="Anchor" size={24} />
            Start Haul
          </Button>
          <Button variant="secondary" size="lg" onClick={() => setVesselStatus("FISHING")}>
            <Icon name="Fish" size={24} />
            Resume Fishing
          </Button>
          <Button variant="secondary" size="lg" onClick={() => addActivity("All hands check completed.", "success")}>
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
                    <StatusBadge status={item.tone === "danger" ? "error" : item.tone === "warning" ? "pending" : "synced"} size="sm">
                      {item.tone}
                    </StatusBadge>
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
                    />
                  </label>
                ))}
              </Stack>
              <div className="flex items-center justify-between mt-4">
                <StatusBadge status={watchReady ? "synced" : "pending"}>{watchReady ? "Ready" : "Incomplete"}</StatusBadge>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => addActivity(watchReady ? "Watch handoff completed." : "Watch handoff reviewed with incomplete checks.", watchReady ? "success" : "warning")}
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
          <Card variant="glass" className="col-span-2">
            <CardHeader>
              <CardTitle>Gear Status</CardTitle>
              <CardDescription>Live tracking from current trip records</CardDescription>
            </CardHeader>
            <CardContent>
              {gearItems.length === 0 ? (
                <p className="text-sm text-[var(--ink-muted)]">No gear records for this trip.</p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {gearItems.map((gear) => (
                    <Card key={gear.gear_id} variant="outline" padding="sm">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-lg">{gear.gear_id}</span>
                        <StatusBadge status={gearStatusColors[gear.status] as "synced" | "pending" | "error"}>
                          {gear.status}
                        </StatusBadge>
                      </div>
                      <p className="text-sm text-[var(--ink-muted)] mb-3">Updated: {gear.lastCheck}</p>
                      {gear.location && <p className="text-xs text-[var(--ink-muted)] mb-3">{gear.location}</p>}
                      <div className="flex gap-2">
                        {gear.status === "SET" && (
                          <Button size="sm" variant="primary" onClick={() => void transitionGear(gear.gear_id, "CHECKED")}>
                            Check
                          </Button>
                        )}
                        {gear.status === "CHECKED" && (
                          <Button size="sm" variant="primary" onClick={() => void transitionGear(gear.gear_id, "HAULED")}>
                            Haul
                          </Button>
                        )}
                        {gear.status === "HAULED" && (
                          <Button size="sm" variant="secondary" onClick={() => void transitionGear(gear.gear_id, "SET")}>
                            Reset
                          </Button>
                        )}
                        {gear.status === "MISSING" && (
                          <Button size="sm" variant="secondary" onClick={() => void transitionGear(gear.gear_id, "RECOVERED")}>
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
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-center p-4">
                <RiskBadge tier={riskScore.tier} score={riskScore.score} size="lg" />
              </div>
              <Divider className="my-4" />
              <div className="space-y-3">
                <p className="text-sm font-semibold text-[var(--ink-secondary)]">Active Safety Events</p>
                {safetyEvents.length > 0 ? (
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
                  <p className="text-sm text-[var(--ink-muted)]">No active safety events</p>
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
                {crew.length === 0 && <p className="text-sm text-[var(--ink-muted)]">No device records available.</p>}
                {crew.map((member) => (
                  <div key={member.id} className="flex items-center justify-between p-3 rounded bg-[var(--bg-secondary)]">
                    <div>
                      <p className="font-medium">{member.name}</p>
                      <p className="text-sm text-[var(--ink-muted)]">{member.role}</p>
                    </div>
                    <StatusBadge status={member.status === "ON_DECK" ? "synced" : member.status === "BELOW" ? "pending" : "inactive"}>
                      {member.status.replace("_", " ")}
                    </StatusBadge>
                  </div>
                ))}
              </Stack>
            </CardContent>
          </Card>

          <Card variant="glass">
            <CardHeader>
              <CardTitle>Bridge Log</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea value={noteInput} onChange={(event) => setNoteInput(event.target.value)} placeholder="Enter shift notes..." rows={3} />
              <Button size="sm" className="mt-3" onClick={saveNote} disabled={!noteInput.trim()}>
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
          <ConnectionStatus connected={isOnline} pendingEvents={pendingEvents} lastSync={new Date()} />
          <div className="flex items-center gap-4">
            <span className="text-sm text-[var(--ink-muted)]">Last update: {new Date().toLocaleTimeString()}</span>
            <Button variant="ghost" size="sm" onClick={() => void loadTripSnapshot(tripId)} disabled={!tripId}>
              <Icon name="RefreshCw" size={16} />
              Sync
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
