import "fake-indexeddb/auto";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendDraftEvent,
  appendCachedServerEvents,
  clearDraftEvents,
  clearSyncCursor,
  hasDeviceChainRejection,
  latestQueuedHashForDevice,
  readDraftEvents,
  readCachedServerEvents,
  readDeviceChainHead,
  readSyncCursor,
  rejectedReasonCodes,
  nextSyncUploadBatch,
  remainingDraftEventsAfterBatchedUpload,
  remainingDraftEventsAfterUpload,
  removeDraftEvent,
  replaceDraftEvents,
  updateDeviceChainHeadsFromAccepted,
  writeSyncCursor,
  type DraftEvent
} from "./offlineLog";

const legacyKey = "northline.mobile_ops.draft_events";
const syncCursorKey = "northline.mobile_ops.sync_cursors";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  clear() {
    this.values.clear();
  }
}

function event(id: string, tsDevice = "2026-05-31T00:00:00.000Z"): DraftEvent {
  return {
    event_id: id,
    tenant_id: "demoTenant",
    subject_type: "USER",
    subject_id: "crew_1",
    actor_id: "crew_1",
    device_id: "mobile_ops_pwa",
    ts_device: tsDevice,
    event_type: "SAFETY_PROMPT_ACKED",
    schema_version: 1,
    payload_json: { trip_id: "trip_demo_001" },
    event_hash: `hash_${id}`,
    signature: "dev:crew_1"
  };
}

