import { describe, expect, it } from "vitest";
import { recommendTrainingModules } from "../src/services/training";

describe("recommendTrainingModules", () => {
  it("prioritizes near-miss interventions", () => {
    const recs = recommendTrainingModules({
      mode: "OFFSHORE",
      near_miss_count: 3,
      compliance_errors: 2
    });

    expect(recs[0]?.module_id).toBe("nl.deck.near-miss.patterns");
    expect(recs.length).toBeGreaterThan(1);
  });

  it("returns baseline module when no trigger is present", () => {
    const recs = recommendTrainingModules({ mode: "ICE" });
    expect(recs.length).toBe(1);
    expect(recs[0]?.module_id).toBe("nl.ice.trip-prep-basics");
  });
});
