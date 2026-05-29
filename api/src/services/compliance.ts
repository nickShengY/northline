import type { ComplianceIssue, OpsEvent } from "@northline/shared";

export interface ComplianceSummary {
  completion_meter: number;
  errors: ComplianceIssue[];
  warnings: ComplianceIssue[];
}

export function runComplianceValidation(events: OpsEvent[]): ComplianceSummary {
  const errors: ComplianceIssue[] = [];
  const warnings: ComplianceIssue[] = [];

  const hasTripStarted = events.some((e) => e.event_type === "TRIP_STARTED");
  const hasTripEnded = events.some((e) => e.event_type === "TRIP_ENDED");
  const hasSafetyBrief = events.some((e) => e.event_type === "SAFETY_BRIEFING_COMPLETED");
  const catchCount = events.filter((e) => e.event_type === "CATCH_RECORDED").length;

  if (!hasTripStarted) {
    errors.push({
      code: "trip.start.missing",
      severity: "error",
      message: "Trip has no TRIP_STARTED event.",
      fix_hint: "Record trip start before final sign-off."
    });
  }

  if (!hasSafetyBrief) {
    warnings.push({
      code: "safety.briefing.missing",
      severity: "warning",
      message: "Safety briefing acknowledgment not found.",
      fix_hint: "Complete pre-trip briefing checklist."
    });
  }

  if (hasTripEnded && catchCount === 0) {
    warnings.push({
      code: "catch.zero",
      severity: "warning",
      message: "Trip ended with no catch events.",
      fix_hint: "Confirm zero-catch trip or add missing catch records."
    });
  }

  const completion_meter = Math.max(0, Math.min(100, 100 - errors.length * 30 - warnings.length * 10));

  return {
    completion_meter,
    errors,
    warnings
  };
}
