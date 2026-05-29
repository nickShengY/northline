/**
 * Offline Persistence Layer
 *
 * IndexedDB-based storage for offline-first operation.
 * Provides durable local storage for events, state snapshots, and sync cursors.
 */

import type { OpsEvent } from "../models/core";

const DB_NAME = "northline_offline";
const DB_VERSION = 1;

// Store names
const STORE_EVENTS = "pending_events";
const STORE_SNAPSHOTS = "state_snapshots";
const STORE_CURSORS = "sync_cursors";
const STORE_DRAFTS = "draft_events";
const STORE_STL_QUEUE = "stl_queue";

export interface PendingEvent {
  event_id: string;
  event: OpsEvent;
  created_at: string;
  retry_count: number;
  last_error?: string;
}

export interface StateSnapshot {
  snapshot_id: string;
  tenant_id: string;
  trip_id?: string;
  snapshot_type: "full" | "incremental";
  data: Record<string, unknown>;
  event_count: number;
  created_at: string;
}

export interface SyncCursor {
  cursor_id: string;
  tenant_id: string;
  subject_type: string;
  subject_id: string;
  cursor: string;
  updated_at: string;
}

export interface DraftEvent {
  draft_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface STLPacket {
  packet_id: string;
  priority: "CRITICAL" | "HIGH" | "NORMAL" | "LOW" | "BATCH";
  preview: Record<string, unknown>;
  full_payload?: Record<string, unknown>;
  created_at: string;
}

let dbInstance: IDBDatabase | null = null;

/**
 * Initialize the offline database
 */
export async function initOfflineDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Pending events store - events waiting to be synced
      if (!db.objectStoreNames.contains(STORE_EVENTS)) {
        const eventStore = db.createObjectStore(STORE_EVENTS, { keyPath: "event_id" });
        eventStore.createIndex("created_at", "created_at");
        eventStore.createIndex("retry_count", "retry_count");
      }

      // State snapshots store - for fast local state reconstruction
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        const snapshotStore = db.createObjectStore(STORE_SNAPSHOTS, { keyPath: "snapshot_id" });
        snapshotStore.createIndex("tenant_id", "tenant_id");
        snapshotStore.createIndex("trip_id", "trip_id");
        snapshotStore.createIndex("created_at", "created_at");
      }

      // Sync cursors store - track sync progress per subject
      if (!db.objectStoreNames.contains(STORE_CURSORS)) {
        const cursorStore = db.createObjectStore(STORE_CURSORS, { keyPath: "cursor_id" });
        cursorStore.createIndex("tenant_subject", ["tenant_id", "subject_type", "subject_id"]);
      }

      // Draft events store - work-in-progress events
      if (!db.objectStoreNames.contains(STORE_DRAFTS)) {
        const draftStore = db.createObjectStore(STORE_DRAFTS, { keyPath: "draft_id" });
        draftStore.createIndex("created_at", "created_at");
      }

      // STL packet queue - for semantic transport layer
      if (!db.objectStoreNames.contains(STORE_STL_QUEUE)) {
        const stlStore = db.createObjectStore(STORE_STL_QUEUE, { keyPath: "packet_id" });
        stlStore.createIndex("priority", "priority");
        stlStore.createIndex("created_at", "created_at");
      }
    };
  });
}

/**
 * Get a transaction and store
 */
async function getStore(storeName: string, mode: IDBTransactionMode = "readonly"): Promise<IDBObjectStore> {
  const db = await initOfflineDB();
  const transaction = db.transaction(storeName, mode);
  return transaction.objectStore(storeName);
}

// ============================================
// Pending Events Operations
// ============================================

/**
 * Add an event to the pending queue
 */
