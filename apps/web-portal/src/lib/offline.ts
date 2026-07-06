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
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PendingAction[]) : [];
  } catch {
    return [];
  }
}

function writePendingActions(actions: PendingAction[]) {
  try {
    localStorage.setItem(key, JSON.stringify(actions));
  } catch {
    // Storage may be unavailable (private mode, quota); queue stays in memory only.
  }
}

export function queuePendingAction(action: PendingAction) {
  writePendingActions([...readPendingActions(), action]);
}

export function clearPendingAction(id: string) {
  writePendingActions(readPendingActions().filter((action) => action.id !== id));
}

export function clearPendingActions() {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage failures; nothing to clear if storage is unavailable.
  }
}
