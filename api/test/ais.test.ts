import { describe, expect, it } from "vitest";
import app from "../src/index";

const bucket = {
  put: async () => undefined,
  get: async () => null
};

describe("AIS proxy route security", () => {
  it("requires authentication for websocket stream upgrades", async () => {
    const response = await app.request(
      "/v1/ais/stream",
      {
        headers: {
          Upgrade: "websocket"
        }
      },
      { APP_ENV: "development", R2_BUCKET: bucket }
    );

    expect(response.status).toBe(401);
  });

  it("accepts websocket stream auth through a query token before opening upstream", async () => {
    const response = await app.request(
      "/v1/ais/stream?token=demoTenant:portal_admin:ORG_ADMIN",
      {
        headers: {
          Upgrade: "websocket"
        }
      },
      { APP_ENV: "development", R2_BUCKET: bucket }
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "ais_proxy_unavailable"
    });
  });

  it("keeps AIS HTTP endpoints behind the standard auth middleware", async () => {
    const response = await app.request(
      "/v1/ais/vessels",
      {},
      { APP_ENV: "development", R2_BUCKET: bucket }
    );

    expect(response.status).toBe(401);
  });

  it("rejects invalid AIS nearby query coordinates before database fallback", async () => {
    const cases = [
      "/v1/ais/nearby?lat=91&lon=-79.3",
      "/v1/ais/nearby?lat=44.4&lon=-181",
      "/v1/ais/nearby?lat=44.4&lon=-79.3&radius=999"
    ];

    for (const path of cases) {
      const response = await app.request(
        path,
        {
          headers: {
            Authorization: "Bearer demoTenant:portal_admin:ORG_ADMIN"
          }
        },
        { APP_ENV: "development", R2_BUCKET: bucket }
      );

      expect(response.status, path).toBe(400);
    }
  });

  it("rejects oversized AIS AI request bodies before model work", async () => {
    const response = await app.request(
      "/v1/ais/ai/recommendations",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer demoTenant:portal_admin:ORG_ADMIN",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ notes: "x".repeat(70 * 1024) })
      },
      { APP_ENV: "development", R2_BUCKET: bucket }
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: "payload_too_large",
      max_bytes: 65536
    });
  });

  it("caps AIS AI fanout to keep risk analysis predictable", async () => {
    const vessels = Array.from({ length: 26 }, (_, index) => ({
      mmsi: String(index),
      latitude: 44.4,
      longitude: -79.3
    }));

    const response = await app.request(
      "/v1/ais/risk/assess",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer demoTenant:portal_admin:ORG_ADMIN",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ vessels })
      },
      { APP_ENV: "development", R2_BUCKET: bucket }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "too_many_vessels",
      max_vessels: 25
    });
  });

  it("caps AIS behavior observations to keep local analysis bounded", async () => {
    const response = await app.request(
      "/v1/ais/ai/behavior",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer demoTenant:portal_admin:ORG_ADMIN",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          mmsi: "123456789",
          observations: Array.from({ length: 501 }, () => ({ speed: 1, course: 90 }))
        })
      },
      { APP_ENV: "development", R2_BUCKET: bucket }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "too_many_observations",
      max_observations: 500
    });
  });
});
