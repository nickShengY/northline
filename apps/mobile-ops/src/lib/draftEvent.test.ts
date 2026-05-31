import "fake-indexeddb/auto";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeEventHash, verifyEd25519Signature } from "@northline/shared";
import { generateAndStoreDeviceIdentity, readDeviceIdentity } from "./deviceIdentity";
import { appendDraftEvent, clearDraftEvents, updateDeviceChainHeadsFromAccepted } from "./offlineLog";
import { createSignedDraftEvent } from "./draftEvent";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  length = 0;

  clear(): void {
    this.values.clear();
    this.length = 0;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
    this.length = this.values.size;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
    this.length = this.values.size;
  }
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

describe("signed offline draft event construction", () => {
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

  it("hashes and signs with the installed device id before queueing", async () => {
    const identity = await generateAndStoreDeviceIdentity("crew_1");

    const event = await createSignedDraftEvent(
      { tenantId: "demoTenant", actorId: "crew_1" },
      readDeviceIdentity(),
      "SAFETY_PROMPT_ACKED",
      { trip_id: "trip_demo_001" },
      { allowDevSignature: false }
    );

    expect(event.device_id).toBe(identity.deviceId);
    expect(event.prev_hash).toBeUndefined();
    await expect(computeEventHash(event)).resolves.toBe(event.event_hash);
    await expect(verifyEd25519Signature(event.event_hash, event.signature, identity.publicKey ?? "")).resolves.toBe(true);
  });

  it("chains a new draft to the latest queued event for the same device", async () => {
    await generateAndStoreDeviceIdentity("crew_1");
    const first = await createSignedDraftEvent(
      { tenantId: "demoTenant", actorId: "crew_1" },
      readDeviceIdentity(),
      "SAFETY_PROMPT_ACKED",
      { trip_id: "trip_demo_001" },
      { allowDevSignature: false }
    );
    await appendDraftEvent(first);

    const second = await createSignedDraftEvent(
      { tenantId: "demoTenant", actorId: "crew_1" },
      readDeviceIdentity(),
      "SAFETY_PROMPT_ACKED",
      { trip_id: "trip_demo_001" },
      { allowDevSignature: false }
    );

    expect(second.prev_hash).toBe(first.event_hash);
    await expect(computeEventHash(second)).resolves.toBe(second.event_hash);
  });

  it("chains a new draft to the last accepted upload when the queue is empty", async () => {
    await generateAndStoreDeviceIdentity("crew_1");
    const accepted = await createSignedDraftEvent(
      { tenantId: "demoTenant", actorId: "crew_1" },
      readDeviceIdentity(),
      "SAFETY_PROMPT_ACKED",
      { trip_id: "trip_demo_001" },
      { allowDevSignature: false }
    );
    updateDeviceChainHeadsFromAccepted([accepted], [accepted.event_id]);

    const next = await createSignedDraftEvent(
      { tenantId: "demoTenant", actorId: "crew_1" },
      readDeviceIdentity(),
      "SAFETY_PROMPT_ACKED",
      { trip_id: "trip_demo_001" },
      { allowDevSignature: false }
    );

    expect(next.prev_hash).toBe(accepted.event_hash);
  });

  it("blocks production draft construction when no trusted key is installed", async () => {
    await expect(createSignedDraftEvent(
      { tenantId: "demoTenant", actorId: "crew_1" },
      readDeviceIdentity(),
      "SAFETY_PROMPT_ACKED",
      { trip_id: "trip_demo_001" },
      { allowDevSignature: false }
    )).rejects.toThrow("Missing trusted device signing key");
  });
});
