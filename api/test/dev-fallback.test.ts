import { describe, expect, it } from "vitest";
import app from "../src/index";
import { canUseDevelopmentDataFallback, shouldUseDevelopmentDataFallback } from "../src/lib/dev-fallback";

const bucket = {
  put: async () => undefined,
  get: async () => null
};

describe("development data fallback", () => {
  it("keeps read-only local demos usable when the development database is unavailable", async () => {
    const response = await app.request(
      "/v1/ops/trips",
      {
        headers: {
          Authorization: "Bearer demoTenant:portal_admin:ORG_ADMIN"
        }
      },
      {
        APP_ENV: "development",
        NEON_DATABASE_URL: "postgresql://127.0.0.1:1/northline",
        R2_BUCKET: bucket
      }
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { trips: unknown[]; source?: string };

    expect(body.source).toBe("development_fallback");
    expect(body.trips).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          trip_id: "trip_demo_001",
          tenant_id: "demoTenant",
          status: "ACTIVE"
        })
      ])
    );
  });

  it("keeps local trip timelines available for the portal chart", async () => {
    const response = await app.request(
      "/v1/ops/trip/trip_demo_001/timeline?limit=100",
      {
        headers: {
          Authorization: "Bearer demoTenant:portal_admin:ORG_ADMIN"
        }
      },
      {
        APP_ENV: "development",
        NEON_DATABASE_URL: "postgresql://127.0.0.1:1/northline",
        R2_BUCKET: bucket
      }
    );

    const body = await response.json() as { count: number; source?: string; timeline: Array<{ event_type: string }> };

    expect(response.status).toBe(200);
    expect(body.source).toBe("development_fallback");
    expect(body.count).toBeGreaterThan(0);
    expect(body.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: "TRIP_STARTED" }),
        expect.objectContaining({ event_type: "COMPLIANCE_VALIDATION_RAN" })
      ])
    );
  });

  it("never enables the fallback outside development or for remote database URLs", () => {
    const error = new Error("connect ECONNREFUSED");

    expect(
      shouldUseDevelopmentDataFallback(
        { APP_ENV: "production", NEON_DATABASE_URL: "postgresql://127.0.0.1:1/northline", R2_BUCKET: bucket },
        error
      )
    ).toBe(false);
    expect(
      shouldUseDevelopmentDataFallback(
        { APP_ENV: "development", NEON_DATABASE_URL: "postgresql://db.example.com/northline", R2_BUCKET: bucket },
        error
      )
    ).toBe(false);
  });

  it("can identify local development fallback before attempting a dead local database", () => {
    expect(
      canUseDevelopmentDataFallback({
        APP_ENV: "development",
        NEON_DATABASE_URL: "postgresql://localhost:5432/northline",
        R2_BUCKET: bucket
      })
    ).toBe(true);
    expect(
      canUseDevelopmentDataFallback({
        APP_ENV: "staging",
        NEON_DATABASE_URL: "postgresql://localhost:5432/northline",
        R2_BUCKET: bucket
      })
    ).toBe(false);
    expect(
      canUseDevelopmentDataFallback({
        APP_ENV: "development",
        NEON_DATABASE_URL: "postgresql://db.example.com/northline",
        R2_BUCKET: bucket
      })
    ).toBe(false);
  });
});
