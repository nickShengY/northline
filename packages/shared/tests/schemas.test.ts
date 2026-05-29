import { describe, expect, it } from "vitest";
import { validatePayload } from "../src";

describe("event payload schemas", () => {
  it("validates checkin escalation payload", () => {
    const result = validatePayload("CHECKIN_ESCALATED", {
      trip_id: "trip_ice_1",
      checkin_id: "chk_1",
      status: "ESCALATED"
    });

    expect(result.ok).toBe(true);
  });

  it("rejects invalid lot mismatch payload", () => {
    const result = validatePayload("LOT_SCAN_MISMATCH_FLAGGED", {
      lot_id: "lot_1",
      trip_id: "trip_1",
      batch_id: "batch_1",
      mismatch_rate: -1,
      expected_total: 10,
      observed_total: 9
    });

    expect(result.ok).toBe(false);
  });
});
