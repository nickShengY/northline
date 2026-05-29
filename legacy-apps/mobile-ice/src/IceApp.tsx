import { useState } from "react";
import { completeCheckin, listHazards, recommendIceTraining, reportHazard, scheduleCheckin, scoreIceRisk } from "./lib/api";

const tripId = "trip_demo_ice_01";

export function IceApp() {
  const [checkinDone, setCheckinDone] = useState(false);
  const [heaterOn, setHeaterOn] = useState(true);
  const [syncState, setSyncState] = useState<"SYNCED" | "SYNCING" | "PENDING" | "ERROR">("SYNCED");
  const [riskText, setRiskText] = useState("Risk pending");
  const [trainingItems, setTrainingItems] = useState<Array<{ module_id: string; title: string }>>([]);
  const [hazards, setHazards] = useState<Array<{ hazard_id: string; type: string; confidence: number; sharing_scope: string }>>([]);
  const [checkinId] = useState(() => `chk_${crypto.randomUUID().slice(0, 8)}`);

  async function handleScheduleCheckin() {
    try {
      setSyncState("SYNCING");
      await scheduleCheckin({
        checkin_id: checkinId,
        trip_id: tripId,
        due_at: new Date(Date.now() + 20 * 60 * 1000).toISOString()
      });
      setSyncState("SYNCED");
    } catch {
      setSyncState("PENDING");
    }
  }

  async function handleCheckinComplete() {
    try {
      setSyncState("SYNCING");
      await completeCheckin({ checkin_id: checkinId, trip_id: tripId });
      setCheckinDone(true);
      setSyncState("SYNCED");
    } catch {
      setSyncState("ERROR");
    }
  }

  async function handleReportHazard() {
    try {
      setSyncState("SYNCING");
      await reportHazard({
        hazard_id: `hz_${crypto.randomUUID().slice(0, 8)}`,
        trip_id: tripId,
        hazard_type: "RIDGE",
        severity: 4,
        confidence: 0.74,
        sharing_scope: "GROUP",
        location: { lat: 64.84, lon: -147.73 }
      });
      await handleRefreshHazards();
      setSyncState("SYNCED");
    } catch {
      setSyncState("PENDING");
    }
  }

  async function handleRefreshHazards() {
    try {
      const response = (await listHazards()) as {
        hazards: Array<{ hazard_id: string; type: string; confidence: number; sharing_scope: string }>;
      };
      setHazards(response.hazards ?? []);
    } catch {
      // preserve last known hazards
    }
  }

  async function handleRiskRecompute() {
    try {
      setSyncState("SYNCING");
      const result = (await scoreIceRisk({
        workloadIntensity: 45,
        weatherSeverity: 58,
        nearMissCount: 1,
        daylightHoursLeft: 1.8,
        soloOperator: false,
        checkinMisses: checkinDone ? 0 : 1
      })) as { tier: string; score: number };
      setRiskText(`${result.tier} (${result.score})`);
      setSyncState("SYNCED");
    } catch {
      setSyncState("ERROR");
      setRiskText("Risk unavailable (offline)");
    }
  }

  async function handleTrainingRecommend() {
    try {
      setSyncState("SYNCING");
      const result = (await recommendIceTraining({
        missed_checkins: checkinDone ? 0 : 1,
        overdue_gear_checks: 1,
        near_miss_count: 0,
        compliance_errors: 0
      })) as { recommended: Array<{ module_id: string; title: string }> };
      setTrainingItems(result.recommended ?? []);
      setSyncState("SYNCED");
    } catch {
      setSyncState("PENDING");
    }
  }

  return (
    <div className="mobile-shell">
      <header>
        <p>Northline Ice Mode</p>
        <h1>Route confidence + group safety at a glance</h1>
        <p className="sync-pill">Sync: {syncState}</p>
      </header>

      <section className="card">
        <h2>Return plan</h2>
        <p>Return by 17:40. Daylight left: 1h 55m.</p>
        <button onClick={handleScheduleCheckin}>Schedule check-in window</button>
        <button onClick={handleCheckinComplete}>{checkinDone ? "Check-in sent" : "I'm OK"}</button>
      </section>

      <section className="card">
        <h2>Hazard layer</h2>
        <button onClick={handleRefreshHazards}>Refresh hazard feed</button>
        <button onClick={handleReportHazard}>Report ridge hazard</button>
        <ul>
          {hazards.map((hazard) => (
            <li key={hazard.hazard_id}>
              <strong>{hazard.type}</strong>
              <span> confidence {Math.round(hazard.confidence * 100)}%</span>
              <em>{hazard.sharing_scope}</em>
            </li>
          ))}
          {!hazards.length ? <li>No hazards synced yet.</li> : null}
        </ul>
      </section>

      <section className="card">
        <h2>Shelter safety</h2>
        <label>
          <input type="checkbox" checked={heaterOn} onChange={(e) => setHeaterOn(e.target.checked)} /> Heater on
        </label>
        {heaterOn ? <p className="warn">CO reminder active every 25 min</p> : <p>Heater reminders paused</p>}
      </section>

      <section className="card">
        <h2>Tip-up cycle</h2>
        <p>4 of 5 tip-ups checked in interval window</p>
        <button onClick={handleRiskRecompute}>Recompute route risk</button>
        <p className="warn">Current risk: {riskText}</p>
      </section>

      <section className="card">
        <h2>Training coach</h2>
        <button onClick={handleTrainingRecommend}>Generate assignments</button>
        <ul>
          {trainingItems.slice(0, 3).map((item) => (
            <li key={item.module_id}>
              <strong>{item.title}</strong>
              <em>{item.module_id}</em>
            </li>
          ))}
          {!trainingItems.length ? <li>No recommendations yet.</li> : null}
        </ul>
      </section>
    </div>
  );
}
