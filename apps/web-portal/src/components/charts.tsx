import type { ReactNode } from "react";

// ============================================================================
// NORTHLINE VISUALIZATION LIBRARY
// Comprehensive SVG-based charts for fishing operations analytics
// No external dependencies - uses existing design system CSS variables
// ============================================================================

// --- Types ---

export interface ChartDataset {
  label: string;
  data: number[];
  color?: string;
}

export interface ChartData {
  labels: string[];
  datasets: ChartDataset[];
}

export interface VesselPosition {
  id: string;
  name: string;
  x: number; // 0-100 percentage
  y: number; // 0-100 percentage
  status: "ACTIVE" | "TRANSIT" | "FISHING" | "DOCKED" | "MAINTENANCE";
  heading?: number;
  speed?: number;
  tripPhase?: string;
  lastCheckin?: string;
}

export interface TripPhase {
  name: string;
  start: Date;
  end: Date;
  status: "COMPLETE" | "ACTIVE" | "PENDING";
  progress?: number;
}

export interface RiskZone {
  x: number;
  y: number;
  radius: number;
  severity: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  label: string;
}

export interface GearItem {
  id: string;
  name: string;
  status: "DEPLOYED" | "RETRIEVED" | "MISSING" | "DAMAGED" | "MAINTENANCE";
  health: number; // 0-100
  lastSweep?: Date;
  location?: string;
}

export interface ComplianceCheckpoint {
  name: string;
  completed: boolean;
  required: boolean;
  timestamp?: Date;
  signedBy?: string;
}

export interface SyncNode {
  id: string;
  name: string;
  status: "ONLINE" | "OFFLINE" | "SYNCING" | "ERROR";
  lastSync?: Date;
  pendingCount: number;
  queueDepth: number;
}

// --- Utility Functions ---

const STATUS_COLORS = {
  ACTIVE: "var(--success)",
  TRANSIT: "var(--info)",
  FISHING: "var(--accent)",
  DOCKED: "var(--muted)",
  MAINTENANCE: "var(--warning)",
  DEPLOYED: "var(--success)",
  RETRIEVED: "var(--info)",
  MISSING: "var(--danger)",
  DAMAGED: "var(--warning)",
  ONLINE: "var(--success)",
  OFFLINE: "var(--danger)",
  SYNCING: "var(--accent)",
  ERROR: "var(--warning)",
  LOW: "var(--success)",
  MODERATE: "var(--warning)",
  HIGH: "var(--danger)",
  CRITICAL: "var(--danger)",
  COMPLETE: "var(--success)",
  PENDING: "var(--muted)"
};

// --- Chart Components ---

/**
 * Vertical Bar Chart for catch analytics, compliance metrics
 */
