import { describe, expect, it } from "vitest";
import { generateDeviceKeyPair, signWithPrivateKey, verifyEd25519Signature } from "../src/sync/signature";

describe("device signatures", () => {
  it("signs and verifies Ed25519 messages", async () => {
    const keyPair = await generateDeviceKeyPair();
    const signature = await signWithPrivateKey("event_hash_1", keyPair.privateKey);

    await expect(verifyEd25519Signature("event_hash_1", signature, keyPair.publicKey)).resolves.toBe(true);
    await expect(verifyEd25519Signature("event_hash_2", signature, keyPair.publicKey)).resolves.toBe(false);
  });
});
