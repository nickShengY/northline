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

  it("rejects unbounded event payload arrays", () => {
    expect(validatePayload("TRIP_PLANNED", {
      trip_id: "trip_ice_1",
      mode: "ICE",
      owner_id: "owner_1",
      crew_ids: Array.from({ length: 101 }, (_, index) => `crew_${index}`)
    }).ok).toBe(false);

    expect(validatePayload("GEAR_SWEEP_BLOCKED", {
      trip_id: "trip_ice_1",
      mode: "ICE",
      outstanding_gear_ids: Array.from({ length: 501 }, (_, index) => `gear_${index}`)
    }).ok).toBe(false);
  });

  it("rejects oversized arbitrary event metadata", () => {
    expect(validatePayload("GEAR_REGISTERED", {
      trip_id: "trip_ice_1",
      gear_id: "gear_1",
      mode: "ICE",
      label: "Tip-up 1",
      metadata: { payload: "x".repeat(17 * 1024) }
    }).ok).toBe(false);

    expect(validatePayload("LOT_CREATED", {
      lot_id: "lot_1",
      trip_id: "trip_ice_1",
      mode: "ICE",
      quality_json: { payload: "x".repeat(17 * 1024) }
    }).ok).toBe(false);
  });

  it("rejects unknown event types instead of accepting unvalidated payloads", () => {
    const result = validatePayload("NOT_A_REAL_EVENT", {
      arbitrary: true
    });

    expect(result.ok).toBe(false);
  });
});
