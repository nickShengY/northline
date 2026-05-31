import { describe, expect, it } from "vitest";
import app from "../src/index";
import { countProjectionErrors, summarizeProjectionBatchResults } from "../src/routes/projection";

const env = {
  APP_ENV: "development" as const,
  R2_BUCKET: {
    put: async () => undefined,
    get: async () => null
  }
};

describe("projection admin routes", () => {
  it("counts nested projection rebuild errors for accurate batch outcomes", () => {
    expect(countProjectionErrors({
      trip_state: { errors: [] },
      gear_state: { errors: [{ id: "evt_1", error: "bad gear" }] },
      catch_rollups: { errors: [{ id: "evt_2", error: "bad catch" }] }
    })).toBe(2);

    expect(summarizeProjectionBatchResults({
      trip_1: { trip_state: { errors: [] } },
      trip_2: { catch_rollups: { errors: [{ id: "evt_2", error: "failed" }] } },
      trip_3: { ok: false, error: "rebuild_failed" }
    })).toEqual({
      total_count: 3,
      succeeded_count: 1,
      failed_count: 2
    });
  });

  it("returns a validation error for malformed rebuild JSON", async () => {
    const response = await app.request(
      "/v1/projection/rebuild",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer demoTenant:captain_1:CAPTAIN",
          "Content-Type": "application/json"
        },
        body: "{"
      },
      env
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_payload",
      message: "request body must be valid JSON"
    });
  });

  it("rejects oversized projection rebuild batches before database work", async () => {
    const response = await app.request(
      "/v1/projection/rebuild/batch",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer demoTenant:captain_1:CAPTAIN",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          trip_ids: Array.from({ length: 51 }, (_, index) => `trip_${index}`)
        })
      },
      env
    );

    expect(response.status).toBe(400);
    const body = await response.json() as { details?: { fieldErrors?: Record<string, string[]> } };
    expect(body.details?.fieldErrors?.trip_ids?.[0]).toContain("at most 50");
  });
});
