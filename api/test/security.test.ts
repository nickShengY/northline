import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSyncValidationRejectedEvents, computeEventHash, type OpsEvent } from "@northline/shared";
import app from "../src/index";
import { validateIncomingEventWithSignature } from "../src/lib/validation";
import { clearRateLimitBucketsForTests } from "../src/lib/rate-limit";
import {
  generateDeviceKeyPair,
  signServerEventHash,
  signWithPrivateKey,
  verifyEd25519Signature,
  verifyServerEventSignature
} from "../src/lib/signature";
import { buildSelfDeviceRegistration } from "../src/routes/sync";
import { writeAuditLog } from "../src/lib/audit";
import { validateRouteParam } from "../src/lib/route-params";

const bucket = {
  put: async () => undefined,
  get: async () => null
};

async function buildEvent(overrides: Partial<OpsEvent> = {}): Promise<OpsEvent> {
  const base = {
    event_id: "evt_security_001",
    tenant_id: "demoTenant",
    subject_type: "USER" as const,
    subject_id: "crew_1",
    actor_id: "crew_1",
    device_id: "mobile_ops_pwa",
    ts_device: "2026-05-31T06:00:00.000Z",
    event_type: "SAFETY_PROMPT_ACKED" as const,
    schema_version: 1,
    payload_json: { trip_id: "trip_demo_001" },
    prev_hash: undefined,
    signature: "invalid_signature",
    ...overrides
  };

  return {
    ...base,
    event_hash: overrides.event_hash ?? (await computeEventHash(base))
  };
}

