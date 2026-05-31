import { describe, expect, it } from "vitest";
import app from "../src/index";

const env = {
  APP_ENV: "development" as const,
  R2_BUCKET: {
    put: async () => undefined,
    get: async () => null
  }
};

describe("catch routes", () => {
  it("rejects empty catch corrections before database work", async () => {
    const response = await app.request(
      "/v1/catch/correct",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer demoTenant:captain_1:CAPTAIN",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          catch_id: "catch_1",
          corrections: {}
        })
      },
      env
    );

    expect(response.status).toBe(400);
    const body = await response.json() as { details?: { fieldErrors?: Record<string, string[]> } };
    expect(body.details?.fieldErrors?.corrections?.[0]).toContain("at least one correction field");
  });

  it("rejects unknown catch correction fields before database work", async () => {
    const response = await app.request(
      "/v1/catch/correct",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer demoTenant:captain_1:CAPTAIN",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          catch_id: "catch_1",
          corrections: {
            arbitrary_payload: "not allowed"
          }
        })
      },
      env
    );

    expect(response.status).toBe(400);
    const body = await response.json() as { details?: { fieldErrors?: Record<string, string[]> } };
    expect(body.details?.fieldErrors?.corrections?.[0]).toContain("Unrecognized key");
  });
});
