import { computeEventHash, type OpsEvent } from "@northline/shared";
import { readDeviceIdentity, signDraftEventHash, type DeviceIdentitySummary } from "./deviceIdentity";
import { latestQueuedHashForDevice } from "./offlineLog";

export interface DraftAuthIdentity {
  tenantId: string;
  actorId: string;
}

export async function createSignedDraftEvent(
  authIdentity: DraftAuthIdentity,
  deviceIdentity: DeviceIdentitySummary,
  eventType: string,
  payload: Record<string, unknown>,
  options: { allowDevSignature: boolean }
): Promise<OpsEvent<Record<string, unknown>>> {
  const currentDeviceIdentity = readDeviceIdentity();
  const deviceId = currentDeviceIdentity.deviceId ?? deviceIdentity.deviceId ?? "mobile_ops_pwa";
  const prevHash = await latestQueuedHashForDevice(deviceId);

  const baseEvent = {
    event_id: crypto.randomUUID(),
    tenant_id: authIdentity.tenantId,
    subject_type: "USER" as const,
    subject_id: authIdentity.actorId,
    actor_id: authIdentity.actorId,
    device_id: deviceId,
    ts_device: new Date().toISOString(),
    event_type: eventType,
    schema_version: 1,
    payload_json: payload,
    prev_hash: prevHash ?? undefined,
    signature: ""
  };
  const eventHash = await computeEventHash(baseEvent);
  const signed = await signDraftEventHash(eventHash);

  if (!signed && !options.allowDevSignature) {
    throw new Error("Missing trusted device signing key");
  }

  if (signed && signed.deviceId !== deviceId) {
    throw new Error("Device signing key changed while building the draft event");
  }

  return {
    ...baseEvent,
    signature: signed?.signature ?? `dev:${authIdentity.actorId}`,
    event_hash: eventHash
  };
}
