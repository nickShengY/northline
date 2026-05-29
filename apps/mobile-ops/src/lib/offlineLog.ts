import type { OpsEvent } from "@northline/shared";

export type DraftEvent = OpsEvent<Record<string, unknown>>;

export interface LegacyDraftEvent {
  event_id: string;
  event_type: string;
  ts_device: string;
  payload_json: Record<string, unknown>;
}

const key = "northline.mobile_ops.draft_events";

export function readDraftEvents(): DraftEvent[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<DraftEvent | LegacyDraftEvent>;
    return parsed.filter((event): event is DraftEvent =>
      typeof event === "object" &&
      event !== null &&
      "tenant_id" in event &&
      "subject_type" in event &&
      "subject_id" in event &&
      "actor_id" in event &&
      "device_id" in event &&
      "schema_version" in event &&
      "event_hash" in event &&
      "signature" in event
    );
  } catch {
    return [];
  }
}

export function appendDraftEvent(event: DraftEvent) {
  const next = [...readDraftEvents(), event];
  localStorage.setItem(key, JSON.stringify(next));
}

export function removeDraftEvent(eventId: string) {
  const next = readDraftEvents().filter((event) => event.event_id !== eventId);
  localStorage.setItem(key, JSON.stringify(next));
}

export function replaceDraftEvents(events: DraftEvent[]) {
  localStorage.setItem(key, JSON.stringify(events));
}

export function clearDraftEvents() {
  localStorage.removeItem(key);
}
