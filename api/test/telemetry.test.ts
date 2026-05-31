import { afterEach, describe, expect, it, vi } from "vitest";
import { emitTelemetry, shouldEmitTelemetry } from "../src/lib/telemetry";

const bucket = {
  put: async () => undefined,
  get: async () => null
};

describe("telemetry export policy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not emit without a configured webhook", () => {
    expect(shouldEmitTelemetry(
      { APP_ENV: "development", R2_BUCKET: bucket },
      {
        type: "request",
        request_id: "req_1",
        method: "GET",
        path: "/health",
        status: 200,
        duration_ms: 4,
        env: "development"
      },
      0
    )).toBe(false);
  });

  it("always emits errors when a webhook is configured", () => {
    expect(shouldEmitTelemetry(
      { APP_ENV: "production", OBSERVABILITY_WEBHOOK_URL: "https://telemetry.example/events", R2_BUCKET: bucket },
      {
        type: "error",
        request_id: "req_2",
        method: "POST",
        path: "/v1/sync/upload",
        error: "boom",
        env: "production"
      },
      1
    )).toBe(true);
  });

  it("always emits authorization denials when a webhook is configured", () => {
    expect(shouldEmitTelemetry(
      { APP_ENV: "production", OBSERVABILITY_WEBHOOK_URL: "https://telemetry.example/events", R2_BUCKET: bucket },
      {
        type: "authorization_denied",
        request_id: "req_authz",
        tenant_id: "tenant_1",
        actor_id: "crew_1",
        actor_role: "CREW",
        method: "POST",
        path: "/v1/rules/upsert",
        required_roles: ["ORG_ADMIN", "OWNER"],
        env: "production"
      },
      1
    )).toBe(true);
  });

  it("samples request events using OBSERVABILITY_SAMPLE_RATE", () => {
    const env = {
      APP_ENV: "production" as const,
      OBSERVABILITY_WEBHOOK_URL: "https://telemetry.example/events",
      OBSERVABILITY_SAMPLE_RATE: "0.25",
      R2_BUCKET: bucket
    };
    const event = {
      type: "request" as const,
      request_id: "req_3",
      method: "GET",
      path: "/ready",
      status: 200,
      duration_ms: 3,
      env: "production" as const
    };

    expect(shouldEmitTelemetry(env, event, 0.2)).toBe(true);
    expect(shouldEmitTelemetry(env, event, 0.9)).toBe(false);
  });

  it("defaults request sampling to five percent when a webhook is configured", () => {
    const env = {
      APP_ENV: "production" as const,
      OBSERVABILITY_WEBHOOK_URL: "https://telemetry.example/events",
      R2_BUCKET: bucket
    };
    const event = {
      type: "request" as const,
      request_id: "req_4",
      method: "GET",
      path: "/ready",
      status: 200,
      duration_ms: 2,
      env: "production" as const
    };

    expect(shouldEmitTelemetry(env, event, 0.04)).toBe(true);
    expect(shouldEmitTelemetry(env, event, 0.06)).toBe(false);
  });

  it("posts telemetry payloads with bearer authentication when configured", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await emitTelemetry(
      {
        APP_ENV: "production",
        OBSERVABILITY_WEBHOOK_URL: "https://telemetry.example/events",
        OBSERVABILITY_WEBHOOK_TOKEN: "collector_secret",
        OBSERVABILITY_SAMPLE_RATE: "1",
        R2_BUCKET: bucket
      },
      {
        type: "request",
        request_id: "req_5",
        method: "GET",
        path: "/ready",
        status: 200,
        duration_ms: 4,
        env: "production"
      }
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://telemetry.example/events",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer collector_secret"
        },
        body: JSON.stringify({
          source: "northline-api",
          type: "request",
          request_id: "req_5",
          method: "GET",
          path: "/ready",
          status: 200,
          duration_ms: 4,
          env: "production"
        })
      })
    );
  });

  it("posts authorization denial telemetry with actor and required role context", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await emitTelemetry(
      {
        APP_ENV: "production",
        OBSERVABILITY_WEBHOOK_URL: "https://telemetry.example/events",
        OBSERVABILITY_WEBHOOK_TOKEN: "collector_secret",
        OBSERVABILITY_SAMPLE_RATE: "0",
        R2_BUCKET: bucket
      },
      {
        type: "authorization_denied",
        request_id: "req_authz",
        tenant_id: "tenant_1",
        actor_id: "crew_1",
        actor_role: "CREW",
        method: "POST",
        path: "/v1/rules/upsert",
        required_roles: ["ORG_ADMIN", "OWNER"],
        env: "production"
      }
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://telemetry.example/events",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer collector_secret"
        },
        body: JSON.stringify({
          source: "northline-api",
          type: "authorization_denied",
          request_id: "req_authz",
          tenant_id: "tenant_1",
          actor_id: "crew_1",
          actor_role: "CREW",
          method: "POST",
          path: "/v1/rules/upsert",
          required_roles: ["ORG_ADMIN", "OWNER"],
          env: "production"
        })
      })
    );
  });

  it("warns when the telemetry collector returns an error status", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 503 }));
    const warnMock = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", fetchMock);

    await emitTelemetry(
      {
        APP_ENV: "production",
        OBSERVABILITY_WEBHOOK_URL: "https://telemetry.example/events",
        OBSERVABILITY_SAMPLE_RATE: "1",
        R2_BUCKET: bucket
      },
      {
        type: "request",
        request_id: "req_6",
        method: "GET",
        path: "/ready",
        status: 200,
        duration_ms: 4,
        env: "production"
      }
    );

    expect(warnMock).toHaveBeenCalledWith(JSON.stringify({
      event: "telemetry_delivery_failed",
      status: 503,
      request_id: "req_6"
    }));
  });

  it("warns when telemetry delivery rejects", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    const warnMock = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", fetchMock);

    await emitTelemetry(
      {
        APP_ENV: "production",
        OBSERVABILITY_WEBHOOK_URL: "https://telemetry.example/events",
        OBSERVABILITY_SAMPLE_RATE: "1",
        R2_BUCKET: bucket
      },
      {
        type: "request",
        request_id: "req_7",
        method: "GET",
        path: "/ready",
        status: 200,
        duration_ms: 4,
        env: "production"
      }
    );

    expect(warnMock).toHaveBeenCalledWith(JSON.stringify({
      event: "telemetry_delivery_failed",
      error: "Error: network down",
      request_id: "req_7"
    }));
  });
});
