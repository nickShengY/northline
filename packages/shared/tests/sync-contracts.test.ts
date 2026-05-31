import { describe, expect, it } from "vitest";
import {
  buildSyncValidationRejectedEvents,
  hasDeviceChainRejection,
  syncRejectedReasonCodes
} from "../src/sync/contracts";

describe("sync contracts", () => {
  it("builds server validation events for rejected uploads", () => {
    expect(buildSyncValidationRejectedEvents([
      { event_id: "evt_1", reason: "hash_chain_gap" }
    ], "2026-05-31T00:00:00.000Z")).toEqual([
      {
        event_type: "SYNC_VALIDATION_REJECTED",
        ts_server: "2026-05-31T00:00:00.000Z",
        payload_json: { event_id: "evt_1", reason: "hash_chain_gap" }
      }
    ]);
  });

  it("extracts actionable rejection reason codes", () => {
    const response = {
      rejected: [
        { event_id: "evt_1", reason: "hash_chain_conflict" },
        { event_id: "evt_2", reason: { signature_verification: "invalid_signature" } },
        { event_id: "evt_3", reason: { event_hash: "hash_mismatch" } },
        { event_id: "evt_4", reason: { nested: true } }
      ]
    };

    expect(syncRejectedReasonCodes(response)).toEqual([
      "hash_chain_conflict",
      "signature_verification:invalid_signature",
      "event_hash:hash_mismatch",
      "unknown"
    ]);
    expect(hasDeviceChainRejection(response)).toBe(true);
  });
});
