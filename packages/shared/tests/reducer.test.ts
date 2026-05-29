import { describe, expect, it } from "vitest";
import { replay, type OpsEvent } from "../src";

function mkEvent(event_type: string, ts_device: string, payload_json: Record<string, unknown>): OpsEvent {
  return {
    event_id: `${event_type}_${ts_device}`,
    tenant_id: "tenant_a",
    subject_type: "VESSEL",
    subject_id: "trip_1",
    actor_id: "actor_1",
    device_id: "device_1",
    ts_device,
    event_type,
    schema_version: 1,
    payload_json,
    event_hash: "hash",
    signature: "sig"
  };
}

describe("replay", () => {
  it("rebuilds deterministic trip and gear state from out-of-order events", () => {
    const events: OpsEvent[] = [
      mkEvent("GEAR_REGISTERED", "2026-01-02T00:01:00.000Z", {
        trip_id: "trip_1",
        gear_id: "gear_1",
        mode: "OFFSHORE"
      }),
      mkEvent("TRIP_STARTED", "2026-01-02T00:02:00.000Z", { trip_id: "trip_1" }),
      mkEvent("TRIP_PLANNED", "2026-01-02T00:00:00.000Z", {
        trip_id: "trip_1",
        mode: "OFFSHORE",
        owner_id: "captain_1"
      }),
      mkEvent("GEAR_MARKED_MISSING", "2026-01-02T00:03:00.000Z", {
        trip_id: "trip_1",
        gear_id: "gear_1"
      })
    ];

    const snapshot = replay(events);

    expect(snapshot.trips.trip_1?.status).toBe("ACTIVE");
    expect(snapshot.gear.gear_1?.status).toBe("MISSING");
  });

  it("increments hazard confirmation confidence deterministically", () => {
    const events: OpsEvent[] = [
      mkEvent("HAZARD_REPORTED", "2026-01-02T00:00:00.000Z", {
        hazard_id: "hz_1",
        confidence: 0.4
      }),
      mkEvent("HAZARD_CONFIRMED", "2026-01-02T00:01:00.000Z", { hazard_id: "hz_1" }),
      mkEvent("HAZARD_CONFIRMED", "2026-01-02T00:02:00.000Z", { hazard_id: "hz_1" })
    ];

    const snapshot = replay(events);
    expect(snapshot.hazards.hz_1?.confirmations).toBe(2);
    expect(snapshot.hazards.hz_1?.confidence).toBeCloseTo(0.7, 5);
  });
});
