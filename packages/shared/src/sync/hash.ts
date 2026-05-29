import type { OpsEvent } from "../models/core";

function toBase64Url(bytes: Uint8Array): string {
  let base64: string;

  if (typeof btoa === "function") {
    const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
    base64 = btoa(binary);
  } else {
    const bufferCtor = (globalThis as { Buffer?: { from: (input: Uint8Array) => { toString: (encoding: string) => string } } }).Buffer;
    if (!bufferCtor) {
      throw new Error("No base64 encoder available in this runtime");
    }
    base64 = bufferCtor.from(bytes).toString("base64");
  }

  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toBase64Url(new Uint8Array(digest));
}

export async function computeEventHash(event: Omit<OpsEvent, "event_hash">): Promise<string> {
  const canonical = JSON.stringify({
    event_id: event.event_id,
    tenant_id: event.tenant_id,
    subject_type: event.subject_type,
    subject_id: event.subject_id,
    actor_id: event.actor_id,
    device_id: event.device_id,
    ts_device: event.ts_device,
    event_type: event.event_type,
    schema_version: event.schema_version,
    payload_json: event.payload_json,
    prev_hash: event.prev_hash ?? null
  });
  return sha256(canonical);
}

export async function verifyHashChain(event: OpsEvent, expectedPrevHash?: string): Promise<boolean> {
  if (expectedPrevHash && event.prev_hash !== expectedPrevHash) {
    return false;
  }
  const computed = await computeEventHash(event);
  return computed === event.event_hash;
}
