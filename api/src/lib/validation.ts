import { computeEventHash, envelopeSchema, validatePayload } from "@northline/shared";
import type { OpsEvent } from "@northline/shared";
import type { Env } from "../types";
import { verifyEventSignature } from "./signature";

/**
 * Validate incoming event with signature verification
 */
export async function validateIncomingEventWithSignature(
  env: Env,
  tenantId: string,
  input: unknown
): Promise<{ ok: true; event: OpsEvent } | { ok: false; reason: unknown }> {
  // First, validate schema
  const parsed = envelopeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.flatten() };
  }

  // Validate payload
  const payloadResult = validatePayload(parsed.data.event_type, parsed.data.payload_json);
  if (!payloadResult.ok) {
    return { ok: false, reason: payloadResult.error };
  }

  const event = {
    ...parsed.data,
    payload_json: payloadResult.data
  };
  const computedHash = await computeEventHash(event);

  if (computedHash !== event.event_hash) {
    return { ok: false, reason: { event_hash: "hash_mismatch" } };
  }

  if (env.APP_ENV === "development" && event.signature.startsWith("dev:")) {
    return { ok: true, event };
  }

  // Verify signature
  const sigResult = await verifyEventSignature(env, tenantId, {
    device_id: event.device_id,
    signature: event.signature,
    event_hash: event.event_hash
  });

  if (!sigResult.valid) {
    return { ok: false, reason: { signature_verification: sigResult.reason ?? "invalid_signature" } };
  }

  return { ok: true, event };
}
