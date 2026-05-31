import { describe, expect, it } from "vitest";
import app from "../src/index";

const bucket = {
  put: async () => undefined,
  get: async () => null
};

describe("api error handling", () => {
  it("returns JSON for unknown routes", async () => {
    const response = await app.request(
      "/v1/unknown-route",
      {
        headers: {
          Authorization: "Bearer demoTenant:portal_admin:ORG_ADMIN"
        }
      },
      { APP_ENV: "development", R2_BUCKET: bucket }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "not_found" });
  });

  it("returns a validation error with a request id for malformed JSON bodies", async () => {
    const response = await app.request(
      "/v1/safety/risk/score",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer demoTenant:portal_admin:ORG_ADMIN",
          "Content-Type": "application/json",
          "x-request-id": "req_test_error"
        },
        body: "{invalid"
      },
      { APP_ENV: "development", R2_BUCKET: bucket }
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("x-request-id")).toBe("req_test_error");
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_payload",
      message: "request body must be valid JSON",
      request_id: "req_test_error"
    });
  });
});
