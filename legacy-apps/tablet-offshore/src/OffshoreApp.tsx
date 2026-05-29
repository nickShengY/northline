import { useEffect, useMemo, useState } from "react";
import { appendDraftEvent, readDraftEvents, clearDraftEvents } from "./lib/offlineLog";
import {
  getTripGear,
  scoreOffshoreRisk,
  transitionGear,
  performSweepCheck,
  getTripState,
  getComplianceSummary,
  signCompliance,
  reportIncident,
  getOpenIncidents,
  getEffectiveRules,
  uploadEvents,
  downloadEvents,
  type RiskScoreResult
} from "./lib/api";

type Tab = "haul" | "strings" | "compliance" | "safety" | "sync";

interface GearItem {
  gear_id: string;
  status: string;
  last_position?: { lat: number; lon: number };
}

interface ComplianceData {
  completion_meter: number;
  errors: Array<{ code: string; message: string; severity: string }>;
  warnings: Array<{ code: string; message: string; severity: string }>;
}

interface Incident {
  case_id: string;
  category: string;
  severity: number;
  summary: string;
  status: string;
}

export function OffshoreApp() {
  const [activeTab, setActiveTab] = useState<Tab>("haul");
  const [cycleId, setCycleId] = useState("HC-138");
  const [tripId, setTripId] = useState("trip_demo_001");
  const [gearId, setGearId] = useState("STR-021");
  const [transition, setTransition] = useState<"SET" | "CHECKED" | "HAULED" | "MISSING" | "RECOVERED" | "REMOVED">("CHECKED");
  const [risk, setRisk] = useState<RiskScoreResult | null>(null);
  const [statusMessage, setStatusMessage] = useState("Ready. Select a workflow to begin.");
  const [syncState, setSyncState] = useState<"SYNCED" | "SYNCING" | "PENDING" | "ERROR">("SYNCED");
  const [gearRows, setGearRows] = useState<GearItem[]>([]);
  const [compliance, setCompliance] = useState<ComplianceData | null>(null);
  const [checklist, setChecklist] = useState({ pinch: false, tension: false, comms: false, ppe: false, deck: false });
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [rules, setRules] = useState<{ ruleset?: { rules_json: Record<string, unknown> } } | null>(null);
  const [syncCursor, setSyncCursor] = useState<string | null>(null);
  const [activeIncident, setActiveIncident] = useState<Partial<Incident>>({});
  const [showIncidentForm, setShowIncidentForm] = useState(false);

  const drafts = useMemo(() => readDraftEvents(), [syncState]);

  const ready = checklist.pinch && checklist.tension && checklist.comms && checklist.ppe && checklist.deck;

  async function loadTripData() {
    try {
      setSyncState("SYNCING");
      const [gearData, complianceData, incidentsData, rulesData] = await Promise.all([
        getTripGear(tripId),
        getComplianceSummary(tripId),
        getOpenIncidents(),
        getEffectiveRules("OFFSHORE", "default")
      ]);
      setGearRows((gearData as { gear: GearItem[] }).gear ?? []);
      setCompliance((complianceData as { compliance: ComplianceData }).compliance ?? null);
      setIncidents(((incidentsData as { incidents: Incident[] }).incidents ?? []).slice(0, 5));
      setRules(rulesData as { ruleset?: { rules_json: Record<string, unknown> } });
      setSyncState("SYNCED");
    } catch {
      setSyncState("ERROR");
      setStatusMessage("Failed to load trip data. Operating offline.");
    }
  }

  useEffect(() => {
    if (tripId) loadTripData();
  }, [tripId]);

  async function handleRiskScore() {
    try {
      setSyncState("SYNCING");
      const result = await scoreOffshoreRisk({
        workloadIntensity: ready ? 52 : 72,
        weatherSeverity: 61,
        nearMissCount: drafts.length > 2 ? 2 : 1,
        daylightHoursLeft: 3.5
      });
      setRisk(result);
      setSyncState("SYNCED");
      setStatusMessage(`Risk scored: ${result.tier} (${result.score})`);
    } catch {
      setSyncState("ERROR");
      setStatusMessage("Risk scoring failed. Continue offline and retry sync.");
    }
  }

  async function handleGearTransition() {
    try {
      setSyncState("SYNCING");
      await transitionGear({ trip_id: tripId, gear_id: gearId, transition, note: `Cycle ${cycleId}` });
      const loaded = (await getTripGear(tripId)) as { gear: Array<{ gear_id: string; status: string }> };
      setGearRows(loaded.gear ?? []);
      setSyncState("SYNCED");
      setStatusMessage(`Transition saved for ${gearId}: ${transition}`);
    } catch {
      setSyncState("PENDING");
      setStatusMessage("Transition queued locally; sync when online.");
    }
  }

  function handleAuthorizeHaul() {
    appendDraftEvent({
      event_id: crypto.randomUUID(),
      event_type: "SAFETY_PROMPT_ACKED",
      ts_device: new Date().toISOString(),
      payload_json: { cycle_id: cycleId, checklist }
    });
    setSyncState("PENDING");
    setStatusMessage("Checklist captured locally (pending sync).");
  }

  return (
    <div className="offshore-shell">
      <aside className="rail">
        <h1>Northline</h1>
        <p>Offshore Command</p>
        <nav>
          <button>Trip Briefing</button>
          <button>Haul Cycles</button>
          <button>String Guardian</button>
          <button>Compliance</button>
          <button>Safety Cases</button>
        </nav>
      </aside>

      <main className="deck">
        <section className="panel">
          <h2>Pre-haul safety gate ({cycleId})</h2>
          <p className="sync-chip">Sync: {syncState}</p>
          <div className="checks">
            <label>
              <input
                type="checkbox"
                checked={checklist.pinch}
                onChange={(e) => setChecklist((s) => ({ ...s, pinch: e.target.checked }))}
              />
              Pinch zones clear
            </label>
            <label>
              <input
                type="checkbox"
                checked={checklist.tension}
                onChange={(e) => setChecklist((s) => ({ ...s, tension: e.target.checked }))}
              />
              Line tension confirmed
            </label>
            <label>
              <input
                type="checkbox"
                checked={checklist.comms}
                onChange={(e) => setChecklist((s) => ({ ...s, comms: e.target.checked }))}
              />
              Comms channel verified
            </label>
          </div>
          <button
            disabled={!ready}
            onClick={handleAuthorizeHaul}
          >
            {ready ? "Authorize haul" : "Complete checklist"}
          </button>
          <p>{drafts.length} offline events queued for sync</p>
          <p className="muted">{statusMessage}</p>
        </section>

        <section className="panel">
          <h2>String Guardian</h2>
          <div className="string-grid">
            {gearRows.length === 0 ? (
              <p className="muted">No gear loaded. Enter trip ID and load data.</p>
            ) : gearRows.slice(0, 6).map((gear) => (
              <article key={gear.gear_id} className={`string-card status-${gear.status.toLowerCase()}`}>
                <strong>{gear.gear_id}</strong>
                <span>{gear.status}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Compliance meter</h2>
          <div className="meter">
            <div className="bar" style={{ width: "78%" }} />
          </div>
          <ul>
            <li>2 blocking errors: landing area code + missing scan batch link</li>
            <li>1 warning: soak duration anomaly</li>
          </ul>
        </section>

        <section className="panel">
          <h2>Risk Copilot</h2>
          <button onClick={handleRiskScore}>Recompute deck risk</button>
          {risk ? (
            <>
              <p>
                <strong>{risk.tier}</strong> ({risk.score})
              </p>
              <ul>
                {risk.rationale.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted">No live score yet.</p>
          )}
        </section>

        <section className="panel">
          <h2>Gear transition live</h2>
          <input value={tripId} onChange={(e) => setTripId(e.target.value)} placeholder="Trip id" />
          <input value={gearId} onChange={(e) => setGearId(e.target.value)} placeholder="Gear id" />
          <select value={transition} onChange={(e) => setTransition(e.target.value as typeof transition)}>
            <option value="SET">SET</option>
            <option value="CHECKED">CHECKED</option>
            <option value="HAULED">HAULED</option>
            <option value="MISSING">MISSING</option>
            <option value="RECOVERED">RECOVERED</option>
            <option value="REMOVED">REMOVED</option>
          </select>
          <button onClick={handleGearTransition}>Submit transition</button>
          <ul>
            {gearRows.slice(0, 4).map((row) => (
              <li key={row.gear_id}>
                {row.gear_id}: <strong>{row.status}</strong>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
