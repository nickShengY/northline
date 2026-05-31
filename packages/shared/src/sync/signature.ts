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

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function generateDeviceKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKeyRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const privateKeyPkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);

  return {
    publicKey: bytesToBase64(new Uint8Array(publicKeyRaw)),
    privateKey: bytesToBase64(new Uint8Array(privateKeyPkcs8))
  };
}

export async function signWithPrivateKey(message: string, privateKeyBase64: string): Promise<string> {
  const privateKeyData = base64ToBytes(privateKeyBase64);
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyData.buffer as ArrayBuffer,
    { name: "Ed25519" },
    false,
    ["sign"]
  );
  const messageBytes = new TextEncoder().encode(message);
  const signatureBytes = await crypto.subtle.sign("Ed25519", privateKey, messageBytes.buffer as ArrayBuffer);
  return bytesToBase64(new Uint8Array(signatureBytes));
}

export async function verifyEd25519Signature(message: string, signature: string, publicKey: string): Promise<boolean> {
  try {
    const publicKeyData = base64ToBytes(publicKey);
    const publicKeyCrypto = await crypto.subtle.importKey(
      "raw",
      publicKeyData.buffer as ArrayBuffer,
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    const signatureBytes = base64ToBytes(signature);
    const messageBytes = new TextEncoder().encode(message);
    return await crypto.subtle.verify(
      "Ed25519",
      publicKeyCrypto,
      signatureBytes.buffer as ArrayBuffer,
      messageBytes.buffer as ArrayBuffer
    );
  } catch {
    return false;
  }
}