export function BarChart({
  data,
  height = 200,
  showValues = true,
  animate = true
}: {
  data: ChartData;
  height?: number;
  showValues?: boolean;
  animate?: boolean;
}) {
  const maxValue = Math.max(...data.datasets.flatMap(d => d.data));
  const padding = { top: 20, right: 20, bottom: 40, left: 50 };
  const chartWidth = 100 - (padding.left + padding.right) / 3;
  const chartHeight = height - padding.top - padding.bottom;
  const barWidth = (chartWidth / data.labels.length) * 0.6;
  const gap = (chartWidth / data.labels.length) * 0.4;

  return (
    <svg viewBox={`0 0 300 ${height}`} className="chart-svg" preserveAspectRatio="none">
      <defs>
        <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.4" />
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((tick, i) => (
        <line
          key={i}
          x1={padding.left}
          y1={padding.top + chartHeight * (1 - tick)}
          x2={300 - padding.right}
          y2={padding.top + chartHeight * (1 - tick)}
          stroke="var(--glass-border)"
          strokeWidth="0.5"
          strokeDasharray="2,2"
        />
      ))}

      {/* Y-axis labels */}
      {[0, 0.25, 0.5, 0.75, 1].map((tick, i) => (
        <text
          key={i}
          x={padding.left - 8}
          y={padding.top + chartHeight * (1 - tick) + 4}
          textAnchor="end"
          fontSize="8"
          fill="var(--text-muted)"
        >
          {Math.round(maxValue * tick)}
        </text>
      ))}

      {/* Bars */}
      {data.labels.map((label, i) => {
        const dataset = data.datasets[0];
        const value = dataset?.data[i] ?? 0;
        const barHeight = maxValue > 0 ? (value / maxValue) * chartHeight : 0;
        const x = padding.left + i * (barWidth + gap) + gap / 2;
        const y = padding.top + chartHeight - barHeight;

        return (
          <g key={label}>
            <rect
              x={x}
              y={animate ? padding.top + chartHeight : y}
              width={barWidth}
              height={animate ? 0 : barHeight}
              fill="url(#barGradient)"
              rx="2"
              className={animate ? "chart-bar-animate" : ""}
              style={animate ? {
                animation: `barGrow 0.6s ease forwards ${i * 0.1}s`,
                transformOrigin: "bottom"
              } : undefined}
            >
              {animate && (
                <animate
                  attributeName="height"
                  from="0"
                  to={barHeight}
                  dur="0.6s"
                  fill="freeze"
                  begin={`${i * 0.1}s`}
                />
              )}
              {animate && (
                <animate
                  attributeName="y"
                  from={padding.top + chartHeight}
                  to={y}
                  dur="0.6s"
                  fill="freeze"
                  begin={`${i * 0.1}s`}
                />
              )}
            </rect>

            {showValues && (
              <text
                x={x + barWidth / 2}
                y={y - 5}
                textAnchor="middle"
                fontSize="8"
                fill="var(--text-primary)"
                fontWeight="600"
              >
                {value}
              </text>
            )}

            {/* X-axis label */}
            <text
              x={x + barWidth / 2}
              y={padding.top + chartHeight + 15}
              textAnchor="middle"
              fontSize="8"
              fill="var(--text-muted)"
              transform={`rotate(-30, ${x + barWidth / 2}, ${padding.top + chartHeight + 15})`}
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Donut/Pie Chart for distribution visualization
 */
export function DonutChart({
  data,
  size = 120,
  thickness = 20,
  centerLabel
}: {
  data: { label: string; value: number; color: string }[];
  size?: number;
  thickness?: number;
  centerLabel?: ReactNode;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const radius = (size - thickness) / 2;
  const center = size / 2;
  let currentAngle = -Math.PI / 2;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="chart-svg donut-chart">
      {data.map((segment, i) => {
        const angle = (segment.value / total) * Math.PI * 2;
        const x1 = center + radius * Math.cos(currentAngle);
        const y1 = center + radius * Math.sin(currentAngle);
        const x2 = center + radius * Math.cos(currentAngle + angle);
        const y2 = center + radius * Math.sin(currentAngle + angle);
        const largeArc = angle > Math.PI ? 1 : 0;

        const path = [
          `M ${center} ${center}`,
          `L ${x1} ${y1}`,
          `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
          `Z`
        ].join(" ");

        const segmentPath = (
          <path
            key={i}
            d={path}
            fill={segment.color}
            stroke="var(--glass-bg)"
            strokeWidth="2"
            className="donut-segment"
          >
            <title>{`${segment.label}: ${segment.value} (${Math.round(segment.value/total*100)}%)`}</title>
          </path>
        );

        currentAngle += angle;
        return segmentPath;
      })}

      {/* Center hole */}
      <circle
        cx={center}
        cy={center}
        r={radius - thickness}
        fill="var(--glass-bg)"
        stroke="var(--glass-border)"
        strokeWidth="1"
      />

      {/* Center content */}
      {centerLabel && (
        <foreignObject x={center - radius + thickness} y={center - radius + thickness}
                       width={(radius - thickness) * 2} height={(radius - thickness) * 2}>
          <div className="donut-center-label">{centerLabel}</div>
        </foreignObject>
      )}
    </svg>
  );
}

/**
 * Sparkline - Mini trend chart for KPI cards
 */
export function Sparkline({
  data,
  width = 100,
  height = 30,
  color = "var(--accent)"
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (data.length < 2) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const padding = 2;

  const points = data.map((val, i) => ({
    x: padding + (i / (data.length - 1)) * (width - padding * 2),
    y: height - padding - ((val - min) / range) * (height - padding * 2)
  }));

  const path = points.map((p, i) =>
    `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
  ).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="sparkline-svg">
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="sparkline-path"
      />
      {/* Area fill */}
      <path
        d={`${path} L ${points[points.length - 1]?.x ?? 0} ${height} L ${points[0]?.x ?? 0} ${height} Z`}
        fill={color}
        fillOpacity="0.1"
      />
      {/* End dot */}
      <circle
        cx={points[points.length - 1]?.x ?? 0}
        cy={points[points.length - 1]?.y ?? 0}
        r="3"
        fill={color}
        className="sparkline-dot"
      />
    </svg>
  );
}

/**
 * Progress Ring - Circular progress indicator
 */
export function ProgressRing({
  progress,
  size = 60,
  strokeWidth = 6,
  color = "var(--accent)"
}: {
  progress: number; // 0-100
  size?: number;
  strokeWidth?: number;
  color?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="progress-ring">
      {/* Background circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--glass-border)"
        strokeWidth={strokeWidth}
        opacity="0.3"
      />
      {/* Progress circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="progress-ring-circle"
      >
        <animate
          attributeName="stroke-dashoffset"
          from={circumference}
          to={offset}
          dur="1s"
          fill="freeze"
          calcMode="spline"
          keySplines="0.4 0 0.2 1"
        />
      </circle>
      {/* Center text */}
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={size / 4}
        fill="var(--text-primary)"
        fontWeight="600"
      >
        {Math.round(progress)}%
      </text>
    </svg>
  );
}

/**
 * Fleet Map - Tactical view of all vessels
 */
export function FleetMap({
  vessels,
  width = 400,
  height = 250
}: {
  vessels: VesselPosition[];
  width?: number;
  height?: number;
}) {
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="fleet-map">
      <defs>
        {/* Grid pattern */}
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--glass-border)" strokeWidth="0.5" opacity="0.3"/>
        </pattern>

        {/* Glow filter */}
        <filter id="vesselGlow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>

      {/* Background grid */}
      <rect width={width} height={height} fill="url(#grid)" />

      {/* Range rings */}
      <circle cx={width / 2} cy={height / 2} r="60" fill="none" stroke="var(--glass-border)" strokeWidth="1" strokeDasharray="4,4" opacity="0.5" />
      <circle cx={width / 2} cy={height / 2} r="100" fill="none" stroke="var(--glass-border)" strokeWidth="1" strokeDasharray="4,4" opacity="0.3" />

      {/* Vessels */}
      {vessels.map((vessel) => {
        const x = (vessel.x / 100) * width;
        const y = (vessel.y / 100) * height;
        const color = STATUS_COLORS[vessel.status] || "var(--text-muted)";

        return (
          <g key={vessel.id} className="vessel-marker" transform={`translate(${x}, ${y})`}>
            {/* Status ring */}
            <circle r="20" fill="none" stroke={color} strokeWidth="2" opacity="0.3" filter="url(#vesselGlow)">
              <animate attributeName="r" values="20;24;20" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.3;0.1;0.3" dur="2s" repeatCount="indefinite" />
            </circle>

            {/* Vessel icon */}
            <g transform={`rotate(${vessel.heading || 0})`}>
              <path
                d="M0,-12 L8,8 L0,4 L-8,8 Z"
                fill={color}
                stroke="var(--glass-bg)"
                strokeWidth="2"
              />
            </g>

            {/* Label */}
            <g transform="translate(0, 28)">
              <rect x="-40" y="0" width="80" height="18" rx="4" fill="var(--glass-bg)" stroke="var(--glass-border)" />
              <text y="12" textAnchor="middle" fontSize="8" fill="var(--text-primary)" fontWeight="600">
                {vessel.name}
              </text>
            </g>

            {/* Speed indicator */}
            {vessel.speed !== undefined && vessel.speed > 0 && (
              <text y="-18" textAnchor="middle" fontSize="7" fill="var(--text-muted)">
                {vessel.speed.toFixed(1)}kn
              </text>
            )}
          </g>
        );
      })}

      {/* Legend */}
      <g transform={`translate(10, ${height - 60})`}>
        <rect width="100" height="50" rx="6" fill="var(--glass-bg)" stroke="var(--glass-border)" />
        {Object.entries(STATUS_COLORS)
          .filter(([k]) => ["ACTIVE", "TRANSIT", "FISHING", "DOCKED"].includes(k))
          .map(([status, color], i) => (
          <g key={status} transform={`translate(8, ${10 + i * 10})`}>
            <circle r="3" fill={color} />
            <text x="10" y="3" fontSize="7" fill="var(--text-muted)">{status}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

/**
 * Trip Timeline - Gantt-style phase visualization
 */
export function TripTimeline({
  phases,
  width = 400,
  height = 80
}: {
  phases: TripPhase[];
  width?: number;
  height?: number;
}) {
  const totalDuration = phases.reduce((sum, p) => sum + (p.end.getTime() - p.start.getTime()), 0);
  const startTime = Math.min(...phases.map(p => p.start.getTime()));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="trip-timeline">
      {/* Timeline track */}
      <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="var(--glass-border)" strokeWidth="2" />

      {phases.map((phase, i) => {
        const phaseStart = ((phase.start.getTime() - startTime) / totalDuration) * width;
        const phaseWidth = ((phase.end.getTime() - phase.start.getTime()) / totalDuration) * width;
        const color = phase.status === "COMPLETE" ? "var(--success)" :
                     phase.status === "ACTIVE" ? "var(--accent)" : "var(--muted)";

        return (
          <g key={phase.name} transform={`translate(${phaseStart}, 0)`}>
            {/* Phase bar */}
            <rect
              x="0"
              y={height / 2 - 12}
              width={phaseWidth}
              height="24"
              rx="4"
              fill={color}
              fillOpacity={phase.status === "ACTIVE" ? 0.8 : 0.4}
              stroke={color}
              strokeWidth="1"
              className="timeline-phase"
            >
              {phase.status === "ACTIVE" && phase.progress !== undefined && (
                <animate
                  attributeName="width"
                  from="0"
                  to={phaseWidth * (phase.progress / 100)}
                  dur="1s"
                  fill="freeze"
                />
              )}
            </rect>

            {/* Phase label */}
            <text
              x={phaseWidth / 2}
              y={height / 2 + 4}
              textAnchor="middle"
              fontSize="8"
              fill={phase.status === "COMPLETE" ? "var(--text-primary)" : "var(--text-muted)"}
              fontWeight="600"
            >
              {phase.name}
            </text>

            {/* Connector dot */}
            <circle cx={phaseWidth} cy={height / 2} r="4" fill={color} />
          </g>
        );
      })}

      {/* Current time indicator */}
      <g transform={`translate(${width * 0.6}, 0)`}>
        <line x1="0" y1="10" x2="0" y2={height - 10} stroke="var(--danger)" strokeWidth="2" strokeDasharray="4,2" />
        <polygon points="0,5 -4,10 4,10" fill="var(--danger)" />
        <text x="0" y={height - 2} textAnchor="middle" fontSize="7" fill="var(--danger)">NOW</text>
      </g>
    </svg>
  );
}

/**
 * Risk Heat Map - Visual risk distribution
 */
export function RiskHeatMap({
  zones,
  width = 300,
  height = 200
}: {
  zones: RiskZone[];
  width?: number;
  height?: number;
}) {
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="risk-heatmap">
      <defs>
        <radialGradient id="riskLow">
          <stop offset="0%" stopColor="var(--success)" stopOpacity="0.6" />
          <stop offset="100%" stopColor="var(--success)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="riskModerate">
          <stop offset="0%" stopColor="var(--warning)" stopOpacity="0.6" />
          <stop offset="100%" stopColor="var(--warning)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="riskHigh">
          <stop offset="0%" stopColor="var(--danger)" stopOpacity="0.7" />
          <stop offset="100%" stopColor="var(--danger)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="riskCritical">
          <stop offset="0%" stopColor="var(--danger)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--danger)" stopOpacity="0.1" />
        </radialGradient>
      </defs>

      {/* Grid background */}
      <pattern id="heatmapGrid" width="30" height="30" patternUnits="userSpaceOnUse">
        <rect width="30" height="30" fill="var(--glass-bg)" opacity="0.3" />
        <path d="M 30 0 L 0 0 0 30" fill="none" stroke="var(--glass-border)" strokeWidth="0.5" opacity="0.2" />
      </pattern>
      <rect width={width} height={height} fill="url(#heatmapGrid)" />

      {/* Risk zones */}
      {zones.map((zone, i) => {
        const gradientId = `risk${zone.severity}`;
        return (
          <g key={i}>
            <circle
              cx={(zone.x / 100) * width}
              cy={(zone.y / 100) * height}
              r={zone.radius}
              fill={`url(#${gradientId})`}
              className="risk-zone"
            >
              <animate
                attributeName="r"
                values={`${zone.radius * 0.9};${zone.radius};${zone.radius * 0.9}`}
                dur="3s"
                repeatCount="indefinite"
              />
            </circle>

            {/* Zone label */}
            <text
              x={(zone.x / 100) * width}
              y={(zone.y / 100) * height}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="8"
              fill="var(--text-primary)"
              fontWeight="600"
              className="risk-zone-label"
            >
              {zone.label}
            </text>
          </g>
        );
      })}

      {/* Legend */}
      <g transform={`translate(${width - 80}, 10)`}>
        <rect width="70" height="70" rx="6" fill="var(--glass-bg)" stroke="var(--glass-border)" />
        {["LOW", "MODERATE", "HIGH", "CRITICAL"].map((level, i) => (
          <g key={level} transform={`translate(8, ${10 + i * 15})`}>
            <circle r="6" fill={`url(#risk${level})`} />
            <text x="15" y="3" fontSize="8" fill="var(--text-muted)">{level}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

/**
 * Gear Health Dashboard - Visual gear status
 */
export function GearHealthDashboard({
  items
}: {
  items: GearItem[];
}) {
  const getHealthColor = (health: number) => {
    if (health >= 80) return "var(--success)";
    if (health >= 50) return "var(--warning)";
    return "var(--danger)";
  };

  return (
    <div className="gear-health-grid">
      {items.map((item) => (
        <div key={item.id} className="gear-health-card glass-card">
          <div className="gear-header">
            <span className="gear-name">{item.name}</span>
            <span className={`badge badge-${item.status === "DEPLOYED" ? "success" : item.status === "MISSING" ? "danger" : "warning"}`}>
              {item.status}
            </span>
          </div>

          {/* Health bar */}
          <div className="health-bar-container">
            <div
              className="health-bar"
              style={{
                width: `${item.health}%`,
                backgroundColor: getHealthColor(item.health)
              }}
            />
            <span className="health-value">{item.health}%</span>
          </div>

          {/* SVG mini status */}
          <svg viewBox="0 0 60 20" className="gear-mini-status">
            {/* Status indicator dots */}
            {[0, 1, 2, 3, 4].map((i) => (
              <circle
                key={i}
                cx={10 + i * 12}
                cy="10"
                r="4"
                fill={i < Math.ceil(item.health / 20) ? getHealthColor(item.health) : "var(--glass-border)"}
                className={i < Math.ceil(item.health / 20) ? "health-dot-active" : "health-dot-inactive"}
              />
            ))}
          </svg>

          {item.lastSweep && (
            <p className="gear-meta muted">
              Last sweep: {item.lastSweep.toLocaleDateString()}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Compliance Progress - Visual checklist
 */
export function ComplianceProgress({
  checkpoints
}: {
  checkpoints: ComplianceCheckpoint[];
}) {
  const completed = checkpoints.filter(c => c.completed).length;
  const required = checkpoints.filter(c => c.required).length;
  const requiredCompleted = checkpoints.filter(c => c.required && c.completed).length;
  const progress = (requiredCompleted / required) * 100;

  return (
    <div className="compliance-progress">
      {/* Overall progress ring */}
      <div className="compliance-header">
        <ProgressRing progress={progress} size={80} color={progress === 100 ? "var(--success)" : "var(--accent)"} />
        <div className="compliance-summary">
          <h4>{completed}/{checkpoints.length} Complete</h4>
          <p className="muted">{requiredCompleted}/{required} Required</p>
        </div>
      </div>

      {/* Checkpoint list with visual indicators */}
      <div className="checkpoint-list">
        {checkpoints.map((checkpoint, i) => (
          <div
            key={checkpoint.name}
            className={`checkpoint-item ${checkpoint.completed ? "complete" : ""} ${checkpoint.required ? "required" : ""}`}
          >
            <svg viewBox="0 0 20 20" className="checkpoint-icon">
              {checkpoint.completed ? (
                <>
                  <circle cx="10" cy="10" r="9" fill="var(--success)" fillOpacity="0.2" />
                  <path
                    d="M5 10 L8 13 L15 6"
                    fill="none"
                    stroke="var(--success)"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </>
              ) : checkpoint.required ? (
                <>
                  <circle cx="10" cy="10" r="9" fill="none" stroke="var(--warning)" strokeWidth="2" />
                  <text x="10" y="14" textAnchor="middle" fontSize="10" fill="var(--warning)">!</text>
                </>
              ) : (
                <>
                  <circle cx="10" cy="10" r="9" fill="none" stroke="var(--glass-border)" strokeWidth="2" />
                </>
              )}
            </svg>

            <div className="checkpoint-info">
              <span className="checkpoint-name">{checkpoint.name}</span>
              {checkpoint.timestamp && (
                <span className="checkpoint-time muted">
                  {checkpoint.timestamp.toLocaleString()}
                </span>
              )}
            </div>

            {checkpoint.signedBy && (
              <span className="checkpoint-signature">✓ {checkpoint.signedBy}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Sync Health Monitor - Connection status dashboard
 */
export function SyncHealthMonitor({
  nodes
}: {
  nodes: SyncNode[];
}) {
  const totalPending = nodes.reduce((sum, n) => sum + n.pendingCount, 0);
  const onlineCount = nodes.filter(n => n.status === "ONLINE").length;

  return (
    <div className="sync-monitor">
      {/* Header stats */}
      <div className="sync-header">
        <div className="sync-stat">
          <span className="sync-stat-value">{onlineCount}/{nodes.length}</span>
          <span className="sync-stat-label">Online</span>
        </div>
        <div className="sync-stat">
          <span className="sync-stat-value">{totalPending}</span>
          <span className="sync-stat-label">Pending</span>
        </div>
      </div>

      {/* Network visualization */}
      <svg viewBox="0 0 300 120" className="sync-network-viz">
        {/* Connection lines */}
        {nodes.slice(1).map((node, i) => (
          <line
            key={`line-${i}`}
            x1={50}
            y1={60}
            x2={100 + i * 60}
            y2={60}
            stroke={node.status === "ONLINE" ? "var(--success)" : "var(--glass-border)"}
            strokeWidth="2"
            strokeDasharray={node.status === "SYNCING" ? "4,2" : "0"}
            opacity={node.status === "ONLINE" ? 0.6 : 0.2}
          >
            {node.status === "SYNCING" && (
              <animate
                attributeName="stroke-dashoffset"
                from="0"
                to="6"
                dur="1s"
                repeatCount="indefinite"
              />
            )}
          </line>
        ))}

        {/* Hub node */}
        <g transform="translate(50, 60)">
          <circle r="20" fill="var(--glass-bg)" stroke="var(--accent)" strokeWidth="2" />
          <text y="4" textAnchor="middle" fontSize="8" fill="var(--text-primary)" fontWeight="600">HUB</text>
        </g>

        {/* Device nodes */}
        {nodes.map((node, i) => {
          const x = 100 + i * 60;
          const color = STATUS_COLORS[node.status] || "var(--text-muted)";

          return (
            <g key={node.id} transform={`translate(${x}, 60)`}>
              {/* Status ring */}
              <circle r="24" fill="none" stroke={color} strokeWidth="2" opacity="0.3">
                {node.status === "SYNCING" && (
                  <animateTransform
                    attributeName="transform"
                    type="rotate"
                    from="0"
                    to="360"
                    dur="2s"
                    repeatCount="indefinite"
                  />
                )}
              </circle>

              {/* Node */}
              <circle r="18" fill="var(--glass-bg)" stroke={color} strokeWidth="2" />

              {/* Status indicator */}
              <circle cx="12" cy="-12" r="5" fill={color} />

              {/* Label */}
              <text y="35" textAnchor="middle" fontSize="7" fill="var(--text-muted)">
                {node.name.length > 8 ? node.name.slice(0, 6) + "..." : node.name}
              </text>

              {/* Pending badge */}
              {node.pendingCount > 0 && (
                <g transform="translate(15, -15)">
                  <circle r="8" fill="var(--warning)" />
                  <text y="3" textAnchor="middle" fontSize="7" fill="var(--glass-bg)" fontWeight="600">
                    {node.pendingCount > 9 ? "9+" : node.pendingCount}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>

      {/* Node details */}
      <div className="sync-node-list">
        {nodes.map((node) => (
          <div key={node.id} className={`sync-node-item status-${node.status.toLowerCase()}`}>
            <span className="sync-node-name">{node.name}</span>
            <span className={`badge badge-${node.status === "ONLINE" ? "success" : node.status === "ERROR" ? "danger" : "warning"}`}>
              {node.status}
            </span>
            {node.queueDepth > 0 && (
              <span className="sync-queue-depth">Queue: {node.queueDepth}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Traceability Flow - Visual process diagram
 */
export function TraceabilityFlow({
  stages,
  currentStage
}: {
  stages: { name: string; status: "COMPLETE" | "ACTIVE" | "PENDING"; data?: string }[];
  currentStage: number;
}) {
  return (
    <div className="traceability-flow">
      <svg viewBox="0 0 500 80" className="flow-svg">
        {/* Connecting line */}
        <line
          x1="40" y1="40" x2="460" y2="40"
          stroke="var(--glass-border)"
          strokeWidth="3"
          strokeLinecap="round"
        />

        {/* Active progress line */}
        <line
          x1="40"
          y1="40"
          x2={40 + (currentStage / (stages.length - 1)) * 420}
          y2="40"
          stroke="var(--accent)"
          strokeWidth="3"
          strokeLinecap="round"
          className="flow-progress-line"
        >
          <animate
            attributeName="x2"
            from="40"
            to={40 + (currentStage / (stages.length - 1)) * 420}
            dur="1s"
            fill="freeze"
          />
        </line>

        {stages.map((stage, i) => {
          const x = 40 + (i / (stages.length - 1)) * 420;
          const isActive = i === currentStage;
          const isComplete = stage.status === "COMPLETE";
          const color = isComplete ? "var(--success)" : isActive ? "var(--accent)" : "var(--glass-border)";

          return (
            <g key={stage.name} transform={`translate(${x}, 40)`}>
              {/* Stage node */}
              <circle
                r={isActive ? 20 : 14}
                fill={isActive ? "var(--glass-bg)" : isComplete ? color : "var(--panel-bg)"}
                stroke={color}
                strokeWidth={isActive ? 3 : 2}
                className={isActive ? "flow-node-active" : ""}
              >
                {isActive && (
                  <animate
                    attributeName="r"
                    values="20;22;20"
                    dur="2s"
                    repeatCount="indefinite"
                  />
                )}
              </circle>

              {/* Checkmark for complete */}
              {isComplete && (
                <path
                  d="M-5 0 L-1 4 L5 -4"
                  fill="none"
                  stroke="var(--glass-bg)"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              )}

              {/* Label */}
              <text y="40" textAnchor="middle" fontSize="9" fill="var(--text-muted)">
                {stage.name}
              </text>

              {/* Data label */}
              {stage.data && (
                <text y="-30" textAnchor="middle" fontSize="8" fill={color} fontWeight="600">
                  {stage.data}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Stage detail cards */}
      <div className="flow-stages">
        {stages.map((stage, i) => (
          <div
            key={stage.name}
            className={`flow-stage-card ${i === currentStage ? "active" : ""} ${stage.status === "COMPLETE" ? "complete" : ""}`}
          >
            <div className="flow-stage-number">{i + 1}</div>
            <div className="flow-stage-info">
              <span className="flow-stage-name">{stage.name}</span>
              {stage.data && <span className="flow-stage-data">{stage.data}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Export all components ---
export {
  STATUS_COLORS
};
