import { bytesToBase64, generateDeviceKeyPair, signWithPrivateKey } from "@northline/shared";

const DEVICE_ID_KEY = "northline.mobile_ops.device_id";
const PRIVATE_KEY_KEY = "northline.mobile_ops.device_private_key";
const PUBLIC_KEY_KEY = "northline.mobile_ops.device_public_key";
const KEY_STORAGE_KEY = "northline.mobile_ops.device_key_storage";
const secureDbName = "northline-mobile-ops-keys";
const secureStoreName = "device_keys";
const securePrivateKeyId = "active_private_key";

export interface DeviceIdentitySummary {
  deviceId: string | null;
  publicKey: string | null;
  hasPrivateKey: boolean;
}

export function readDeviceIdentity(): DeviceIdentitySummary {
  return {
    deviceId: localStorage.getItem(DEVICE_ID_KEY),
    publicKey: localStorage.getItem(PUBLIC_KEY_KEY),
    hasPrivateKey: Boolean(localStorage.getItem(PRIVATE_KEY_KEY) || localStorage.getItem(KEY_STORAGE_KEY) === "indexeddb")
  };
}

export async function generateAndStoreDeviceIdentity(actorId: string): Promise<DeviceIdentitySummary> {
  const keyPair = await generateDeviceKeyPair();
  const deviceId = `mobile_${actorId}_${crypto.randomUUID().slice(0, 8)}`;
  localStorage.setItem(DEVICE_ID_KEY, deviceId);
  localStorage.setItem(PUBLIC_KEY_KEY, keyPair.publicKey);
  localStorage.removeItem(PRIVATE_KEY_KEY);

  const secureStored = await storeSecurePrivateKey(keyPair.privateKey);
  if (secureStored) {
    localStorage.setItem(KEY_STORAGE_KEY, "indexeddb");
  } else {
    localStorage.setItem(PRIVATE_KEY_KEY, keyPair.privateKey);
    localStorage.setItem(KEY_STORAGE_KEY, "localStorage");
  }

  return { deviceId, publicKey: keyPair.publicKey, hasPrivateKey: true };
}

export function clearDeviceIdentity() {
  localStorage.removeItem(DEVICE_ID_KEY);
  localStorage.removeItem(PRIVATE_KEY_KEY);
  localStorage.removeItem(PUBLIC_KEY_KEY);
  localStorage.removeItem(KEY_STORAGE_KEY);
  void deleteSecurePrivateKey();
}

export async function signDraftEventHash(eventHash: string): Promise<{ deviceId: string; signature: string } | null> {
  const deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) return null;

  const secureKey = await readSecurePrivateKey();
  if (secureKey) {
    const messageBytes = new TextEncoder().encode(eventHash);
    const signatureBytes = await crypto.subtle.sign("Ed25519", secureKey, messageBytes.buffer as ArrayBuffer);
    return {
      deviceId,
      signature: bytesToBase64(new Uint8Array(signatureBytes))
    };
  }

  const privateKey = localStorage.getItem(PRIVATE_KEY_KEY);
  if (!privateKey) return null;

  return {
    deviceId,
    signature: await signWithPrivateKey(eventHash, privateKey)
  };
}

function base64ToBytes(base64: string): Uint8Array {
  const standardBase64 = base64.replace(/-/g, "+").replace(/_/g, "/");
  const padded = standardBase64.padEnd(Math.ceil(standardBase64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function openKeyDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);

  return new Promise((resolve) => {
    const request = indexedDB.open(secureDbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(secureStoreName)) {
        db.createObjectStore(secureStoreName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function withKeyStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | null> {
  const db = await openKeyDb();
  if (!db) return null;

  return new Promise((resolve) => {
    const transaction = db.transaction(secureStoreName, mode);
    const store = transaction.objectStore(secureStoreName);
    const request = action(store);

    transaction.oncomplete = () => {
      db.close();
      resolve(request && "result" in request ? request.result : null);
    };
    transaction.onerror = () => {
      db.close();
      resolve(null);
    };
  });
}

async function storeSecurePrivateKey(privateKeyBase64: string): Promise<boolean> {
  try {
    const privateKeyData = base64ToBytes(privateKeyBase64);
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      privateKeyData.buffer as ArrayBuffer,
      { name: "Ed25519" },
      false,
      ["sign"]
    );

    await withKeyStore("readwrite", (store) => store.put(privateKey, securePrivateKeyId));
    return Boolean(await readSecurePrivateKey());
  } catch {
    return false;
  }
}

async function readSecurePrivateKey(): Promise<CryptoKey | null> {
  const value = await withKeyStore<CryptoKey>("readonly", (store) => store.get(securePrivateKeyId));
  return value instanceof CryptoKey ? value : null;
}

async function deleteSecurePrivateKey() {
  await withKeyStore("readwrite", (store) => store.delete(securePrivateKeyId));
}
