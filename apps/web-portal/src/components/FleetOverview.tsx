import { useState } from "react";
import { Icon, Badge, Button } from "@northline/ui";
import { FleetMap, type VesselPosition } from "./charts";

export function FleetOverview({
  vessels,
  loading,
  error,
  approximate,
  incidents,
  onOpenTrip,
  onNavigate,
  onRefresh,
}: {
  vessels: VesselPosition[];
  loading: boolean;
  error: string | null;
  approximate: boolean;
  incidents: { case_id: string; summary: string; severity: number }[];
  onOpenTrip: (id: string) => void;
  onNavigate: (view: string) => void;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState("ALL");
  const visible = vessels.filter(
    (vessel) => filter === "ALL" || vessel.status === filter,
  );
  const statusLabel = (status: string) =>
    ({
      ACTIVE: "Active",
      TRANSIT: "In transit",
      FISHING: "Fishing",
      DOCKED: "In port",
      MAINTENANCE: "Maintenance",
    })[status] ?? status;
  return (
    <div className="fleet-overview">
      <div className="overview-heading">
        <div>
          <h1>Fleet overview</h1>
          <p>
            {loading
              ? "Loading your fleet…"
              : `${vessels.length} trip tracks · ${incidents.length} loaded incidents`}
          </p>
        </div>
        <span className="workspace-context">
          <Icon name="Info" size={16} />
          {import.meta.env.DEV ? "Development workspace" : "Fleet workspace"}
        </span>
      </div>
      {error && (
        <div className="fleet-empty" role="alert">
          <Icon name="AlertCircle" size={24} />
          <p>{error}</p>
          <Button size="sm" onClick={onRefresh}>
            Retry fleet
          </Button>
        </div>
      )}
      <div className="vessel-cards">
        {visible.slice(0, 3).map((vessel, index) => (
          <button
            className="vessel-card"
            key={vessel.id}
            onClick={() => onOpenTrip(vessel.id)}
          >
            <div className="vessel-card-top">
              <div
                className={`vessel-photo vessel-photo--${index}`}
                aria-hidden="true"
              />
              <div>
                <h2>{vessel.name}</h2>
                <span
                  className={`vessel-status vessel-status--${vessel.status.toLowerCase()}`}
                >
                  <i />
                  {statusLabel(vessel.status)}
                </span>
              </div>
              <Icon name="ArrowRight" size={16} />
            </div>
            <div className="vessel-card-meta">
              <div>
                <Icon name="Route" size={20} />
                <span>
                  Trip phase<strong>{vessel.tripPhase ?? "Unavailable"}</strong>
                </span>
              </div>
              <div>
                <Icon name="Clock3" size={20} />
                <span>
                  Last report<strong>{vessel.lastCheckin ?? "Unknown"}</strong>
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>
      {!loading && !error && !visible.length && (
        <div className="fleet-empty">
          <Icon name="Ship" size={32} />
          <h2>
            {vessels.length
              ? "No tracks match this filter"
              : "Your fleet starts here"}
          </h2>
          <p>
            {vessels.length
              ? "Choose another status to see your fleet."
              : "Trip tracks will appear when trips are available for this workspace."}
          </p>
          <Button
            variant="secondary"
            onClick={() => (vessels.length ? setFilter("ALL") : onRefresh())}
          >
            {vessels.length ? "Show all tracks" : "Refresh fleet"}
          </Button>
        </div>
      )}
      <div className="fleet-overview-grid">
        <div className="fleet-main-column">
          <section className="fleet-panel fleet-map-panel">
            <div className="fleet-panel-heading">
              <h2>
                <Icon name="Route" size={20} />
                Fleet map
              </h2>
              <button
                className="quiet-action"
                onClick={onRefresh}
                aria-label="Refresh fleet map"
              >
                <Icon name="RefreshCw" size={16} />
                Refresh
              </button>
            </div>
            <div className="fleet-chart">
              <FleetMap vessels={visible} width={800} height={340} />
              <span className="fleet-map-label">
                {approximate
                  ? "Schematic view · approximate positions"
                  : "Fleet positions"}
              </span>
            </div>
            <div className="fleet-map-caption">
              <span>
                <i />
                Trip track
              </span>
              <span>
                {approximate
                  ? "Not for navigation. Position and motion may be illustrative."
                  : "Review source telemetry before navigating."}
              </span>
            </div>
          </section>
          <section className="fleet-panel">
            <div className="fleet-panel-heading">
              <h2>
                <Icon name="Route" size={20} />
                Current trips
              </h2>
              <label className="fleet-filter">
                <Icon name="Filter" size={16} />
                <select
                  aria-label="Filter fleet status"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                >
                  <option value="ALL">All statuses</option>
                  {Array.from(new Set(vessels.map((v) => v.status))).map(
                    (status) => (
                      <option key={status} value={status}>
                        {statusLabel(status)}
                      </option>
                    ),
                  )}
                </select>
              </label>
            </div>
            <div className="fleet-table-scroll">
              <table className="fleet-trip-table">
                <thead>
                  <tr>
                    <th>Vessel / track</th>
                    <th>Trip</th>
                    <th>Status</th>
                    <th>Last report</th>
                    <th>
                      <span className="sr-only">Open trip</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((vessel, index) => (
                    <tr key={vessel.id}>
                      <td>
                        <div className="trip-vessel">
                          <div
                            className={`vessel-thumb vessel-photo--${index % 3}`}
                            aria-hidden="true"
                          />
                          <strong>{vessel.name}</strong>
                        </div>
                      </td>
                      <td>{vessel.id}</td>
                      <td>
                        <Badge
                          variant={
                            vessel.status === "ACTIVE" ||
                            vessel.status === "FISHING"
                              ? "success"
                              : "info"
                          }
                          dot
                        >
                          {statusLabel(vessel.status)}
                        </Badge>
                      </td>
                      <td>{vessel.lastCheckin ?? "Unknown"}</td>
                      <td>
                        <button
                          className="quiet-action"
                          onClick={() => onOpenTrip(vessel.id)}
                          aria-label={`Open trip ${vessel.id}`}
                        >
                          <Icon name="ArrowRight" size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!visible.length && (
              <p className="fleet-table-empty">
                {loading ? "Loading trips…" : "No trip tracks to display."}
              </p>
            )}
          </section>
        </div>
        <div className="fleet-side-column">
          <section className="fleet-panel">
            <div className="fleet-panel-heading">
              <h2>
                <Icon name="AlertTriangle" size={20} color="var(--danger)" />
                Needs attention
              </h2>
              <button
                className="quiet-action"
                onClick={() => onNavigate("safety")}
              >
                View safety
              </button>
            </div>
            {incidents.length ? (
              incidents.slice(0, 4).map((incident) => (
                <button
                  className="attention-row"
                  key={incident.case_id}
                  onClick={() => onNavigate("safety")}
                >
                  <Icon name="Shield" size={24} />
                  <span>
                    <strong>{incident.summary}</strong>
                    <small>Incident {incident.case_id}</small>
                  </span>
                  <Badge
                    variant={incident.severity >= 3 ? "danger" : "warning"}
                  >
                    Severity {incident.severity}
                  </Badge>
                </button>
              ))
            ) : (
              <div className="attention-empty">
                <Icon name="ShieldCheck" size={24} />
                <strong>No incidents loaded</strong>
                <p>
                  Open Safety to refresh risk and incident records for a trip.
                </p>
                <button
                  className="quiet-action"
                  onClick={() => onNavigate("safety")}
                >
                  Review safety <Icon name="ArrowRight" size={16} />
                </button>
              </div>
            )}
          </section>
          <section className="fleet-panel assistant-panel">
            <div className="fleet-panel-heading">
              <h2>
                <Icon name="Sparkles" size={24} />
                Operations desk
              </h2>
              <Badge variant="info" size="sm">
                Quick access
              </Badge>
            </div>
            <div className="assistant-copy">
              <p>Keep the next shift moving.</p>
              <span>
                Review a trip, verify its certificates, or pick up where your
                crew left off.
              </span>
            </div>
            <button className="desk-action" onClick={() => onNavigate("trips")}>
              <Icon name="ClipboardList" size={20} />
              <span>
                Review trip records
                <small>State, gear, and queued actions</small>
              </span>
              <Icon name="ArrowRight" size={16} />
            </button>
            <button
              className="desk-action"
              onClick={() => onNavigate("certificates")}
            >
              <Icon name="ShieldCheck" size={20} />
              <span>
                Verify certificates<small>Traceability and compliance</small>
              </span>
              <Icon name="ArrowRight" size={16} />
            </button>
            <button
              className="desk-action"
              onClick={() => onNavigate("records")}
            >
              <Icon name="Archive" size={20} />
              <span>
                Open activity records<small>Recent workspace actions</small>
              </span>
              <Icon name="ArrowRight" size={16} />
            </button>
          </section>
          <div className="fleet-note">
            <Icon name="Info" size={16} />
            <p>
              Vessel imagery is illustrative. Check source records and data
              freshness before acting.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
