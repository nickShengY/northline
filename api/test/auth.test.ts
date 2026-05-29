import { describe, expect, it } from "vitest";
import app from "../src/index";

describe("auth middleware", () => {
  it("accepts dev tokens only in development", async () => {
    const response = await app.request(
      "/v1/__auth_probe",
      {
        headers: {
          Authorization: "Bearer demoTenant:portal_admin:ORG_ADMIN"
        }
      },
      {
        APP_ENV: "development",
        R2_BUCKET: {
          put: async () => undefined,
          get: async () => null
        }
      }
    );

    expect(response.status).not.toBe(401);
  });

  it("rejects forgeable dev tokens in staging", async () => {
    const response = await app.request(
      "/v1/__auth_probe",
      {
        headers: {
          Authorization: "Bearer demoTenant:attacker:ORG_ADMIN"
        }
      },
      {
        APP_ENV: "staging",
        R2_BUCKET: {
          put: async () => undefined,
          get: async () => null
        }
      }
    );

    expect(response.status).toBe(401);
  });

  it("rejects forgeable dev tokens in production", async () => {
    const response = await app.request(
      "/v1/__auth_probe",
      {
        headers: {
          Authorization: "Bearer demoTenant:attacker:ORG_ADMIN"
        }
      },
      {
        APP_ENV: "production",
        R2_BUCKET: {
          put: async () => undefined,
          get: async () => null
        }
      }
    );

    expect(response.status).toBe(401);
  });
});
