export interface PendingAction {
  id: string;
  action: string;
  payload: unknown;
  createdAt: string;
}

const key = "northline.portal.pending_actions";

export function readPendingActions(): PendingAction[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return JSON.parse(raw) as PendingAction[];
  } catch {
    return [];
  }
}

export function queuePendingAction(action: PendingAction) {
  const next = [...readPendingActions(), action];
  localStorage.setItem(key, JSON.stringify(next));
}

export function clearPendingActions() {
  localStorage.removeItem(key);
}
