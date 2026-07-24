import { describe, expect, it } from "vitest";
import { createLocalJWKSet, SignJWT } from "jose";
import app from "../src/index";
import { resolveFirebaseIdentity, verifyFirebaseToken } from "../src/lib/auth";

const bucket = { put: async () => undefined, get: async () => null };
const projectId = "northline-test";

async function firebaseFixture(options: { provider?: string; issuer?: string; audience?: string } = {}) {
  const keyPair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const kid = crypto.randomUUID();
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const token = await new SignJWT({ firebase: { sign_in_provider: options.provider ?? "google.com" } })
    .setProtectedHeader({ alg: "RS256", kid })
    .setSubject("firebase-user-1")
    .setIssuer(options.issuer ?? `https://securetoken.google.com/${projectId}`)
    .setAudience(options.audience ?? projectId)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(keyPair.privateKey);
  return { token, jwk: { ...publicJwk, kid, alg: "RS256", use: "sig" } };
}

describe("auth middleware", () => {
  it("accepts dev tokens only in development", async () => {
    const response = await app.request("/v1/__auth_probe", { headers: { Authorization: "Bearer demoTenant:portal_admin:ORG_ADMIN" } }, { APP_ENV: "development", R2_BUCKET: bucket });
    expect(response.status).not.toBe(401);
  });

  it("rejects development tokens outside development", async () => {
    const response = await app.request("/v1/__auth_probe", { headers: { Authorization: "Bearer demoTenant:attacker:ORG_ADMIN" } }, { APP_ENV: "production", R2_BUCKET: bucket });
    expect(response.status).toBe(401);
  });

  it("accepts a Google Firebase ID token and ignores privileged browser claims", async () => {
    const { token, jwk } = await firebaseFixture();
    const auth = await verifyFirebaseToken(
      token,
      { APP_ENV: "production", FIREBASE_PROJECT_ID: projectId, R2_BUCKET: bucket },
      createLocalJWKSet({ keys: [jwk] }),
      async () => ({ tenantId: "tenant_live", actorId: "firebase-user-1", role: "OWNER" })
    );
    expect(auth).toMatchObject({ tenantId: "tenant_live", actorId: "firebase-user-1", role: "OWNER" });
  });

  it("rejects Firebase tokens from a non-Google provider", async () => {
    const { token, jwk } = await firebaseFixture({ provider: "password" });
    await expect(verifyFirebaseToken(token, { APP_ENV: "production", FIREBASE_PROJECT_ID: projectId, R2_BUCKET: bucket }, createLocalJWKSet({ keys: [jwk] }))).resolves.toBeNull();
  });

  it("fails closed when Firebase project configuration is missing", async () => {
    const { token } = await firebaseFixture();
    const response = await app.request("/v1/auth/session", { headers: { Authorization: `Bearer ${token}` } }, { APP_ENV: "production", R2_BUCKET: bucket });
    expect(response.status).toBe(401);
  });

  it("fails closed for a Firebase user without a server-side membership", async () => {
    const auth = await resolveFirebaseIdentity(
      { APP_ENV: "production", FIREBASE_PROJECT_ID: projectId, R2_BUCKET: bucket },
      "firebase-user-1",
      async () => null
    );
    expect(auth).toBeNull();
  });

  it("allows only the configured deployment bootstrap identity to become the initial admin", async () => {
    const env = {
      APP_ENV: "production" as const,
      FIREBASE_PROJECT_ID: projectId,
      INITIAL_ORG_ADMIN_UID: "bootstrap-admin",
      INITIAL_ORG_ADMIN_TENANT_ID: "tenant_bootstrap",
      R2_BUCKET: bucket
    };
    await expect(resolveFirebaseIdentity(env, "bootstrap-admin", async () => null)).resolves.toEqual({ tenantId: "tenant_bootstrap", actorId: "bootstrap-admin", role: "ORG_ADMIN" });
    await expect(resolveFirebaseIdentity(env, "other-user", async () => null)).resolves.toBeNull();
  });
});
