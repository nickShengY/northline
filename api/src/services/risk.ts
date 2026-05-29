import type { RiskTier } from "@northline/shared";

export interface RiskInput {
  mode: "OFFSHORE" | "ICE";
  workloadIntensity: number;
  weatherSeverity: number;
  nearMissCount: number;
  daylightHoursLeft: number;
  soloOperator?: boolean;
  checkinMisses?: number;
}

export interface RiskScoreResult {
  score: number;
  tier: RiskTier;
  rationale: string[];
  mitigations: string[];
}

function toTier(score: number): RiskTier {
  if (score >= 80) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 35) return "MODERATE";
  return "LOW";
}

export function computeRisk(input: RiskInput): RiskScoreResult {
  const rationale: string[] = [];
  let score = 0;

  score += input.workloadIntensity * 0.35;
  score += input.weatherSeverity * 0.3;
  score += Math.min(30, input.nearMissCount * 6);

  if (input.mode === "ICE") {
    if (input.daylightHoursLeft < 2) {
      score += 10;
      rationale.push("Limited daylight remaining increases return-route risk.");
    }
    if (input.soloOperator) {
      score += 8;
      rationale.push("Solo trip requires stricter check-in discipline.");
    }
    if ((input.checkinMisses ?? 0) > 0) {
      score += Math.min(12, (input.checkinMisses ?? 0) * 4);
      rationale.push("Recent missed check-ins indicate escalation risk.");
    }
  } else {
    if (input.workloadIntensity > 70) {
      rationale.push("High haul tempo can raise fatigue and deck incident probability.");
    }
    if (input.nearMissCount > 2) {
      rationale.push("Near-miss cluster suggests immediate toolbox talk is needed.");
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const tier = toTier(score);

  const mitigations =
    input.mode === "OFFSHORE"
      ? [
          "Run 30-second pre-haul pinch-zone and line-tension check.",
          "Rotate deck positions every two cycles to reduce fatigue.",
          "Enforce captain acknowledgement before resuming after stop-work."
        ]
      : [
          "Set 20-minute check-in cadence until risk lowers.",
          "Avoid pressure ridges and re-route via previously verified points.",
          "Trigger shelter CO/ventilation reminder while heater active."
        ];

  return {
    score,
    tier,
    rationale,
    mitigations
  };
}
