import { describe, expect, it } from "vitest";
import app from "../src/index";
import { buildReadinessReport } from "../src/lib/readiness";

const bucket = {
  put: async () => undefined,
  get: async () => null
};

const passingDatabaseProbe = async () => undefined;

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function validRsaPublicKeyPem() {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["sign", "verify"]
  );
  const spki = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const base64 = bytesToBase64(new Uint8Array(spki)).match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN PUBLIC KEY-----\n${base64}\n-----END PUBLIC KEY-----`;
}

describe("readiness checks", () => {
  it("keeps development readiness focused on required local bindings", async () => {
    const response = await app.request(
      "/ready",
      {},
      {
        APP_ENV: "development",
        NEON_DATABASE_URL: "postgresql://localhost:5432/northline",
        R2_BUCKET: bucket
      }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, env: "development" });
  });

  it("fails production readiness when auth and CORS controls are missing", async () => {
    const report = await buildReadinessReport(
      {
        APP_ENV: "production",
        NEON_DATABASE_URL: "postgresql://db.example/northline",
        R2_BUCKET: bucket
      },
      { pingDatabase: passingDatabaseProbe }
    );

    expect(report.ok).toBe(false);
    expect(report.checks.filter((check) => check.required && !check.ok).map((check) => check.name)).toEqual([
      "jwt_public_key",
      "cors_origin",
      "issuer_audience",
      "auth_login_url",
      "durable_rate_limiter",
      "observability_webhook",
      "signing_secret"
    ]);
  });

  it("fails production readiness when JWT public key cannot be imported", async () => {
    const fakeLimiter = {} as DurableObjectNamespace;
    const report = await buildReadinessReport(
      {
        APP_ENV: "production",
        NEON_DATABASE_URL: "postgresql://db.example/northline",
        JWT_PUBLIC_KEY: "not-a-public-key",
        JWT_ISSUER: "https://identity.example",
        JWT_AUDIENCE: "northline-api",
        CORS_ORIGIN: "https://ops.northline.example",
        OBSERVABILITY_WEBHOOK_URL: "https://telemetry.example/events",
        OBSERVABILITY_WEBHOOK_TOKEN: "collector_secret",
        SIGNING_SECRET: "test_signing_secret_32_chars_minimum",
        RATE_LIMITER: fakeLimiter,
        R2_BUCKET: bucket
      },
      { pingDatabase: passingDatabaseProbe }
    );

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.name === "jwt_public_key")).toMatchObject({
      ok: false,
      message: "JWT_PUBLIC_KEY must be a valid RS256 public key"
    });
  });

  it("fails production readiness when URL-shaped controls are malformed", async () => {
    const fakeLimiter = {} as DurableObjectNamespace;
    const report = await buildReadinessReport(
      {
        APP_ENV: "production",
        NEON_DATABASE_URL: "https://db.example/not-postgres",
        JWT_PUBLIC_KEY: await validRsaPublicKeyPem(),
        JWT_ISSUER: "identity.example",
        JWT_AUDIENCE: "northline-api",
        AUTH_LOGIN_URL: "http://identity.example/authorize",
        CORS_ORIGIN: "https://ops.northline.example/app",
        OBSERVABILITY_WEBHOOK_URL: "http://telemetry.example/events",
        SIGNING_SECRET: "short",
        RATE_LIMITER: fakeLimiter,
        R2_BUCKET: bucket
      },
      { pingDatabase: passingDatabaseProbe }
    );

    expect(report.ok).toBe(false);
    expect(Object.fromEntries(report.checks.map((check) => [check.name, check]))).toMatchObject({
      database_url: {
        ok: false,
        message: "NEON_DATABASE_URL must be a valid postgres connection URL"
      },
      cors_origin: {
        ok: false,
        message: "CORS_ORIGIN must contain comma-separated HTTP(S) origins without paths"
      },
      issuer_audience: {
        ok: false,
        message: "JWT_ISSUER must be a valid HTTPS URL"
      },
      auth_login_url: {
        ok: false,
        message: "AUTH_LOGIN_URL must be a valid HTTPS URL"
      },
      observability_webhook: {
        ok: false,
        message: "OBSERVABILITY_WEBHOOK_URL must be a valid HTTPS URL"
      },
      signing_secret: {
        ok: false,
        message: "SIGNING_SECRET must be at least 32 characters outside development"
      }
    });
  });

  it("fails production readiness when observability webhook authentication is missing", async () => {
    const fakeLimiter = {} as DurableObjectNamespace;
    const report = await buildReadinessReport(
      {
        APP_ENV: "production",
        NEON_DATABASE_URL: "postgresql://db.example/northline",
        JWT_PUBLIC_KEY: await validRsaPublicKeyPem(),
        JWT_ISSUER: "https://identity.example",
        JWT_AUDIENCE: "northline-api",
        CORS_ORIGIN: "https://ops.northline.example",
        OBSERVABILITY_WEBHOOK_URL: "https://telemetry.example/events",
        SIGNING_SECRET: "test_signing_secret_32_chars_minimum",
        RATE_LIMITER: fakeLimiter,
        R2_BUCKET: bucket
      },
      { pingDatabase: passingDatabaseProbe }
    );

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.name === "observability_webhook")).toMatchObject({
      ok: false,
      message: "OBSERVABILITY_WEBHOOK_TOKEN is required outside development"
    });
  });

  it("fails the optional live database probe when the database URL is invalid", async () => {
    const report = await buildReadinessReport({
      APP_ENV: "development",
      NEON_DATABASE_URL: "https://db.example/not-postgres",
      READINESS_CHECK_DATABASE: "true",
      R2_BUCKET: bucket
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.name === "database_reachable")).toMatchObject({
      ok: false,
      required: true,
      message: "live database probe requires a valid NEON_DATABASE_URL"
    });
  });

  it("requires a live database probe outside development", async () => {
    const fakeLimiter = {} as DurableObjectNamespace;
    const report = await buildReadinessReport(
      {
        APP_ENV: "production",
        NEON_DATABASE_URL: "postgresql://db.example/northline",
        JWT_PUBLIC_KEY: await validRsaPublicKeyPem(),
        JWT_ISSUER: "https://identity.example",
        JWT_AUDIENCE: "northline-api",
        AUTH_LOGIN_URL: "https://identity.example/authorize",
        CORS_ORIGIN: "https://ops.northline.example",
        OBSERVABILITY_WEBHOOK_URL: "https://telemetry.example/events",
        OBSERVABILITY_WEBHOOK_TOKEN: "collector_secret",
        SIGNING_SECRET: "test_signing_secret_32_chars_minimum",
        RATE_LIMITER: fakeLimiter,
        R2_BUCKET: bucket
      },
      {
        pingDatabase: async () => {
          throw new Error("connection refused");
        }
      }
    );

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.name === "database_reachable")).toMatchObject({
      ok: false,
      required: true,
      message: "database connection failed: connection refused"
    });
  });

  it("passes production readiness when required deployment controls are present", async () => {
    const fakeLimiter = {} as DurableObjectNamespace;
    const report = await buildReadinessReport(
      {
        APP_ENV: "production",
        NEON_DATABASE_URL: "postgresql://db.example/northline",
        JWT_PUBLIC_KEY: await validRsaPublicKeyPem(),
        JWT_ISSUER: "https://identity.example",
        JWT_AUDIENCE: "northline-api",
        AUTH_LOGIN_URL: "https://identity.example/authorize",
        CORS_ORIGIN: "https://ops.northline.example",
        OBSERVABILITY_WEBHOOK_URL: "https://telemetry.example/events",
        OBSERVABILITY_WEBHOOK_TOKEN: "collector_secret",
        SIGNING_SECRET: "test_signing_secret_32_chars_minimum",
        RATE_LIMITER: fakeLimiter,
        R2_BUCKET: bucket
      },
      { pingDatabase: passingDatabaseProbe }
    );

    expect(report.ok).toBe(true);
  });
});