describe("security controls", () => {
  beforeEach(() => {
    clearRateLimitBucketsForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes authenticated session capabilities", async () => {
    const response = await app.request(
      "/v1/auth/session",
      {
        headers: {
          Authorization: "Bearer demoTenant:portal_admin:ORG_ADMIN"
        }
      },
      { APP_ENV: "development", R2_BUCKET: bucket }
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { role: string; capabilities: string[] };
    expect(body.role).toBe("ORG_ADMIN");
    expect(body.capabilities).toContain("devices:manage");
  });

  it("sets defensive HTTP security headers and production HSTS", async () => {
    const response = await app.request(
      "/health",
      {},
      { APP_ENV: "production", R2_BUCKET: bucket }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("strict-transport-security")).toContain("max-age=31536000");
  });

  it("exposes public auth provider configuration before session auth", async () => {
    const response = await app.request(
      "/v1/auth/config",
      {},
      {
        APP_ENV: "production",
        AUTH_LOGIN_URL: "https://identity.example/authorize",
        AUTH_CLIENT_ID: "northline-web",
        AUTH_SCOPES: "openid profile",
        R2_BUCKET: bucket
      }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      enabled: true,
      login_url: "https://identity.example/authorize",
      client_id: "northline-web",
      scopes: "openid profile"
    });
  });

  it("blocks device administration for crew users before database writes", async () => {
    const warnMock = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await app.request(
      "/v1/sync/device/register",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer demoTenant:crew_1:CREW",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          device_id: "mobile_ops_pwa",
          subject_type: "USER",
          subject_id: "crew_1",
          public_key: "abcdefghijklmnopqrstuvwxyz",
          key_version: 1
        })
      },
      { APP_ENV: "development", R2_BUCKET: bucket }
    );

    expect(response.status).toBe(403);
    expect(warnMock).toHaveBeenCalledOnce();
    const deniedLog = JSON.parse(String(warnMock.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(deniedLog).toMatchObject({
      event: "authorization_denied",
      tenant_id: "demoTenant",
      actor_id: "crew_1",
      actor_role: "CREW",
      method: "POST",
      path: "/v1/sync/device/register",
      required_roles: ["ORG_ADMIN", "OWNER", "CAPTAIN"]
    });
    expect(deniedLog.request_id).toEqual(expect.any(String));
  });

  it("blocks device registry reads for crew users before database access", async () => {
    const response = await app.request(
      "/v1/sync/devices",
      {
        headers: {
          Authorization: "Bearer demoTenant:crew_1:CREW"
        }
      },
      { APP_ENV: "development", R2_BUCKET: bucket }
    );

    expect(response.status).toBe(403);
  });

  it("scopes self device registration to the authenticated user", () => {
    const registration = buildSelfDeviceRegistration(
      {
        tenantId: "demoTenant",
        actorId: "crew_1",
        role: "CREW"
      },
      {
        device_id: "mobile_crew_1_abcd1234",
        public_key: "abcdefghijklmnopqrstuvwxyz",
        key_version: 1
      }
    );

    expect(registration).toEqual({
      device_id: "mobile_crew_1_abcd1234",
      subject_type: "USER",
      subject_id: "crew_1",
      public_key: "abcdefghijklmnopqrstuvwxyz",
      key_version: 1
    });
  });

  it("builds validation events for every sync upload rejection", () => {
    expect(buildSyncValidationRejectedEvents([
      { event_id: "evt_schema", reason: { schema: "invalid" } },
      { event_id: "evt_chain", reason: "hash_chain_conflict" }
    ], "2026-05-31T00:00:00.000Z")).toEqual([
      {
        event_type: "SYNC_VALIDATION_REJECTED",
        ts_server: "2026-05-31T00:00:00.000Z",
        payload_json: { event_id: "evt_schema", reason: { schema: "invalid" } }
      },
      {
        event_type: "SYNC_VALIDATION_REJECTED",
        ts_server: "2026-05-31T00:00:00.000Z",
        payload_json: { event_id: "evt_chain", reason: "hash_chain_conflict" }
      }
    ]);
  });

  it("restricts audit log access to administrative roles", async () => {
    const response = await app.request(
      "/v1/audit/events",
      {
        headers: {
          Authorization: "Bearer demoTenant:crew_1:CREW"
        }
      },
      { APP_ENV: "development", R2_BUCKET: bucket }
    );

    expect(response.status).toBe(403);
  });

  it("emits telemetry for authorization denials when observability is configured", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.request(
      "/v1/audit/events",
      {
        headers: {
          Authorization: "Bearer demoTenant:crew_1:CREW",
          "x-request-id": "req_denied_telemetry"
        }
      },
      {
        APP_ENV: "development",
        OBSERVABILITY_WEBHOOK_URL: "https://telemetry.example/events",
        OBSERVABILITY_WEBHOOK_TOKEN: "collector_secret",
        R2_BUCKET: bucket
      }
    );

    expect(response.status).toBe(403);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "https://telemetry.example/events",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("\"type\":\"authorization_denied\"")
        })
      );
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://telemetry.example/events",
      expect.objectContaining({
        body: expect.stringContaining("\"request_id\":\"req_denied_telemetry\"")
      })
    );
  });

  it("blocks crew users from administrative rebuild, integration, certificate, training, correction, QA, and safety closure writes", async () => {
    const cases = [
      {
        path: "/v1/projection/rebuild",
        body: { trip_id: "trip_demo_001" }
      },
      {
        path: "/v1/projection/rebuild/batch",
        body: { trip_ids: ["trip_demo_001"] }
      },
      {
        path: "/v1/ops/trip/trip_demo_001/rebuild",
        body: {}
      },
      {
        path: "/v1/integrations/configs/upsert",
        body: {
          integration_id: "ais_primary",
          integration_type: "AIS",
          provider: "northline",
          enabled: true,
          config_json: {}
        }
      },
      {
        path: "/v1/integrations/configs/ais_primary/test",
        body: {}
      },
      {
        path: "/v1/trace/certificate/issue",
        body: {
          lot_id: "lot_demo_001",
          trip_id: "trip_demo_001",
          event_ids: ["evt_security_001"]
        }
      },
      {
        path: "/v1/training/modules/upsert",
        body: {
          module_id: "mod_ice_safety",
          mode: "ICE",
          title: "Ice safety",
          duration_sec: 600,
          prerequisites: [],
          metadata_json: {},
          active: true
        }
      },
      {
        path: "/v1/training/assign",
        body: {
          user_id: "crew_2",
          module_id: "mod_ice_safety",
          reason: "post-incident corrective action"
        }
      },
      {
        path: "/v1/catch/correct",
        body: {
          catch_id: "catch_demo_001",
          corrections: { species: "cod" }
        }
      },
      {
        path: "/v1/catch/qa",
        body: {
          catch_id: "catch_demo_001",
          flagged: true,
          reason: "measurement review"
        }
      },
      {
        path: "/v1/safety/stop-work/stop_demo_001/clear",
        body: {
          notes: "hazard cleared"
        }
      },
      {
        path: "/v1/safety/mob/mob_demo_001/complete",
        body: {}
      },
      {
        path: "/v1/station/remove/station_demo_001",
        body: {}
      }
    ];

    for (const item of cases) {
      const response = await app.request(
        item.path,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer demoTenant:crew_1:CREW",
            "Content-Type": "application/json"
          },
          body: JSON.stringify(item.body)
        },
        { APP_ENV: "development", R2_BUCKET: bucket }
      );

      expect(response.status, item.path).toBe(403);
    }
  });

  it("blocks crew users from deleting route points before database access", async () => {
    const response = await app.request(
      "/v1/ice/route-point/point_demo_001",
      {
        method: "DELETE",
        headers: {
          Authorization: "Bearer demoTenant:crew_1:CREW"
        }
      },
      { APP_ENV: "development", R2_BUCKET: bucket }
    );

    expect(response.status).toBe(403);
  });

  it("rejects malformed route identifiers before database access", async () => {
    expect(validateRouteParam("tripId", "trip_demo_001")).toEqual({ ok: true, value: "trip_demo_001" });
    expect(validateRouteParam("tripId", "../bad")).toMatchObject({
      ok: false,
      error: { error: "invalid_route_param", param: "tripId" }
    });
    expect(validateRouteParam("tripId", "x".repeat(129))).toMatchObject({
      ok: false,
      error: { error: "invalid_route_param", param: "tripId" }
    });

    const response = await app.request(
      `/v1/safety/stop-work/${"x".repeat(129)}/clear`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer demoTenant:portal_admin:ORG_ADMIN",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      },
      { APP_ENV: "development", R2_BUCKET: bucket }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_route_path" });
  });

  it("rejects malformed query filters before database access", async () => {
    const cases = [
      "/v1/audit/events?actor_id=../bad",
      "/v1/audit/events?limit=999999",
      "/v1/export/artifacts?kind=bad%20kind",
      "/v1/integrations/status?type=bad%20type",
      "/v1/ops/trips?status=ACTIVE%20OR%201=1",
      "/v1/rules/all?mode=BAD",
      "/v1/rules/effective?mode=OFFSHORE&effective_date=2026-05-31%2000:00",
      "/v1/training/modules?mode=BAD",
      "/v1/gear/trip/trip_demo_001?mode=BAD",
      "/v1/safety/hazards?scope=bad%20scope",
      "/v1/station/tipups/trip_demo_001?station_id=../bad",
      "/v1/trace/lots?trip_id=bad%20trip",
      "/v1/trace/certificates?lot_id=bad%20lot",
      "/v1/catch/trip/trip_demo_001?species=bad%20species",
      "/v1/sync/download?cursor=bad%20cursor",
      "/v1/sync/download?limit=999999",
      "/v1/sync/metrics/summary?hours=999",
      `/v1/audit/events?actor_id=${"x".repeat(4100)}`
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

  it("rejects oversized enterprise workflow payloads before database access", async () => {
    const cases = [
      {
        path: "/v1/stl/packet",
        body: {
          packet_id: "packet_security_001",
          trip_id: "trip_demo_001",
          event_type: "CATCH_RECORDED",
          payload_json: { data: "x".repeat(64 * 1024) },
          source_event_ids: ["evt_security_001"],
          lossless_ref: "r2://packets/packet_security_001",
          ts_device: "2026-05-31T06:00:00.000Z"
        }
      },
      {
        path: "/v1/stl/ack",
        body: {
          packet_ids: Array.from({ length: 251 }, (_, index) => `packet_${index}`)
        }
      },
      {
        path: "/v1/trace/certificate/issue",
        body: {
          lot_id: "lot_demo_001",
          trip_id: "trip_demo_001",
          vessel_or_group: "FV Demo",
          event_ids: Array.from({ length: 501 }, (_, index) => `evt_${index}`)
        }
      },
      {
        path: "/v1/gear/sweep-check",
        body: {
          trip_id: "trip_demo_001",
          mode: "OFFSHORE",
          outstanding_gear_ids: Array.from({ length: 501 }, (_, index) => `gear_${index}`)
        }
      },
      {
        path: "/v1/catch/record",
        body: {
          catch_id: "catch_security_001",
          trip_id: "trip_demo_001",
          mode: "OFFSHORE",
          species: "cod",
          kept: true,
          photo_refs: Array.from({ length: 21 }, (_, index) => `photo_${index}`)
        }
      },
      {
        path: "/v1/catch/record",
        body: {
          catch_id: "catch_security_002",
          trip_id: "trip_demo_001",
          mode: "OFFSHORE",
          species: "cod",
          kept: true,
          location: { lat: 45.1, lon: -220 }
        }
      },
      {
        path: "/v1/safety/mob/start",
        body: {
          workflow_id: "mob_security_001",
          trip_id: "trip_demo_001",
          last_known_location: { lat: -100, lon: -61.2 }
        }
      },
      {
        path: "/v1/safety/near-miss",
        body: {
          near_miss_id: "near_miss_security_001",
          trip_id: "trip_demo_001",
          category: "SLIP",
          description: "Crew member slipped near the stern but recovered.",
          witnesses: Array.from({ length: 21 }, (_, index) => `crew_${index}`)
        }
      },
      {
        path: "/v1/safety/near-miss",
        body: {
          near_miss_id: "near_miss_security_002",
          trip_id: "trip_demo_001",
          category: "SLIP",
          description: "Crew member slipped near the stern but recovered.",
          location: { lat: 45.1, lon: -220 }
        }
      },
      {
        path: "/v1/safety/shelter/heater-flag",
        body: {
          shelter_id: "shelter_1",
          reason: "missing trip id"
        }
      },
      {
        path: "/v1/station/create",
        body: {
          station_id: "station_security_001",
          trip_id: "trip_demo_001",
          name: "North reef",
          location: { lat: 120, lon: -61.2 }
        }
      },
      {
        path: "/v1/ice/return-plan",
        body: {
          plan_id: "plan_security_001",
          trip_id: "trip_demo_001",
          return_by: "2026-05-31T18:00:00.000Z",
          escalation_contacts: Array.from({ length: 11 }, (_, index) => ({ name: `contact_${index}` }))
        }
      },
      {
        path: "/v1/integrations/configs/upsert",
        body: {
          integration_id: "ais_primary",
          integration_type: "AIS",
          provider: "northline",
          enabled: true,
          config_json: { payload: "x".repeat(33 * 1024) }
        }
      },
      {
        path: "/v1/rules/upsert",
        body: {
          ruleset_id: "rules_security_001",
          mode: "OFFSHORE",
          region_code: "NA",
          effective_from: "2026-05-31",
          rules_json: { payload: "x".repeat(65 * 1024) }
        }
      },
      {
        path: "/v1/safety/briefing",
        body: {
          briefing_id: "briefing_security_001",
          trip_id: "trip_demo_001",
          mode: "OFFSHORE",
          briefing_type: "PRE_TRIP",
          checklist_json: { payload: "x".repeat(33 * 1024) }
        }
      },
      {
        path: "/v1/training/modules/upsert",
        body: {
          module_id: "mod_security_001",
          mode: "ICE",
          title: "Oversized module",
          duration_sec: 600,
          metadata_json: { payload: "x".repeat(17 * 1024) }
        }
      },
      {
        path: "/v1/trace/lot/create",
        body: {
          lot_id: "lot_security_001",
          trip_id: "trip_demo_001",
          mode: "OFFSHORE",
          species_totals: Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`species_${index}`, 1]))
        }
      },
      {
        path: "/v1/trace/lot/scan-attach",
        body: {
          lot_id: "lot_security_001",
          trip_id: "trip_demo_001",
          batch_id: "batch_security_001",
          source: "MANUAL",
          species_totals: { cod: -1 }
        }
      }
    ];

    for (const item of cases) {
      const response = await app.request(
        item.path,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer demoTenant:portal_admin:ORG_ADMIN",
            "Content-Type": "application/json"
          },
          body: JSON.stringify(item.body)
        },
        { APP_ENV: "development", R2_BUCKET: bucket }
      );

      expect(response.status, item.path).toBe(400);
    }
  });

  it("blocks crew users from reading integration configuration records", async () => {
    const response = await app.request(
      "/v1/integrations/configs",
      {
        headers: {
          Authorization: "Bearer demoTenant:crew_1:CREW"
        }
      },
      { APP_ENV: "development", R2_BUCKET: bucket }
    );

    expect(response.status).toBe(403);
  });

  it("blocks crew users from reading export artifact metadata", async () => {
    for (const path of ["/v1/export/artifacts", "/v1/export/artifact/artifact_123"]) {
      const response = await app.request(
        path,
        {
          headers: {
            Authorization: "Bearer demoTenant:crew_1:CREW"
          }
        },
        { APP_ENV: "development", R2_BUCKET: bucket }
      );

      expect(response.status, path).toBe(403);
    }
  });

  it("fails closed on audit log write failures outside development", async () => {
    const warnMock = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(writeAuditLog(
      { APP_ENV: "production", R2_BUCKET: bucket },
      {
        auth: { tenantId: "demoTenant", actorId: "owner_1", role: "OWNER" },
        action: "device.register",
        subjectType: "DEVICE",
        subjectId: "device_1",
        outcome: "SUCCESS"
      }
    )).rejects.toThrow("audit_log_write_failed");

    expect(warnMock).toHaveBeenCalledWith(expect.stringContaining("audit_log_write_failed"));
  });

  it("keeps local development usable when audit log writes fail", async () => {
    const warnMock = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(writeAuditLog(
      { APP_ENV: "development", R2_BUCKET: bucket },
      {
        auth: { tenantId: "demoTenant", actorId: "owner_1", role: "OWNER" },
        action: "device.register",
        subjectType: "DEVICE",
        subjectId: "device_1",
        outcome: "SUCCESS"
      }
    )).resolves.toBeUndefined();

    expect(warnMock).toHaveBeenCalledWith(expect.stringContaining("audit_log_write_failed"));
  });

  it("requires trusted device signatures outside development", async () => {
    const event = await buildEvent();
    const result = await validateIncomingEventWithSignature(
      { APP_ENV: "production", R2_BUCKET: bucket },
      "demoTenant",
      event
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toEqual({ signature_verification: "device_key_lookup_failed" });
    }
  });

  it("rejects uploaded events that try to spoof server-generated signatures", async () => {
    const event = await buildEvent({ signature: "server-generated" });
    const result = await validateIncomingEventWithSignature(
      { APP_ENV: "production", SIGNING_SECRET: "test_signing_secret_32_chars_minimum", R2_BUCKET: bucket },
      "demoTenant",
      event
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toEqual({
        signature_verification: "server_signature_not_allowed_for_upload"
      });
    }
  });

  it("keeps development draft uploads usable with dev signatures", async () => {
    const event = await buildEvent({ signature: "dev:crew_1" });
    const result = await validateIncomingEventWithSignature(
      { APP_ENV: "development", R2_BUCKET: bucket },
      "demoTenant",
      event
    );

    expect(result.ok).toBe(true);
  });

  it("rejects events whose envelope no longer matches the submitted hash", async () => {
    const event = await buildEvent({ signature: "dev:crew_1" });
    const result = await validateIncomingEventWithSignature(
      { APP_ENV: "development", R2_BUCKET: bucket },
      "demoTenant",
      {
        ...event,
        payload_json: { trip_id: "trip_tampered" }
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toEqual({ event_hash: "hash_mismatch" });
    }
  });

  it("verifies real Ed25519 signatures and rejects tampered messages", async () => {
    const keyPair = await generateDeviceKeyPair();
    const signature = await signWithPrivateKey("event_hash_1", keyPair.privateKey);

    await expect(verifyEd25519Signature("event_hash_1", signature, keyPair.publicKey)).resolves.toBe(true);
    await expect(verifyEd25519Signature("event_hash_2", signature, keyPair.publicKey)).resolves.toBe(false);
  });

  it("signs server-generated event hashes with the deployment signing secret", async () => {
    const env = {
      APP_ENV: "production" as const,
      SIGNING_SECRET: "test_signing_secret_32_chars_minimum",
      R2_BUCKET: bucket
    };
    const signature = await signServerEventHash(env, "event_hash_1");

    expect(signature).toMatch(/^server:v1:/);
    await expect(verifyServerEventSignature(env, "event_hash_1", signature)).resolves.toBe(true);
    await expect(verifyServerEventSignature(env, "event_hash_2", signature)).resolves.toBe(false);
  });

  it("rate limits repeated API requests by client and token fingerprint", async () => {
    const env = {
      APP_ENV: "development" as const,
      RATE_LIMIT_MAX_REQUESTS: "2",
      RATE_LIMIT_WINDOW_SECONDS: "60",
      RATE_LIMIT_NAMESPACE: "security-test",
      R2_BUCKET: bucket
    };

    const request = () => app.request(
      "/v1/auth/session",
      {
        headers: {
          Authorization: "Bearer demoTenant:portal_admin:ORG_ADMIN",
          "cf-connecting-ip": "203.0.113.22"
        }
      },
      env
    );

    expect((await request()).status).toBe(200);
    expect((await request()).status).toBe(200);
    const limited = await request();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });

  it("uses durable rate limiter binding when configured", async () => {
    const durableBuckets = new Map<string, { count: number; resetAt: number }>();
    const fakeLimiter = {
      idFromName: (name: string) => ({ name }),
      get: (id: { name: string }) => ({
        fetch: async () => {
          const now = Date.now();
          const current = durableBuckets.get(id.name);
          const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + 60_000 };
          bucket.count += 1;
          durableBuckets.set(id.name, bucket);
          return Response.json({
            allowed: bucket.count <= 1,
            limit: 1,
            remaining: Math.max(0, 1 - bucket.count),
            resetAt: Math.ceil(bucket.resetAt / 1000),
            retryAfter: bucket.count > 1 ? 60 : undefined
          });
        }
      })
    };

    const env = {
      APP_ENV: "production" as const,
      RATE_LIMIT_MAX_REQUESTS: "99",
      RATE_LIMIT_WINDOW_SECONDS: "60",
      RATE_LIMIT_NAMESPACE: "durable-test",
      JWT_PUBLIC_KEY: "unused",
      R2_BUCKET: bucket,
      RATE_LIMITER: fakeLimiter as unknown as DurableObjectNamespace
    };

    const request = () => app.request(
      "/v1/auth/config",
      {
        headers: {
          "cf-connecting-ip": "203.0.113.23"
        }
      },
      env
    );

    expect((await request()).status).toBe(200);
    const limited = await request();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("ratelimit-limit")).toBe("1");
  });
});
