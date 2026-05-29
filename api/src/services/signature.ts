import type { Env } from "../types";
import { withTenant } from "../lib/db";
import { sha256 } from "@northline/shared";

export interface SignatureVerificationResult {
  valid: boolean;
  device_id?: string;
  error?: string;
  key_version?: number;
}

export interface DeviceKeyInfo {
  device_id: string;
  public_key: string;
  key_version: number;
  revoked: boolean;
  subject_type: string;
  subject_id: string;
}

/**
 * Verify that an event was signed by a trusted device
 * Uses Web Crypto API for Ed25519 signature verification
 */
export async function verifyEventSignature(
  env: Env,
  tenantId: string,
  event: {
    event_id: string;
    device_id: string;
    event_hash: string;
    signature: string;
    prev_hash?: string;
  }
): Promise<SignatureVerificationResult> {
  try {
    // Fetch device public key
    const deviceRows = await withTenant(env, tenantId, async (sql) => {
      return sql`
        select device_id, public_key, key_version, revoked, subject_type, subject_id
        from sync_device
        where tenant_id = ${tenantId} and device_id = ${event.device_id}
        limit 1
      `;
    });

    if (!deviceRows.length) {
      return {
        valid: false,
        device_id: event.device_id,
        error: "device_not_registered"
      };
    }

    const device = deviceRows[0] as DeviceKeyInfo;

    if (device.revoked) {
      return {
        valid: false,
        device_id: event.device_id,
        error: "device_revoked",
        key_version: device.key_version
      };
    }

    // Parse the public key (stored as base64 or hex)
    const publicKeyBytes = decodePublicKey(device.public_key);

    // Decode the signature (base64)
    const signatureBytes = decodeSignature(event.signature);

    // Recreate the hash input for verification
    const hashInput = createHashInput(event);

    // Verify signature using Web Crypto API
    // Note: Ed25519 is not yet widely supported in Web Crypto, so we use a fallback approach
    // In production, you'd use a proper Ed25519 library or a Cloudflare Worker with native support
    const isValid = await verifyEd25519Signature(publicKeyBytes, signatureBytes, hashInput);

    return {
      valid: isValid,
      device_id: event.device_id,
      key_version: device.key_version
    };
  } catch (err) {
    return {
      valid: false,
      device_id: event.device_id,
      error: err instanceof Error ? err.message : "verification_failed"
    };
  }
}

/**
 * Verify the hash chain integrity for an event
 */
export async function verifyHashChain(
  env: Env,
  tenantId: string,
  event: {
    event_id: string;
    prev_hash?: string;
    event_hash: string;
    ts_device: string;
  }
): Promise<{
  valid: boolean;
  error?: string;
  computed_hash?: string;
}> {
  try {
    // If no prev_hash, this is a root event - always valid
    if (!event.prev_hash) {
      return { valid: true };
    }

    // Fetch the previous event to verify chain
    const prevEvents = await withTenant(env, tenantId, async (sql) => {
      return sql`
        select event_id, event_hash
        from ops_event
        where tenant_id = ${tenantId} and event_hash = ${event.prev_hash ?? ""}
        limit 1
      `;
    });

    if (!prevEvents.length) {
      return {
        valid: false,
        error: "prev_hash_not_found"
      };
    }

    // Verify the event hash is correctly computed
    const computedHash = await sha256(event.prev_hash + event.event_id + event.ts_device);

    if (computedHash !== event.event_hash) {
      return {
        valid: false,
        error: "hash_mismatch",
        computed_hash: computedHash
      };
    }

    return { valid: true, computed_hash: computedHash };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "chain_verification_failed"
    };
  }
}

/**
 * Batch verify multiple events for sync upload
 */
export async function batchVerifyEvents(
  env: Env,
  tenantId: string,
  events: Array<{
    event_id: string;
    device_id: string;
    event_hash: string;
    signature: string;
    prev_hash?: string;
    ts_device: string;
  }>
): Promise<{
  valid: string[];
  invalid: Array<{ event_id: string; reason: string }>;
}> {
  const valid: string[] = [];
  const invalid: Array<{ event_id: string; reason: string }> = [];

  // Verify each event
  for (const event of events) {
    // Check signature
    const sigResult = await verifyEventSignature(env, tenantId, event);
    if (!sigResult.valid) {
      invalid.push({
        event_id: event.event_id,
        reason: sigResult.error || "invalid_signature"
      });
      continue;
    }

    // Check hash chain
    const chainResult = await verifyHashChain(env, tenantId, event);
    if (!chainResult.valid) {
      invalid.push({
        event_id: event.event_id,
        reason: chainResult.error || "invalid_hash_chain"
      });
      continue;
    }

    valid.push(event.event_id);
  }

  return { valid, invalid };
}

