export interface TrainingSignalInput {
  mode: "OFFSHORE" | "ICE";
  near_miss_count?: number;
  missed_checkins?: number;
  overdue_gear_checks?: number;
  compliance_errors?: number;
  scan_mismatch_rate?: number;
}

export interface RecommendedModule {
  module_id: string;
  title: string;
  reason: string;
  priority: number;
}

export function recommendTrainingModules(input: TrainingSignalInput): RecommendedModule[] {
  const recs: RecommendedModule[] = [];

  if ((input.near_miss_count ?? 0) >= 2) {
    recs.push({
      module_id: input.mode === "OFFSHORE" ? "nl.deck.near-miss.patterns" : "nl.ice.route-risk-awareness",
      title: input.mode === "OFFSHORE" ? "Deck Near-Miss Pattern Breaker" : "Route Risk Pattern Breaker",
      reason: "Recent near-miss cluster needs immediate behavior correction.",
      priority: 100
    });
  }

  if ((input.missed_checkins ?? 0) > 0) {
    recs.push({
      module_id: "nl.ice.checkin-discipline",
      title: "Check-in Discipline",
      reason: "Missed check-ins detected in the latest trip window.",
      priority: 95
    });
  }

  if ((input.overdue_gear_checks ?? 0) > 0) {
    recs.push({
      module_id: input.mode === "OFFSHORE" ? "nl.offshore.string-guardian" : "nl.ice.tipup-cycle",
      title: input.mode === "OFFSHORE" ? "String Guardian Recovery Flow" : "Tip-up Interval Control",
      reason: "Overdue gear checks reduce operational and safety reliability.",
      priority: 85
    });
  }

  if ((input.compliance_errors ?? 0) > 0) {
    recs.push({
      module_id: "nl.compliance.clean-closeout",
      title: "Clean Compliance Closeout",
      reason: "Blocking compliance errors were detected during validation.",
      priority: 80
    });
  }

  if ((input.scan_mismatch_rate ?? 0) >= 0.08) {
    recs.push({
      module_id: "nl.trace.scan-reconciliation",
      title: "Scan Reconciliation Workflow",
      reason: "Scan mismatch rate exceeds configured threshold.",
      priority: 75
    });
  }

  if (!recs.length) {
    recs.push({
      module_id: input.mode === "OFFSHORE" ? "nl.toolbox.pre-haul-basics" : "nl.ice.trip-prep-basics",
      title: input.mode === "OFFSHORE" ? "Pre-haul Safety Basics" : "Ice Trip Safety Basics",
      reason: "Routine reinforcement module for baseline competency.",
      priority: 50
    });
  }

  return recs.sort((a, b) => b.priority - a.priority);
}