export async function queuePendingEvent(event: OpsEvent): Promise<void> {
  const store = await getStore(STORE_EVENTS, "readwrite");

  const pendingEvent: PendingEvent = {
    event_id: event.event_id,
    event,
    created_at: new Date().toISOString(),
    retry_count: 0
  };

  return new Promise((resolve, reject) => {
    const request = store.put(pendingEvent);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all pending events
 */
export async function getPendingEvents(): Promise<PendingEvent[]> {
  const store = await getStore(STORE_EVENTS);

  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result as PendingEvent[]);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Remove a pending event after successful sync
 */
export async function removePendingEvent(eventId: string): Promise<void> {
  const store = await getStore(STORE_EVENTS, "readwrite");

  return new Promise((resolve, reject) => {
    const request = store.delete(eventId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Update retry count and error for a pending event
 */
export async function updatePendingEventRetry(
  eventId: string,
  retryCount: number,
  error?: string
): Promise<void> {
  const store = await getStore(STORE_EVENTS, "readwrite");

  const pending = await new Promise<PendingEvent | undefined>((resolve, reject) => {
    const request = store.get(eventId);
    request.onsuccess = () => resolve(request.result as PendingEvent | undefined);
    request.onerror = () => reject(request.error);
  });

  if (pending) {
    pending.retry_count = retryCount;
    pending.last_error = error;

    return new Promise((resolve, reject) => {
      const request = store.put(pending);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

/**
 * Get count of pending events
 */
export async function getPendingEventCount(): Promise<number> {
  const store = await getStore(STORE_EVENTS);

  return new Promise((resolve, reject) => {
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ============================================
// State Snapshots Operations
// ============================================

/**
 * Save a state snapshot for fast local reconstruction
 */
export async function saveSnapshot(snapshot: StateSnapshot): Promise<void> {
  const store = await getStore(STORE_SNAPSHOTS, "readwrite");

  return new Promise((resolve, reject) => {
    const request = store.put(snapshot);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get the latest snapshot for a tenant/trip
 */
export async function getLatestSnapshot(
  tenantId: string,
  tripId?: string
): Promise<StateSnapshot | undefined> {
  const store = await getStore(STORE_SNAPSHOTS);
  const index = store.index("tenant_id");

  return new Promise((resolve, reject) => {
    const request = index.openCursor(IDBKeyRange.only(tenantId), "prev");

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const snapshot = cursor.value as StateSnapshot;
        if (!tripId || snapshot.trip_id === tripId) {
          resolve(snapshot);
          return;
        }
        cursor.continue();
      } else {
        resolve(undefined);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

// ============================================
// Sync Cursors Operations
// ============================================

/**
 * Save a sync cursor
 */
export async function saveSyncCursor(
  tenantId: string,
  subjectType: string,
  subjectId: string,
  cursor: string
): Promise<void> {
  const store = await getStore(STORE_CURSORS, "readwrite");

  const cursorId = `${tenantId}:${subjectType}:${subjectId}`;
  const syncCursor: SyncCursor = {
    cursor_id: cursorId,
    tenant_id: tenantId,
    subject_type: subjectType,
    subject_id: subjectId,
    cursor,
    updated_at: new Date().toISOString()
  };

  return new Promise((resolve, reject) => {
    const request = store.put(syncCursor);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get a sync cursor
 */
export async function getSyncCursor(
  tenantId: string,
  subjectType: string,
  subjectId: string
): Promise<string | undefined> {
  const store = await getStore(STORE_CURSORS);
  const cursorId = `${tenantId}:${subjectType}:${subjectId}`;

  return new Promise((resolve, reject) => {
    const request = store.get(cursorId);
    request.onsuccess = () => {
      const result = request.result as SyncCursor | undefined;
      resolve(result?.cursor);
    };
    request.onerror = () => reject(request.error);
  });
}

// ============================================
// Draft Events Operations
// ============================================

/**
 * Save a draft event (work in progress)
 */
export async function saveDraftEvent(draft: DraftEvent): Promise<void> {
  const store = await getStore(STORE_DRAFTS, "readwrite");
  draft.updated_at = new Date().toISOString();

  return new Promise((resolve, reject) => {
    const request = store.put(draft);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all draft events
 */
export async function getDraftEvents(): Promise<DraftEvent[]> {
  const store = await getStore(STORE_DRAFTS);

  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result as DraftEvent[]);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete a draft event
 */
export async function deleteDraftEvent(draftId: string): Promise<void> {
  const store = await getStore(STORE_DRAFTS, "readwrite");

  return new Promise((resolve, reject) => {
    const request = store.delete(draftId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ============================================
// STL Queue Operations
// ============================================

/**
 * Add an STL packet to the local queue
 */
export async function queueSTLPacket(packet: STLPacket): Promise<void> {
  const store = await getStore(STORE_STL_QUEUE, "readwrite");

  return new Promise((resolve, reject) => {
    const request = store.put(packet);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get STL packets by priority
 */
export async function getSTLPacketsByPriority(): Promise<STLPacket[]> {
  const store = await getStore(STORE_STL_QUEUE);
  const index = store.index("priority");

  const priorityOrder = ["CRITICAL", "HIGH", "NORMAL", "LOW", "BATCH"];
  const packets: STLPacket[] = [];

  for (const priority of priorityOrder) {
    const priorityPackets = await new Promise<STLPacket[]>((resolve, reject) => {
      const request = index.getAll(IDBKeyRange.only(priority));
      request.onsuccess = () => resolve(request.result as STLPacket[]);
      request.onerror = () => reject(request.error);
    });
    packets.push(...priorityPackets);
  }

  return packets;
}

/**
 * Remove an STL packet after successful upload
 */
export async function removeSTLPacket(packetId: string): Promise<void> {
  const store = await getStore(STORE_STL_QUEUE, "readwrite");

  return new Promise((resolve, reject) => {
    const request = store.delete(packetId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ============================================
// Utility Operations
// ============================================

/**
 * Clear all offline data (useful for logout)
 */
export async function clearAllOfflineData(): Promise<void> {
  const db = await initOfflineDB();

  const storeNames = [STORE_EVENTS, STORE_SNAPSHOTS, STORE_CURSORS, STORE_DRAFTS, STORE_STL_QUEUE];

  const transaction = db.transaction(storeNames, "readwrite");

  const promises = storeNames.map(storeName => {
    return new Promise<void>((resolve, reject) => {
      const request = transaction.objectStore(storeName).clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  });

  await Promise.all(promises);
}

/**
 * Get storage usage statistics
 */
export async function getStorageStats(): Promise<{
  pendingEvents: number;
  snapshots: number;
  drafts: number;
  stlPackets: number;
}> {
  const [pendingEvents, snapshots, drafts, stlPackets] = await Promise.all([
    new Promise<number>((resolve, reject) => {
      getStore(STORE_EVENTS).then(store => {
        const request = store.count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }),
    new Promise<number>((resolve, reject) => {
      getStore(STORE_SNAPSHOTS).then(store => {
        const request = store.count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }),
    new Promise<number>((resolve, reject) => {
      getStore(STORE_DRAFTS).then(store => {
        const request = store.count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }),
    new Promise<number>((resolve, reject) => {
      getStore(STORE_STL_QUEUE).then(store => {
        const request = store.count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    })
  ]);

  return { pendingEvents, snapshots, drafts, stlPackets };
}
