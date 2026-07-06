import "fake-indexeddb/auto";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDeviceIdentity,
  generateAndStoreDeviceIdentity,
  readDeviceIdentity,
  signDraftEventHash,
  verifyDeviceIdentity
} from "./deviceIdentity";
import { verifyEd25519Signature } from "@northline/shared";

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

describe("mobile device identity", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("indexedDB", fakeIndexedDB);
  });

  it("generates a secure local device key and signs event hashes", async () => {
    const identity = await generateAndStoreDeviceIdentity("crew_1");
    const signed = await signDraftEventHash("event_hash_1");

    expect(identity.deviceId).toMatch(/^mobile_crew_1_/);
    expect(readDeviceIdentity()).toEqual(identity);
    expect(localStorage.getItem("northline.mobile_ops.device_private_key")).toBeNull();
    expect(localStorage.getItem("northline.mobile_ops.device_key_storage")).toBe("indexeddb");
    expect(signed?.deviceId).toBe(identity.deviceId);
    await expect(verifyEd25519Signature("event_hash_1", signed?.signature ?? "", identity.publicKey ?? "")).resolves.toBe(true);
    await expect(verifyEd25519Signature("event_hash_2", signed?.signature ?? "", identity.publicKey ?? "")).resolves.toBe(false);
  });

  it("falls back to localStorage private key storage when IndexedDB is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);

    const identity = await generateAndStoreDeviceIdentity("crew_1");
    const signed = await signDraftEventHash("event_hash_1");

    expect(localStorage.getItem("northline.mobile_ops.device_private_key")).toBeTruthy();
    expect(localStorage.getItem("northline.mobile_ops.device_key_storage")).toBe("localStorage");
    await expect(verifyEd25519Signature("event_hash_1", signed?.signature ?? "", identity.publicKey ?? "")).resolves.toBe(true);
  });

  it("returns null signing output when no private key is installed", async () => {
    expect(await signDraftEventHash("event_hash_1")).toBeNull();
    expect(readDeviceIdentity()).toEqual({ deviceId: null, publicKey: null, hasPrivateKey: false });
  });

  it("clears local device identity material", async () => {
    await generateAndStoreDeviceIdentity("crew_1");
    await clearDeviceIdentity();

    expect(readDeviceIdentity()).toEqual({ deviceId: null, publicKey: null, hasPrivateKey: false });
    expect(await signDraftEventHash("event_hash_1")).toBeNull();
  });

  it("degrades a stale indexeddb key flag when the stored key is missing", async () => {
    localStorage.setItem("northline.mobile_ops.device_id", "mobile_crew_1_stale");
    localStorage.setItem("northline.mobile_ops.device_public_key", "stale_public_key");
    localStorage.setItem("northline.mobile_ops.device_key_storage", "indexeddb");

    expect(readDeviceIdentity().hasPrivateKey).toBe(true);

    const verified = await verifyDeviceIdentity();

    expect(verified.hasPrivateKey).toBe(false);
    expect(readDeviceIdentity().hasPrivateKey).toBe(false);
  });
});
