import type { OpsEvent } from "../models/core";

export interface SyncRejectedEvent {
  event_id?: string;
  reason: unknown;
}

export interface SyncValidationRejectedEvent {
  event_type: "SYNC_VALIDATION_REJECTED";
  ts_server: string;
  payload_json: SyncRejectedEvent;
}

export interface UploadEventsResponse {
  cursor?: string;
  accepted?: string[];
  accepted_count?: number;
  rejected: SyncRejectedEvent[];
  server_generated_events?: SyncValidationRejectedEvent[];
}

export interface DownloadEventsResponse {
  cursor: string;
  events: OpsEvent[];
}

export interface AckSyncResponse {
  ok: true;
  cursor: string;
  acknowledged_at: string;
  ack_id?: string;
}

export function buildSyncValidationRejectedEvents(
  rejected: SyncRejectedEvent[],
  tsServer = new Date().toISOString()
): SyncValidationRejectedEvent[] {
  return rejected.map((item) => ({
    event_type: "SYNC_VALIDATION_REJECTED",
    ts_server: tsServer,
    payload_json: item
  }));
}

export function syncRejectedReasonCode(item: SyncRejectedEvent): string {
  if (typeof item.reason === "string") return item.reason;
  if (item.reason && typeof item.reason === "object") {
    const signature = (item.reason as { signature_verification?: unknown }).signature_verification;
    if (typeof signature === "string") return `signature_verification:${signature}`;

    const eventHash = (item.reason as { event_hash?: unknown }).event_hash;
    if (typeof eventHash === "string") return `event_hash:${eventHash}`;
  }

  return "unknown";
}

export function syncRejectedReasonCodes(response: Pick<UploadEventsResponse, "rejected">): string[] {
  return response.rejected.map(syncRejectedReasonCode);
}

export function hasDeviceChainRejection(response: Pick<UploadEventsResponse, "rejected">) {
  return syncRejectedReasonCodes(response).some(
    (reason) => reason === "hash_chain_gap" || reason === "hash_chain_conflict"
  );
}
