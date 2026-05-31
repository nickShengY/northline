import {
  hasDeviceChainRejection,
  syncRejectedReasonCodes,
  type OpsEvent,
  type UploadEventsResponse
} from "@northline/shared";

export type DraftEvent = OpsEvent<Record<string, unknown>>;

export interface LegacyDraftEvent {
  event_id: string;
  event_type: string;
  ts_device: string;
  payload_json: Record<string, unknown>;
}

const legacyKey = "northline.mobile_ops.draft_events";
const serverEventsLegacyKey = "northline.mobile_ops.server_events";
const chainHeadKey = "northline.mobile_ops.device_chain_heads";
const syncCursorKey = "northline.mobile_ops.sync_cursors";
const dbName = "northline-mobile-ops";
const draftStoreName = "draft_events";
const serverEventStoreName = "server_events";
const dbVersion = 2;
const maxCachedServerEvents = 1000;
export const maxSyncUploadBatchSize = 250;

function isDraftEvent(event: unknown): event is DraftEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "event_id" in event &&
    "tenant_id" in event &&
    "subject_type" in event &&
    "subject_id" in event &&
    "actor_id" in event &&
    "device_id" in event &&
    "schema_version" in event &&
    "event_hash" in event &&
    "signature" in event
  );
}

function readLegacyDraftEvents(): DraftEvent[] {
  try {
    const raw = localStorage.getItem(legacyKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<DraftEvent | LegacyDraftEvent>;
    return parsed.filter(isDraftEvent);
  } catch {
    return [];
  }
}

function readLegacyServerEvents(): OpsEvent[] {
  try {
    const raw = localStorage.getItem(serverEventsLegacyKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OpsEvent[];
    return parsed.filter(isDraftEvent);
  } catch {
    return [];
  }
}

function readChainHeads(): Record<string, string> {
  try {
    const raw = localStorage.getItem(chainHeadKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    );
  } catch {
    return {};
  }
}

function writeChainHeads(heads: Record<string, string>) {
  localStorage.setItem(chainHeadKey, JSON.stringify(heads));
}

function readSyncCursors(): Record<string, string> {
  try {
    const raw = localStorage.getItem(syncCursorKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    );
  } catch {
    return {};
  }
}

function writeSyncCursors(cursors: Record<string, string>) {
  localStorage.setItem(syncCursorKey, JSON.stringify(cursors));
}

function openDraftDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);

  return new Promise((resolve) => {
    const request = indexedDB.open(dbName, dbVersion);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(draftStoreName)) {
        db.createObjectStore(draftStoreName, { keyPath: "event_id" });
      }
      if (!db.objectStoreNames.contains(serverEventStoreName)) {
        db.createObjectStore(serverEventStoreName, { keyPath: "event_id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T> | void,
  targetStoreName = draftStoreName
): Promise<{ ok: true; result?: T } | { ok: false }> {
  const db = await openDraftDb();
  if (!db) return { ok: false };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(targetStoreName, mode);
    const store = transaction.objectStore(targetStoreName);
    const request = action(store);

    transaction.oncomplete = () => {
      db.close();
      resolve({ ok: true, result: request && "result" in request ? request.result : undefined });
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Offline queue transaction failed"));
    };
  });
}

export async function readDraftEvents(): Promise<DraftEvent[]> {
  const rows = await withStore<DraftEvent[]>("readonly", (store) => store.getAll());
  if (rows.ok) {
    const current = (rows.result ?? []).filter(isDraftEvent);
    if (current.length) return current;

    const legacy = readLegacyDraftEvents();
    if (legacy.length) {
      await withStore("readwrite", (store) => {
        for (const event of legacy) {
          store.put(event);
        }
      });
      localStorage.removeItem(legacyKey);
      return legacy;
    }

    return [];
  }

  return readLegacyDraftEvents();
}

export async function latestQueuedHashForDevice(deviceId: string): Promise<string | null> {
  const drafts = await readDraftEvents();
  const latest = drafts
    .filter((event) => event.device_id === deviceId)
    .sort((left, right) => left.ts_device.localeCompare(right.ts_device))
    .at(-1);
  return latest?.event_hash ?? readChainHeads()[deviceId] ?? null;
}

export function readDeviceChainHead(deviceId: string): string | null {
  return readChainHeads()[deviceId] ?? null;
}

export function readSyncCursor(scope = "default"): string | null {
  return readSyncCursors()[scope] ?? null;
}

export function writeSyncCursor(cursor: string, scope = "default") {
  const cursors = readSyncCursors();
  cursors[scope] = cursor;
  writeSyncCursors(cursors);
}

export function clearSyncCursor(scope = "default") {
  const cursors = readSyncCursors();
  delete cursors[scope];
  writeSyncCursors(cursors);
}

export function updateDeviceChainHeadsFromAccepted(drafts: DraftEvent[], acceptedEventIds: string[] = []) {
  if (!acceptedEventIds.length) return;

  const accepted = new Set(acceptedEventIds);
  const heads = readChainHeads();
  for (const event of drafts) {
    if (accepted.has(event.event_id)) {
      heads[event.device_id] = event.event_hash;
    }
  }
  writeChainHeads(heads);
}

export async function appendDraftEvent(event: DraftEvent) {
  const stored = await withStore("readwrite", (store) => store.put(event));
  if (stored.ok) {
    localStorage.removeItem(legacyKey);
    return;
  }

  const next = [...readLegacyDraftEvents(), event];
  localStorage.setItem(legacyKey, JSON.stringify(next));
}

export async function removeDraftEvent(eventId: string) {
  const stored = await withStore("readwrite", (store) => store.delete(eventId));
  if (stored.ok) return;

  const next = readLegacyDraftEvents().filter((event) => event.event_id !== eventId);
  localStorage.setItem(legacyKey, JSON.stringify(next));
}

export async function replaceDraftEvents(events: DraftEvent[]) {
  const stored = await withStore("readwrite", (store) => {
    store.clear();
    for (const event of events) {
      store.put(event);
    }
  });
  if (stored.ok) {
    localStorage.removeItem(legacyKey);
    return;
  }

  localStorage.setItem(legacyKey, JSON.stringify(events));
}

export async function clearDraftEvents() {
  const stored = await withStore("readwrite", (store) => store.clear());
  if (stored.ok) {
    localStorage.removeItem(legacyKey);
    return;
  }

  localStorage.removeItem(legacyKey);
}

export async function readCachedServerEvents(): Promise<OpsEvent[]> {
  const rows = await withStore<OpsEvent[]>("readonly", (store) => store.getAll(), serverEventStoreName);
  if (rows.ok) {
    const current = (rows.result ?? []).filter(isDraftEvent);
    if (current.length) return current;

    const legacy = readLegacyServerEvents();
    if (legacy.length) {
      await withStore("readwrite", (store) => {
        for (const event of legacy) {
          store.put(event);
        }
      }, serverEventStoreName);
      localStorage.removeItem(serverEventsLegacyKey);
      return legacy;
    }

    return [];
  }

  return readLegacyServerEvents();
}

export async function appendCachedServerEvents(events: OpsEvent[]) {
  if (!events.length) return;

  const stored = await withStore("readwrite", (store) => {
    for (const event of events) {
      store.put(event);
    }
  }, serverEventStoreName);

  if (stored.ok) {
    localStorage.removeItem(serverEventsLegacyKey);
    const cached = (await readCachedServerEvents())
      .sort((left, right) => {
        const leftTime = left.ts_server ?? left.ts_device;
        const rightTime = right.ts_server ?? right.ts_device;
        return leftTime.localeCompare(rightTime) || left.event_id.localeCompare(right.event_id);
      });
    const excess = cached.length - maxCachedServerEvents;
    if (excess > 0) {
      const pruneIds = cached.slice(0, excess).map((event) => event.event_id);
      await withStore("readwrite", (store) => {
        for (const eventId of pruneIds) {
          store.delete(eventId);
        }
      }, serverEventStoreName);
    }
    return;
  }

  const merged = new Map(readLegacyServerEvents().map((event) => [event.event_id, event]));
  for (const event of events) {
    if (isDraftEvent(event)) merged.set(event.event_id, event);
  }
  const next = [...merged.values()]
    .sort((left, right) => {
      const leftTime = left.ts_server ?? left.ts_device;
      const rightTime = right.ts_server ?? right.ts_device;
      return leftTime.localeCompare(rightTime) || left.event_id.localeCompare(right.event_id);
    })
    .slice(-maxCachedServerEvents);
  localStorage.setItem(serverEventsLegacyKey, JSON.stringify(next));
}

export function remainingDraftEventsAfterUpload(drafts: DraftEvent[], response: UploadEventsResponse) {
  const acceptedSet = new Set(response.accepted ?? []);
  return drafts.filter((event) => !acceptedSet.has(event.event_id));
}

export function nextSyncUploadBatch(drafts: DraftEvent[]) {
  return drafts.slice(0, maxSyncUploadBatchSize);
}

export function remainingDraftEventsAfterBatchedUpload(drafts: DraftEvent[], response: UploadEventsResponse) {
  const batch = nextSyncUploadBatch(drafts);
  const unsent = drafts.slice(maxSyncUploadBatchSize);
  return [...remainingDraftEventsAfterUpload(batch, response), ...unsent];
}

export function rejectedReasonCodes(response: UploadEventsResponse): string[] {
  return syncRejectedReasonCodes(response);
}

export { hasDeviceChainRejection };
