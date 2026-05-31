import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import { validateSyncDeviceAuthorization, writeSyncCursorAck } from "../src/routes/sync";
import type { SqlQuery } from "../src/lib/db";

const bucket = {
  put: async () => undefined,
  get: async () => null
};

describe("sync protocol routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps local cursor ack usable without a database", async () => {
    const response = await app.request(
      "/v1/sync/ack",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer demoTenant:crew_1:CREW",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ cursor: "2026-05-31T00:01:00.000Z|evt_2" })
      },
      { APP_ENV: "development", R2_BUCKET: bucket }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      cursor: "2026-05-31T00:01:00.000Z|evt_2"
    });
  });

  it("returns a validation error for malformed sync JSON instead of a 500", async () => {
    const response = await app.request(
      "/v1/sync/upload",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer demoTenant:crew_1:CREW",
          "Content-Type": "application/json"
        },
        body: "{not-json"
      },
      { APP_ENV: "development", R2_BUCKET: bucket }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_payload",
      message: "request body must be valid JSON"
    });
  });

  it("caps sync upload batches before event validation work", async () => {
    const response = await app.request(
      "/v1/sync/upload",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer demoTenant:crew_1:CREW",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ events: Array.from({ length: 251 }, () => ({})) })
      },
      { APP_ENV: "development", R2_BUCKET: bucket }
    );

    expect(response.status).toBe(400);
    const body = await response.json() as { details?: { fieldErrors?: Record<string, string[]> } };
    expect(body.details?.fieldErrors?.events?.[0]).toContain("at most 250");
  });

  it("rejects malformed sync identifiers and cursors before persistence work", async () => {
    const cases = [
      {
        path: "/v1/sync/upload",
        role: "CREW",
        body: { cursor: "bad cursor", events: [] }
      },
      {
        path: "/v1/sync/ack",
        role: "CREW",
        body: { cursor: "bad cursor" }
      },
      {
        path: "/v1/sync/ack",
        role: "CREW",
        body: { cursor: "2026-05-31T00:01:00.000Z|evt_2", device_id: "../bad" }
      },
      {
        path: "/v1/sync/ack",
        role: "CREW",
        body: { cursor: "2026-05-31T00:01:00.000Z|evt_2", scope: "bad scope" }
      },
      {
        path: "/v1/sync/metrics",
        role: "CREW",
        body: { metric_name: "upload_queue_depth", metric_value: 1, device_id: "../bad" }
      },
      {
        path: "/v1/sync/device/register-self",
        role: "CREW",
        body: { device_id: "bad device", public_key: "abcdefghijklmnopqrstuvwxyz", key_version: 1 }
      },
      {
        path: "/v1/sync/device/register-self",
        role: "CREW",
        body: { device_id: "mobile_crew_1_abcd1234", public_key: "bad public key", key_version: 1 }
      },
      {
        path: "/v1/sync/device/register",
        role: "ORG_ADMIN",
        body: {
          device_id: "device_1",
          subject_type: "USER",
          subject_id: "bad subject",
          public_key: "abcdefghijklmnopqrstuvwxyz",
          key_version: 1
        }
      }
    ];

    for (const item of cases) {
      const response = await app.request(
        item.path,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer demoTenant:actor_1:${item.role}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(item.body)
        },
        { APP_ENV: "development", R2_BUCKET: bucket }
      );

      expect(response.status, item.path).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: "invalid_payload" });
    }
  });

  it("rejects invalid sync metric values before database writes", async () => {
    const response = await app.request(
      "/v1/sync/metrics",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer demoTenant:crew_1:CREW",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          metric_name: "sync_duration_ms",
          metric_value: -1,
          dimension_json: {}
        })
      },
      { APP_ENV: "development", R2_BUCKET: bucket }
    );

    expect(response.status).toBe(400);
    const body = await response.json() as { details?: { fieldErrors?: Record<string, string[]> } };
    expect(body.details?.fieldErrors?.metric_value?.[0]).toContain("greater than or equal to 0");
  });

  it("caps sync metric dimensions before database writes", async () => {
    const response = await app.request(
      "/v1/sync/metrics",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer demoTenant:crew_1:CREW",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          metric_name: "upload_queue_depth",
          metric_value: 1,
          dimension_json: { payload: "x".repeat(4096) }
        })
      },
      { APP_ENV: "development", R2_BUCKET: bucket }
    );

    expect(response.status).toBe(400);
    const body = await response.json() as { details?: { fieldErrors?: Record<string, string[]> } };
    expect(body.details?.fieldErrors?.dimension_json?.[0]).toContain("4096 bytes or less");
  });

  it("fails closed on cursor ack persistence gaps outside development", async () => {
    await expect(writeSyncCursorAck(
      { APP_ENV: "production", R2_BUCKET: bucket },
      { tenantId: "demoTenant", actorId: "crew_1", role: "CREW" },
      { cursor: "2026-05-31T00:01:00.000Z|evt_2", requestId: "req_sync_ack" }
    )).rejects.toThrow("sync_ack_persistence_unavailable");
  });

  it("authorizes sync device attribution only for trusted caller devices", async () => {
    const sqlForDevice = (row: Record<string, unknown> | null): SqlQuery => async () => row ? [row] : [];
    const crew = { tenantId: "demoTenant", actorId: "crew_1", role: "CREW" as const };

    await expect(validateSyncDeviceAuthorization(
      sqlForDevice({ subject_type: "USER", subject_id: "crew_1", revoked: false }),
      crew,
      "mobile_crew_1"
    )).resolves.toBe("ok");

    await expect(validateSyncDeviceAuthorization(
      sqlForDevice({ subject_type: "USER", subject_id: "crew_2", revoked: false }),
      crew,
      "mobile_crew_2"
    )).resolves.toBe("device_actor_mismatch");

    await expect(validateSyncDeviceAuthorization(
      sqlForDevice({ subject_type: "USER", subject_id: "crew_1", revoked: true }),
      crew,
      "mobile_crew_1"
    )).resolves.toBe("device_revoked");

    await expect(validateSyncDeviceAuthorization(
      sqlForDevice({ subject_type: "VESSEL", subject_id: "vessel_1", revoked: false }),
      crew,
      "bridge_tablet"
    )).resolves.toBe("device_role_forbidden");

    await expect(validateSyncDeviceAuthorization(
      sqlForDevice({ subject_type: "VESSEL", subject_id: "vessel_1", revoked: false }),
      { ...crew, role: "CAPTAIN" },
      "bridge_tablet"
    )).resolves.toBe("ok");

    await expect(validateSyncDeviceAuthorization(
      sqlForDevice(null),
      crew,
      "unknown_device"
    )).resolves.toBe("device_not_found");
  });
});
