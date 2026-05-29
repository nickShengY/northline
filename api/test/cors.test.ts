import { describe, expect, it } from "vitest";
import app from "../src/index";

const bucket = {
  put: async () => undefined,
  get: async () => null
};

describe("cors policy", () => {
  it("echoes any local origin in development", async () => {
    const response = await app.request(
      "/health",
      { headers: { Origin: "http://127.0.0.1:5273" } },
      { APP_ENV: "development", R2_BUCKET: bucket }
    );

    expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5273");
  });

  it("rejects unconfigured browser origins outside development", async () => {
    const response = await app.request(
      "/health",
      { headers: { Origin: "https://evil.example" } },
      { APP_ENV: "production", CORS_ORIGIN: "https://ops.northline.example", R2_BUCKET: bucket }
    );

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("allows configured browser origins outside development", async () => {
    const response = await app.request(
      "/health",
      { headers: { Origin: "https://ops.northline.example" } },
      { APP_ENV: "production", CORS_ORIGIN: "https://ops.northline.example", R2_BUCKET: bucket }
    );

    expect(response.headers.get("access-control-allow-origin")).toBe("https://ops.northline.example");
  });
});
