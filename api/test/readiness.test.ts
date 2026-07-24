import { describe, expect, it } from "vitest";
import app from "../src/index";
import { buildReadinessReport } from "../src/lib/readiness";

const bucket = { put: async () => undefined, get: async () => null };
const passingDatabaseProbe = async () => undefined;
const fakeLimiter = {} as DurableObjectNamespace;

function productionEnv() {
  return {
    APP_ENV: "production" as const,
    NEON_DATABASE_URL: "postgresql://db.example/northline",
    FIREBASE_PROJECT_ID: "northline-prod",
    CORS_ORIGIN: "https://ops.northline.example",
    OBSERVABILITY_WEBHOOK_URL: "https://telemetry.example/events",
    OBSERVABILITY_WEBHOOK_TOKEN: "collector_secret",
    SIGNING_SECRET: "test_signing_secret_32_chars_minimum",
    RATE_LIMITER: fakeLimiter,
    R2_BUCKET: bucket
  };
}

describe("readiness checks", () => {
  it("keeps development readiness focused on required local bindings", async () => {
    const response = await app.request("/ready", {}, { APP_ENV: "development", NEON_DATABASE_URL: "postgresql://localhost:5432/northline", R2_BUCKET: bucket });
    expect(response.status).toBe(200);
  });

  it("fails production readiness when Firebase configuration is missing", async () => {
    const { FIREBASE_PROJECT_ID: _, ...env } = productionEnv();
    const report = await buildReadinessReport(env, { pingDatabase: passingDatabaseProbe });
    expect(report.ok).toBe(false);
    expect(report.checks.filter((check) => check.required && !check.ok).map((check) => check.name)).toContain("firebase_project_id");
  });

  it("requires Firebase project configuration instead of an uploaded JWT public key", async () => {
    const report = await buildReadinessReport(productionEnv(), { pingDatabase: passingDatabaseProbe });
    expect(report.ok).toBe(true);
    expect(report.checks.find((check) => check.name === "firebase_google_only")).toMatchObject({ ok: true, required: true });
    expect(report.checks.find((check) => check.name === "auth_login_url")).toMatchObject({ ok: true, required: false });
  });

  it("still rejects malformed production URLs", async () => {
    const report = await buildReadinessReport({ ...productionEnv(), CORS_ORIGIN: "https://ops.northline.example/app", OBSERVABILITY_WEBHOOK_URL: "http://telemetry.example/events" }, { pingDatabase: passingDatabaseProbe });
    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.name === "cors_origin")?.ok).toBe(false);
    expect(report.checks.find((check) => check.name === "observability_webhook")?.ok).toBe(false);
  });
});