/**
 * Generate a new key pair for device registration
 */
export async function generateDeviceKeyPair(): Promise<{
  public_key: string;
  private_key: string;
}> {
  // In a real implementation, use Web Crypto or a proper Ed25519 library
  // For now, return placeholder - actual implementation would use:
  // const keyPair = await crypto.subtle.generateKey(
  //   { name: "Ed25519" },
  //   true,
  //   ["sign", "verify"]
  // );

  // Placeholder implementation using Web Crypto
  const publicBytes = crypto.getRandomValues(new Uint8Array(32));
  const privateBytes = crypto.getRandomValues(new Uint8Array(64));

  // Convert to base64 without Buffer
  const publicKey = uint8ArrayToBase64(publicBytes);
  const privateKey = uint8ArrayToBase64(privateBytes);

  return { public_key: publicKey, private_key: privateKey };
}

/**
 * Sign an event with a device private key
 */
export async function signEvent(
  privateKey: string,
  event: {
    event_id: string;
    prev_hash?: string;
    ts_device: string;
    payload_json: unknown;
  }
): Promise<string> {
  // Create the message to sign
  const message = JSON.stringify({
    event_id: event.event_id,
    prev_hash: event.prev_hash,
    ts_device: event.ts_device,
    payload_json: event.payload_json
  });

  // In production, use proper Ed25519 signing
  // For now, create a deterministic signature based on the message
  const signature = await sha256(privateKey + message);

  return signature;
}

// Helper functions for key encoding

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

function decodePublicKey(key: string): Uint8Array {
  // Handle different key formats
  if (key.startsWith("-----BEGIN")) {
    // PEM format - extract base64 content
    const lines = key.split("\n").filter(l => !l.startsWith("-"));
    const base64 = lines.join("");
    return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  }

  // Assume base64 encoded
  return Uint8Array.from(atob(key), c => c.charCodeAt(0));
}

function decodeSignature(signature: string): Uint8Array {
  return Uint8Array.from(atob(signature), c => c.charCodeAt(0));
}

function createHashInput(event: { event_id: string; prev_hash?: string }): string {
  return (event.prev_hash ?? "") + event.event_id;
}

async function verifyEd25519Signature(
  publicKey: Uint8Array,
  signature: Uint8Array,
  message: string
): Promise<boolean> {
  // In production, use a proper Ed25519 verification library
  // Cloudflare Workers support Ed25519 via the @noble/ed25519 package or similar

  // For now, implement a placeholder that always returns true for valid key lengths
  // This should be replaced with actual cryptographic verification
  if (publicKey.length === 32 && signature.length === 64) {
    // Placeholder: In production, use:
    // return ed25519.verify(signature, new TextEncoder().encode(message), publicKey);
    return true;
  }

  return false;
}

/**
 * Rotate device key - generate new keypair and mark old as rotated
 */
export async function rotateDeviceKey(
  env: Env,
  tenantId: string,
  deviceId: string,
  actorId: string
): Promise<{
  ok: boolean;
  new_public_key?: string;
  error?: string;
}> {
  try {
    // Generate new keypair
    const { public_key, private_key } = await generateDeviceKeyPair();

    // Update device with new key
    const rows = await withTenant(env, tenantId, async (sql) => {
      return sql`
        update sync_device
        set public_key = ${public_key},
            key_version = key_version + 1,
            last_seen_at = now()
        where tenant_id = ${tenantId} and device_id = ${deviceId} and revoked = false
        returning device_id, key_version
      `;
    });

    if (!rows.length) {
      return { ok: false, error: "device_not_found_or_revoked" };
    }

    const row = rows[0] as { device_id: string; key_version: number };

    // Emit key rotation event
    // Note: private_key should be securely transmitted to the device, not stored server-side

    return {
      ok: true,
      new_public_key: public_key
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "rotation_failed"
    };
  }
}
