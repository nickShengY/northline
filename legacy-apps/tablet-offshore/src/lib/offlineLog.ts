export interface DraftEvent {
  event_id: string;
  event_type: string;
  ts_device: string;
  payload_json: Record<string, unknown>;
}

const key = "northline.offshore.draft_events";

export function readDraftEvents(): DraftEvent[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as DraftEvent[]) : [];
  } catch {
    return [];
  }
}

export function appendDraftEvent(event: DraftEvent) {
  const next = [...readDraftEvents(), event];
  localStorage.setItem(key, JSON.stringify(next));
}

export function clearDraftEvents() {
  localStorage.removeItem(key);
}
