import { describe, expect, it } from "vitest";
import { computeRisk } from "../src/services/risk";

describe("computeRisk", () => {
  it("escalates offshore high workload into high/critical tier", () => {
    const result = computeRisk({
      mode: "OFFSHORE",
      workloadIntensity: 95,
      weatherSeverity: 90,
      nearMissCount: 3,
      daylightHoursLeft: 6
    });

    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(["HIGH", "CRITICAL"]).toContain(result.tier);
    expect(result.mitigations.length).toBeGreaterThan(0);
  });

  it("applies ice missed-checkin penalties", () => {
    const low = computeRisk({
      mode: "ICE",
      workloadIntensity: 20,
      weatherSeverity: 20,
      nearMissCount: 0,
      daylightHoursLeft: 8,
      soloOperator: false,
      checkinMisses: 0
    });

    const high = computeRisk({
      mode: "ICE",
      workloadIntensity: 20,
      weatherSeverity: 20,
      nearMissCount: 0,
      daylightHoursLeft: 1,
      soloOperator: true,
      checkinMisses: 2
    });

    expect(high.score).toBeGreaterThan(low.score);
  });
});
