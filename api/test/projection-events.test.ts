import { describe, expect, it } from "vitest";
import type { OpsEvent } from "@northline/shared";
import { buildEventCursor, parseEventCursor, projectAcceptedEvent, validateDeviceChainContinuity } from "../src/lib/events";
import { compareProjectionEvents } from "../src/services/projection";
import type { SqlQuery } from "../src/lib/db";

function event(event_type: OpsEvent["event_type"], payload_json: Record<string, unknown>): OpsEvent {
  return {
    event_id: `evt_${event_type.toLowerCase()}`,
    tenant_id: "tenant_1",
    subject_type: "VESSEL",
    subject_id: String(payload_json.trip_id ?? "trip_1"),
    actor_id: "captain_1",
    device_id: "device_1",
    ts_device: "2026-05-31T07:00:00.000Z",
    event_type,
    schema_version: 1,
    payload_json,
    event_hash: "hash",
    signature: "server-generated"
  };
}

function recordingSql(calls: string[]): SqlQuery {
  return async (strings, ...values) => {
    calls.push(strings.reduce((query, chunk, index) => `${query}${chunk}${index < values.length ? `:${String(values[index])}:` : ""}`, ""));
    return [];
  };
}

function chainSql(latestHash: string | null, calls: string[] = []): SqlQuery {
  return async (strings, ...values) => {
    calls.push(strings.reduce((query, chunk, index) => `${query}${chunk}${index < values.length ? `:${String(values[index])}:` : ""}`, ""));
    return latestHash ? [{ event_hash: latestHash }] : [];
  };
}

describe("incremental event projections", () => {
  it("projects planned trips into trip_state", async () => {
    const calls: string[] = [];
    await projectAcceptedEvent(recordingSql(calls), "tenant_1", event("TRIP_PLANNED", {
      trip_id: "trip_1",
      mode: "OFFSHORE",
      owner_id: "owner_1",
      location_name: "Dutch Harbor"
    }));

    expect(calls.join("\n")).toContain("insert into trip_state");
    expect(calls.join("\n")).toContain(":trip_1:");
  });

  it("projects offshore gear transitions into gear_state_offshore", async () => {
    const calls: string[] = [];
    await projectAcceptedEvent(recordingSql(calls), "tenant_1", event("GEAR_MARKED_MISSING", {
      trip_id: "trip_1",
      gear_id: "string_12",
      mode: "OFFSHORE"
    }));

    const sql = calls.join("\n");
    expect(sql).toContain("insert into gear_state_offshore");
    expect(sql).toContain(":MISSING:");
  });

  it("projects hazards into hazard_layer_state", async () => {
    const calls: string[] = [];
    await projectAcceptedEvent(recordingSql(calls), "tenant_1", event("HAZARD_REPORTED", {
      hazard_id: "hazard_1",
      hazard_type: "WEATHER",
      severity: 4,
      confidence: 0.8,
      sharing_scope: "ORG",
      location: { lat: 55.1, lon: -166.1 }
    }));

    expect(calls.join("\n")).toContain("insert into hazard_layer_state");
  });
});

describe("device event-chain continuity", () => {
  it("accepts the first event from a device when no previous hash exists", async () => {
    const result = await validateDeviceChainContinuity(
      chainSql(null),
      "tenant_1",
      event("SAFETY_PROMPT_ACKED", { trip_id: "trip_1" }),
      new Map()
    );

    expect(result).toBe("ok");
  });

  it("rejects events that reference an unknown previous hash", async () => {
    const result = await validateDeviceChainContinuity(
      chainSql(null),
      "tenant_1",
      {
        ...event("SAFETY_PROMPT_ACKED", { trip_id: "trip_1" }),
        prev_hash: "missing_hash"
      },
      new Map()
    );

    expect(result).toBe("hash_chain_gap");
  });

  it("rejects events that do not extend the latest stored device hash", async () => {
    const result = await validateDeviceChainContinuity(
      chainSql("server_latest_hash"),
      "tenant_1",
      {
        ...event("SAFETY_PROMPT_ACKED", { trip_id: "trip_1" }),
        prev_hash: "stale_hash"
      },
      new Map()
    );

    expect(result).toBe("hash_chain_conflict");
  });

  it("uses accepted batch events as the next expected hash for the same device", async () => {
    const calls: string[] = [];
    const cache = new Map<string, string | null>();
    const first = {
      ...event("SAFETY_PROMPT_ACKED", { trip_id: "trip_1" }),
      event_hash: "hash_1"
    };
    const second = {
      ...event("SAFETY_PROMPT_ACKED", { trip_id: "trip_1" }),
      event_id: "evt_second",
      prev_hash: "hash_1",
      event_hash: "hash_2"
    };

    await expect(validateDeviceChainContinuity(chainSql(null, calls), "tenant_1", first, cache)).resolves.toBe("ok");
    await expect(validateDeviceChainContinuity(chainSql(null, calls), "tenant_1", second, cache)).resolves.toBe("ok");
    expect(calls.filter((call) => call.includes("select event_hash"))).toHaveLength(1);
  });
});

describe("sync event cursors", () => {
  it("builds and parses stable event cursors with timestamp and event id", () => {
    const cursor = buildEventCursor({
      ts_server: "2026-05-31T07:00:00.000Z",
      event_id: "evt_001"
    });

    expect(cursor).toBe("2026-05-31T07:00:00.000Z|evt_001");
    expect(parseEventCursor(cursor)).toEqual({
      kind: "event",
      tsServer: "2026-05-31T07:00:00.000Z",
      eventId: "evt_001"
    });
    expect(parseEventCursor("2026-05-31T07:00:00.000Z")).toEqual({
      kind: "timestamp",
      tsServer: "2026-05-31T07:00:00.000Z"
    });
  });

  it("treats malformed compound cursors as timestamp-only cursors for backwards compatibility", () => {
    expect(parseEventCursor("2026-05-31T07:00:00.000Z|")).toEqual({
      kind: "timestamp",
      tsServer: "2026-05-31T07:00:00.000Z|"
    });
  });
});

describe("projection rebuild ordering", () => {
  it("uses server append order before device timestamps during replay", () => {
    const planned = {
      ...event("TRIP_PLANNED", { trip_id: "trip_1" }),
      event_id: "evt_a_planned",
      ts_device: "2026-05-31T09:00:00.000Z",
      ts_server: "2026-05-31T07:00:00.000Z"
    };
    const started = {
      ...event("TRIP_STARTED", { trip_id: "trip_1" }),
      event_id: "evt_b_started",
      ts_device: "2026-05-31T06:00:00.000Z",
      ts_server: "2026-05-31T07:01:00.000Z"
    };

    expect([started, planned].sort(compareProjectionEvents).map((item) => item.event_id)).toEqual([
      "evt_a_planned",
      "evt_b_started"
    ]);
  });

  it("uses event id as the final deterministic projection tie-breaker", () => {
    const left = {
      ...event("SAFETY_PROMPT_ACKED", { trip_id: "trip_1" }),
      event_id: "evt_b",
      ts_server: "2026-05-31T07:00:00.000Z"
    };
    const right = {
      ...left,
      event_id: "evt_a"
    };

    expect([left, right].sort(compareProjectionEvents).map((item) => item.event_id)).toEqual(["evt_a", "evt_b"]);
  });
});