async function resetDb() {
  await clearDraftEvents();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("northline-mobile-ops");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

describe("mobile offline draft queue", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", fakeIndexedDB);
    vi.stubGlobal("localStorage", new MemoryStorage());
  });

  afterEach(async () => {
    localStorage.clear();
    if (typeof indexedDB !== "undefined") {
      await resetDb();
    }
    vi.unstubAllGlobals();
  });

  it("persists queued drafts across database reopen cycles", async () => {
    await appendDraftEvent(event("evt_1"));
    await appendDraftEvent(event("evt_2"));

    expect((await readDraftEvents()).map((draft) => draft.event_id)).toEqual(["evt_1", "evt_2"]);

    await removeDraftEvent("evt_1");
    expect((await readDraftEvents()).map((draft) => draft.event_id)).toEqual(["evt_2"]);
  });

  it("migrates valid legacy localStorage drafts into IndexedDB and clears the legacy copy", async () => {
    localStorage.setItem(legacyKey, JSON.stringify([event("legacy_1"), { event_id: "bad_legacy" }]));

    const drafts = await readDraftEvents();

    expect(drafts.map((draft) => draft.event_id)).toEqual(["legacy_1"]);
    expect(localStorage.getItem(legacyKey)).toBeNull();
    expect((await readDraftEvents()).map((draft) => draft.event_id)).toEqual(["legacy_1"]);
  });

  it("falls back to localStorage when IndexedDB is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);

    await appendDraftEvent(event("fallback_1"));

    expect(JSON.parse(localStorage.getItem(legacyKey) ?? "[]")).toHaveLength(1);
    expect((await readDraftEvents()).map((draft) => draft.event_id)).toEqual(["fallback_1"]);

    await replaceDraftEvents([event("fallback_2")]);
    expect((await readDraftEvents()).map((draft) => draft.event_id)).toEqual(["fallback_2"]);
  });

  it("keeps unaccepted drafts after partial upload reconciliation", () => {
    const drafts = [event("evt_accepted"), event("evt_rejected"), event("evt_not_seen")];

    expect(
      remainingDraftEventsAfterUpload(drafts, {
        accepted: ["evt_accepted"],
        rejected: [{ event_id: "evt_rejected", reason: "hash_chain_conflict" }]
      }).map((draft) => draft.event_id)
    ).toEqual(["evt_rejected", "evt_not_seen"]);
  });

  it("keeps unsent drafts when reconciling a capped upload batch", () => {
    const drafts = Array.from({ length: 252 }, (_, index) => event(`evt_${index}`));
    const batch = nextSyncUploadBatch(drafts);

    expect(batch).toHaveLength(250);
    expect(
      remainingDraftEventsAfterBatchedUpload(drafts, {
        accepted: batch.map((draft) => draft.event_id),
        rejected: []
      }).map((draft) => draft.event_id)
    ).toEqual(["evt_250", "evt_251"]);
  });

  it("extracts actionable rejection reason codes from upload responses", () => {
    const response = {
      accepted: [],
      rejected: [
        { event_id: "evt_chain", reason: "hash_chain_conflict" },
        { event_id: "evt_sig", reason: { signature_verification: "device_key_lookup_failed" } },
        { event_id: "evt_hash", reason: { event_hash: "hash_mismatch" } }
      ]
    };

    expect(rejectedReasonCodes(response)).toEqual([
      "hash_chain_conflict",
      "signature_verification:device_key_lookup_failed",
      "event_hash:hash_mismatch"
    ]);
    expect(hasDeviceChainRejection(response)).toBe(true);
  });

  it("tracks the latest queued hash for each device", async () => {
    await appendDraftEvent({ ...event("evt_z", "2026-05-31T00:01:00.000Z"), device_id: "device_a", event_hash: "hash_1" });
    await appendDraftEvent({ ...event("evt_a", "2026-05-31T00:02:00.000Z"), device_id: "device_a", event_hash: "hash_2" });

    await expect(latestQueuedHashForDevice("device_a")).resolves.toBe("hash_2");
    await expect(latestQueuedHashForDevice("device_b")).resolves.toBeNull();
  });

  it("persists accepted upload chain heads for future offline events", async () => {
    const drafts = [
      { ...event("evt_1"), device_id: "device_a", event_hash: "hash_1" },
      { ...event("evt_2"), device_id: "device_a", event_hash: "hash_2" },
      { ...event("evt_3"), device_id: "device_b", event_hash: "hash_3" }
    ];

    updateDeviceChainHeadsFromAccepted(drafts, ["evt_1", "evt_2"]);

    expect(readDeviceChainHead("device_a")).toBe("hash_2");
    expect(readDeviceChainHead("device_b")).toBeNull();
    await expect(latestQueuedHashForDevice("device_a")).resolves.toBe("hash_2");
  });

  it("persists durable download cursors by scope", () => {
    writeSyncCursor("2026-05-31T00:00:00.000Z|evt_1");
    writeSyncCursor("2026-05-31T00:01:00.000Z|evt_trip", "trip:trip_demo_001");

    expect(readSyncCursor()).toBe("2026-05-31T00:00:00.000Z|evt_1");
    expect(readSyncCursor("trip:trip_demo_001")).toBe("2026-05-31T00:01:00.000Z|evt_trip");

    clearSyncCursor();

    expect(readSyncCursor()).toBeNull();
    expect(readSyncCursor("trip:trip_demo_001")).toBe("2026-05-31T00:01:00.000Z|evt_trip");
  });

  it("ignores corrupt cursor storage", () => {
    localStorage.setItem(syncCursorKey, "{bad json");

    expect(readSyncCursor()).toBeNull();
  });

  it("persists downloaded server events before sync ack", async () => {
    await appendCachedServerEvents([
      { ...event("server_evt_2", "2026-05-31T00:02:00.000Z"), ts_server: "2026-05-31T00:02:01.000Z" },
      { ...event("server_evt_1", "2026-05-31T00:01:00.000Z"), ts_server: "2026-05-31T00:01:01.000Z" }
    ]);

    const cached = await readCachedServerEvents();

    expect(cached.map((item) => item.event_id).sort()).toEqual(["server_evt_1", "server_evt_2"]);
  });

  it("deduplicates downloaded server events by event id", async () => {
    await appendCachedServerEvents([{ ...event("server_evt_1"), payload_json: { version: 1 } }]);
    await appendCachedServerEvents([{ ...event("server_evt_1"), payload_json: { version: 2 } }]);

    const cached = await readCachedServerEvents();

    expect(cached).toHaveLength(1);
    expect(cached[0]?.payload_json).toEqual({ version: 2 });
  });
});
