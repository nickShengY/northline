import { envelopeSchema, validatePayload } from "@northline/shared";
import type { Env } from "../types";
import { verifyEventSignature } from "./signature";

export function validateIncomingEvent(input: unknown) {
  const parsed = envelopeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, reason: parsed.error.flatten() };
  }
  const payloadResult = validatePayload(parsed.data.event_type, parsed.data.payload_json);
  if (!payloadResult.ok) {
    return { ok: false as const, reason: payloadResult.error };
  }
  return {
    ok: true as const,
    event: {
      ...parsed.data,
      payload_json: payloadResult.data
    }
  };
}

/**
 * Validate incoming event with signature verification
 */
export async function validateIncomingEventWithSignature(
  env: Env,
  tenantId: string,
  input: unknown
): Promise<{ ok: true; event: ReturnType<typeof validateIncomingEvent>['event'] } | { ok: false; reason: unknown }> {
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

  // Verify signature
  const sigResult = await verifyEventSignature(env, tenantId, {
    device_id: event.device_id,
    signature: event.signature,
    event_hash: event.event_hash
  });

  if (!sigResult.valid) {
    return { ok: false, reason: { signature_verification: sigResult.reason } };
  }

  return { ok: true, event };
}
