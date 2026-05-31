/**
 * Device Signature Verification
 *
 * Verifies cryptographic signatures on events from trusted devices.
 * Uses Ed25519 for signature verification.
 */

import type { Env } from "../types";
import { withTenant } from "./db";

export interface DeviceKey {
  device_id: string;
  public_key: string;
  key_version: number;
  revoked: boolean;
}

const serverSignaturePrefix = "server:v1:";

async function hmacSha256Base64Url(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return bytesToBase64(new Uint8Array(signature));
}

export async function signServerEventHash(env: Env, eventHash: string): Promise<string> {
  const secret = env.SIGNING_SECRET?.trim();
  if (!secret) {
    if (env.APP_ENV === "development") return "server:dev";
    throw new Error("SIGNING_SECRET is required for server-generated events outside development");
  }

  return `${serverSignaturePrefix}${await hmacSha256Base64Url(secret, eventHash)}`;
}

export async function verifyServerEventSignature(env: Env, eventHash: string, signature: string): Promise<boolean> {
  const secret = env.SIGNING_SECRET?.trim();
  if (!secret || !signature.startsWith(serverSignaturePrefix)) return false;
  return signature === await signServerEventHash(env, eventHash);
}

/**
 * Fetch a device's public key from the registry
 */
export async function getDeviceKey(
  env: Env,
  tenantId: string,
  deviceId: string
): Promise<DeviceKey | null> {
  const rows = await withTenant(env, tenantId, async (sql) => {
    return sql`
      select device_id, public_key, key_version, revoked
      from sync_device
      where tenant_id = ${tenantId}
        and device_id = ${deviceId}
        and revoked = false
      limit 1
    `;
  });

  if (!rows[0]) return null;

  return {
    device_id: rows[0].device_id as string,
    public_key: rows[0].public_key as string,
    key_version: rows[0].key_version as number,
    revoked: rows[0].revoked as boolean
  };
}

/**
 * Verify an Ed25519 signature
 *
 * @param message - The canonical message string that was signed
 * @param signature - Base64-encoded signature
 * @param publicKey - Base64-encoded Ed25519 public key
 */
export async function verifyEd25519Signature(
  message: string,
  signature: string,
  publicKey: string
): Promise<boolean> {
  try {
    // Import the public key
    const keyData = base64ToBytes(publicKey);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData.buffer as ArrayBuffer,
      { name: "Ed25519" },
      false,
      ["verify"]
    );

    // Decode signature from base64
    const signatureBytes = base64ToBytes(signature);

    // Encode message to bytes
    const messageBytes = new TextEncoder().encode(message);

    // Verify signature
    return await crypto.subtle.verify(
      "Ed25519",
      cryptoKey,
      signatureBytes.buffer as ArrayBuffer,
      messageBytes.buffer as ArrayBuffer
    );
  } catch {
    // If any crypto operation fails, signature is invalid
    return false;
  }
}

/**
 * Verify event signature against the device's registered public key
 */
export async function verifyEventSignature(
  env: Env,
  tenantId: string,
  event: {
    device_id: string;
    signature: string;
    event_hash: string;
  }
): Promise<{ valid: boolean; reason?: string }> {
  if (event.signature === "server-generated" || event.signature.startsWith("server:")) {
    return { valid: false, reason: "server_signature_not_allowed_for_upload" };
  }

  let deviceKey: DeviceKey | null;
  try {
    deviceKey = await getDeviceKey(env, tenantId, event.device_id);
  } catch {
    return { valid: false, reason: "device_key_lookup_failed" };
  }

  if (!deviceKey) {
    return { valid: false, reason: "device_not_registered" };
  }

  if (deviceKey.revoked) {
    return { valid: false, reason: "device_revoked" };
  }

  // Verify signature against event_hash
  const isValid = await verifyEd25519Signature(
    event.event_hash,
    event.signature,
    deviceKey.public_key
  );

  if (!isValid) {
    return { valid: false, reason: "invalid_signature" };
  }

  return { valid: true };
}

/**
 * Batch verify multiple event signatures
 */
export async function batchVerifySignatures(
  env: Env,
  tenantId: string,
  events: Array<{
    event_id: string;
    device_id: string;
    signature: string;
    event_hash: string;
  }>
): Promise<Map<string, { valid: boolean; reason?: string }>> {
  const results = new Map<string, { valid: boolean; reason?: string }>();

  // Group by device to minimize key lookups
  const byDevice = new Map<string, typeof events>();
  for (const event of events) {
    const existing = byDevice.get(event.device_id) ?? [];
    existing.push(event);
    byDevice.set(event.device_id, existing);
  }

  // Verify each device's events
  for (const [deviceId, deviceEvents] of byDevice) {
    if (deviceEvents[0]?.signature === "server-generated" || deviceEvents[0]?.signature.startsWith("server:")) {
      for (const event of deviceEvents) {
        results.set(event.event_id, { valid: false, reason: "server_signature_not_allowed_for_upload" });
      }
      continue;
    }

    const deviceKey = await getDeviceKey(env, tenantId, deviceId);

    if (!deviceKey) {
      for (const event of deviceEvents) {
        results.set(event.event_id, { valid: false, reason: "device_not_registered" });
      }
      continue;
    }

    if (deviceKey.revoked) {
      for (const event of deviceEvents) {
        results.set(event.event_id, { valid: false, reason: "device_revoked" });
      }
      continue;
    }

    // Verify each event's signature
    for (const event of deviceEvents) {
      const isValid = await verifyEd25519Signature(
        event.event_hash,
        event.signature,
        deviceKey.public_key
      );

      results.set(event.event_id, {
        valid: isValid,
        reason: isValid ? undefined : "invalid_signature"
      });
    }
  }

  return results;
}

/**
 * Helper: Convert base64 string to Uint8Array
 */
function base64ToBytes(base64: string): Uint8Array {
  // Handle URL-safe base64
  const standardBase64 = base64
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  // Add padding if needed
  const padded = standardBase64.padEnd(
    Math.ceil(standardBase64.length / 4) * 4,
    "="
  );

  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i) as number;
  }
  return bytes;
}

/**
 * Helper: Convert Uint8Array to base64 string
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte !== undefined) {
      binary += String.fromCharCode(byte);
    }
  }
  const base64 = btoa(binary);
  // Convert to URL-safe base64
  return base64
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * Generate a new Ed25519 key pair for device registration
 */
export async function generateDeviceKeyPair(): Promise<{
  publicKey: string;
  privateKey: string;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"]
  );

  const publicKeyRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const privateKeyPkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);

  return {
    publicKey: bytesToBase64(new Uint8Array(publicKeyRaw)),
    privateKey: bytesToBase64(new Uint8Array(privateKeyPkcs8))
  };
}

/**
 * Sign a message with a private key
 */
export async function signWithPrivateKey(
  message: string,
  privateKeyBase64: string
): Promise<string> {
  const privateKeyData = base64ToBytes(privateKeyBase64);

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyData.buffer as ArrayBuffer,
    { name: "Ed25519" },
    false,
    ["sign"]
  );

  const messageBytes = new TextEncoder().encode(message);
  const signatureBytes = await crypto.subtle.sign(
    "Ed25519",
    privateKey,
    messageBytes.buffer as ArrayBuffer
  );

  return bytesToBase64(new Uint8Array(signatureBytes));
}
