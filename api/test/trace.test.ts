import { describe, expect, it } from "vitest";
import { detectScanMismatch, mergeSpeciesTotals } from "../src/services/trace";

describe("trace service", () => {
  it("flags scan mismatch above threshold", () => {
    const mismatch = detectScanMismatch(
      { species_totals: { king_crab: 100 } },
      {
        batch_id: "batch_1",
        source: "CSV",
        species_totals: { king_crab: 86 }
      }
    );

    expect(mismatch.requires_review).toBe(true);
    expect(mismatch.mismatch_rate).toBeGreaterThanOrEqual(0.08);
  });

  it("merges species totals additively", () => {
    const merged = mergeSpeciesTotals({ king_crab: 20, cod: 5 }, { king_crab: 8, cod: 2, halibut: 1 });

    expect(merged).toEqual({ king_crab: 28, cod: 7, halibut: 1 });
  });
});
