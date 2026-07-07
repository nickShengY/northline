import { useEffect, useState } from "react";
import { useAISBackend } from "../hooks/useAISBackend";
import { getCurrentMarineConditions, assessWeatherRisk } from "../lib/external-apis";
import { FleetMap, RiskHeatMap, type RiskZone } from "./charts";

interface RealTimeFleetOverlayProps {
  /** [[lonMin, latMin], [lonMax, latMax]] region the map projects vessel positions into. */
  boundingBox?: [[number, number], [number, number]];
  weatherPosition?: [number, number];
  width?: number;
  height?: number;
  enableAI?: boolean;
}

export function RealTimeFleetOverlay({
  boundingBox = [[-170, 50], [-130, 70]],
  weatherPosition = [55, -165],
  width = 600,
  height = 400,
  enableAI = true
}: RealTimeFleetOverlayProps) {
  const [showRiskPanel, setShowRiskPanel] = useState(false);
  const [showAIRecommendations, setShowAIRecommendations] = useState(false);
  const [weather, setWeather] = useState<{
    waveHeight: number;
    windSpeed: number;
    temperature: number;
    risk: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
    message: string;
  } | null>(null);

  const {
    vesselPositions,
    vessels,
    loading,
    error,
    connectionStatus,
    riskAssessments,
    aiRecommendations,
    collisionAlerts,
    assessRisks,
    getRecommendations,
    predictCollisions,
    reconnect
  } = useAISBackend(boundingBox, {
    enableAI,
    fishingZone: { lat: weatherPosition[0], lon: weatherPosition[1], radius: 20 },
    weatherPosition
  });

  useEffect(() => {
    let mounted = true;

    const fetchWeather = async () => {
      const conditions = await getCurrentMarineConditions(weatherPosition[0], weatherPosition[1]);
      // Guard against state updates after unmount (or after the position changed).
      if (!mounted || !conditions) return;
      const risk = assessWeatherRisk({
        waveHeight: conditions.waveHeight,
        windSpeed: conditions.windSpeed
      });
      setWeather({
        waveHeight: conditions.waveHeight,
        windSpeed: conditions.windSpeed,
        temperature: conditions.seaSurfaceTemperature,
        risk: risk.level,
        message: risk.message
      });
    };
    fetchWeather();
    const interval = setInterval(fetchWeather, 5 * 60 * 1000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [weatherPosition]);

  useEffect(() => {
    if (!enableAI || !weather || vesselPositions.length === 0) return;
    assessRisks(weather);
    getRecommendations();
    predictCollisions();
  }, [enableAI, weather, vesselPositions.length, assessRisks, getRecommendations, predictCollisions]);

  function getStatusColor() {
    switch (connectionStatus) {
      case "connected":
        return "var(--success)";
      case "connecting":
        return "var(--warning)";
      default:
        return "var(--danger)";
    }
  }

  const weatherRiskZones: RiskZone[] = weather
    ? [
        {
          x: 50,
          y: 50,
          radius: 15 + weather.waveHeight * 3,
          severity: weather.risk,
          label: `${weather.waveHeight.toFixed(1)}m waves`
        }
      ]
    : [];

  const highRiskCount = riskAssessments.filter((risk) => risk.riskLevel !== "LOW").length;

  return (
    <>
      <div style={{ position: "relative" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "0.5rem",
            padding: "0.5rem",
            background: "var(--glass-bg)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--glass-border)",
            flexWrap: "wrap",
            gap: "0.5rem"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: getStatusColor(),
                animation: connectionStatus === "connecting" ? "pulse 1s infinite" : undefined
              }}
            />
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {connectionStatus === "connected"
                ? `Live: ${vessels.length} vessels`
                : connectionStatus === "connecting"
                  ? "Connecting to vessel feed..."
                  : "Vessel feed unavailable"}
            </span>
            {connectionStatus === "error" ? (
              <button
                onClick={reconnect}
                className="secondary"
                style={{ minHeight: 44, padding: "0.5rem 0.75rem", fontSize: "0.75rem" }}
              >
                Reconnect
              </button>
            ) : null}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "1rem", fontSize: "0.75rem" }}>
            {weather ? (
              <>
                <span style={{ color: "var(--text-muted)" }}>Wave {weather.waveHeight.toFixed(1)}m</span>
                <span style={{ color: "var(--text-muted)" }}>Wind {weather.windSpeed.toFixed(0)}km/h</span>
                <span className={`badge badge-${weather.risk === "LOW" ? "success" : weather.risk === "MODERATE" ? "warning" : "danger"}`}>
                  {weather.risk}
                </span>
              </>
            ) : null}
            {enableAI ? (
              <button
                onClick={() => setShowAIRecommendations((value) => !value)}
                className={aiRecommendations.length > 0 ? "active" : "secondary"}
                style={{ minHeight: 44, padding: "0.5rem 0.75rem", fontSize: "0.75rem" }}
                aria-expanded={showAIRecommendations}
              >
                Insights {aiRecommendations.length}
              </button>
            ) : null}
            {highRiskCount > 0 ? (
              <button
                onClick={() => setShowRiskPanel((value) => !value)}
                className="secondary"
                style={{ minHeight: 44, padding: "0.5rem 0.75rem", fontSize: "0.75rem" }}
                aria-expanded={showRiskPanel}
              >
                Risks {highRiskCount}
              </button>
            ) : null}
          </div>
        </div>

        {showAIRecommendations && aiRecommendations.length > 0 ? (
          <div
            style={{
              marginBottom: "0.5rem",
              padding: "0.75rem",
              background: "var(--glass-bg)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--glass-border)"
            }}
          >
            <h4 style={{ fontSize: "0.75rem", marginBottom: "0.5rem", color: "var(--accent)" }}>Operational recommendations</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {aiRecommendations.slice(0, 3).map((rec, index) => {
                const danger = rec.priority === "URGENT" || rec.priority === "HIGH";
                return (
                  <div
                    key={`${rec.id}-${index}`}
                    style={{
                      padding: "0.5rem",
                      background: danger ? "rgba(239,68,68,0.1)" : "var(--bg-soft)",
                      borderRadius: "var(--radius-sm)",
                      borderLeft: `3px solid ${danger ? "var(--danger)" : "var(--success)"}`
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "0.7rem", fontWeight: 600 }}>
                        [{rec.type}] {rec.priority}
                      </span>
                      <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
                        {(rec.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p style={{ fontSize: "0.75rem", margin: "0.25rem 0" }}>{rec.message}</p>
                    <p style={{ fontSize: "0.65rem", color: "var(--text-muted)", margin: 0 }}>{rec.action}</p>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {showRiskPanel && highRiskCount > 0 ? (
          <div
            style={{
              marginBottom: "0.5rem",
              padding: "0.75rem",
              background: "var(--glass-bg)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--glass-border)"
            }}
          >
            <h4 style={{ fontSize: "0.75rem", marginBottom: "0.5rem", color: "var(--danger)" }}>Risk assessments</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: "150px", overflow: "auto" }}>
              {riskAssessments
                .filter((risk) => risk.riskLevel !== "LOW")
                .slice(0, 5)
                .map((risk) => (
                  <div
                    key={risk.vesselId}
                    style={{
                      padding: "0.5rem",
                      background: risk.riskLevel === "CRITICAL" ? "rgba(239,68,68,0.12)" : "rgba(245,158,11,0.1)",
                      borderRadius: "var(--radius-sm)",
                      borderLeft: `3px solid ${risk.riskLevel === "CRITICAL" ? "var(--danger)" : "var(--warning)"}`
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: "0.75rem", fontWeight: 600 }}>{risk.vesselId}</span>
                      <span className={`badge badge-${risk.riskLevel === "MODERATE" ? "warning" : "danger"}`}>{risk.riskLevel}</span>
                    </div>
                    <p style={{ fontSize: "0.65rem", margin: "0.25rem 0", color: "var(--text-muted)" }}>
                      {risk.factors.slice(0, 2).join("; ")}
                    </p>
                  </div>
                ))}
            </div>
          </div>
        ) : null}

        {collisionAlerts.length > 0 ? (
          <div
            style={{
              marginBottom: "0.5rem",
              padding: "0.75rem",
              background: "rgba(239,68,68,0.1)",
              borderRadius: "var(--radius-md)",
              border: "2px solid var(--danger)"
            }}
          >
            <h4 style={{ fontSize: "0.75rem", marginBottom: "0.5rem", color: "var(--danger)" }}>Collision alerts</h4>
            {collisionAlerts.slice(0, 2).map((alert, index) => (
              <div key={`${alert.vessel_a.mmsi}-${alert.vessel_b.mmsi}-${index}`} style={{ fontSize: "0.75rem", marginBottom: "0.5rem" }}>
                <strong>{alert.vessel_a.name}</strong> and <strong>{alert.vessel_b.name}</strong>
                <br />
                <span style={{ color: "var(--danger)" }}>
                  {alert.risk_level} risk in {Math.round(alert.time_to_closest_approach)}min ({alert.closest_approach_distance.toFixed(1)}nm)
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {loading ? (
          <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
            Loading vessel data...
          </div>
        ) : (
          <div style={{ position: "relative" }}>
            <FleetMap vessels={vesselPositions} width={width} height={height} />
            {weatherRiskZones.length > 0 ? (
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, opacity: 0.7 }}>
                <RiskHeatMap zones={weatherRiskZones} width={width} height={80} />
              </div>
            ) : null}
          </div>
        )}

        {error ? (
          <div
            style={{
              marginTop: "0.5rem",
              padding: "0.5rem",
              background: "rgba(239,68,68,0.1)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--danger)",
              fontSize: "0.75rem",
              color: "var(--danger)"
            }}
          >
            Feed unavailable: {error}
            <br />
            <span style={{ color: "var(--text-muted)", fontSize: "0.65rem" }}>
              Live data will resume automatically when the connection recovers.
            </span>
          </div>
        ) : null}
      </div>
    </>
  );
}

export { RealTimeFleetOverlay as RealTimeFleetAI };
