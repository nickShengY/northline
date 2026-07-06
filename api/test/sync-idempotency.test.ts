import { describe, expect, it, vi } from "vitest";
import { computeEventHash, type OpsEvent } from "@northline/shared";

const store = vi.hoisted(() => ({
  existingEventIds: new Set<string>(),
  crossTenantEventIds: new Set<string>(),
  deviceRow: null as Record<string, unknown> | null,
  queries: [] as string[]
}));

vi.mock("../src/lib/db", () => ({
  getSql: () => {
    throw new Error("not supported in this test");
  },
  pingDatabase: async () => undefined,
  withTenant: async (_env: unknown, _tenantId: string, fn: (sql: unknown) => Promise<unknown>) => {
    const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("$");
      store.queries.push(query);

      if (query.includes("select to_char(ts_server")) {
        const eventId = String(values[1]);
        return store.existingEventIds.has(eventId)
          ? [{ ts_server: "2026-05-31T00:00:00.000000Z" }]
          : [];
      }

      if (query.includes("from sync_device")) {
        return store.deviceRow ? [store.deviceRow] : [];
      }

      if (query.includes("select event_hash")) {
        return [];
      }

      if (query.includes("insert into ops_event")) {
        const eventId = String(values[0]);
        if (store.crossTenantEventIds.has(eventId)) {
          // Simulate the global ops_event primary key rejecting an id owned
          // by another tenant (invisible to the tenant-scoped dedup select).
          const error = new Error(`duplicate key value violates unique constraint "ops_event_pkey"`) as Error & { code: string };
          error.code = "23505";
          throw error;
        }
        store.existingEventIds.add(eventId);
        return [{ ts_server: "2026-05-31T00:00:05.000000Z" }];
      }

      return [];
    };

    return fn(sql);
  }
}));

import { appendEvents } from "../src/lib/events";
import app from "../src/index";

const bucket = {
  put: async () => undefined,
  get: async () => null
};

async function buildEvent(): Promise<OpsEvent> {
  const base = {
    event_id: "evt_idempotency_001",
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
    signature: "dev:crew_1"
  };

  return {
    ...base,
    event_hash: await computeEventHash(base)
  };
}

describe("sync idempotency and ack authorization", () => {
  it("accepts redelivered duplicate events instead of dropping them", async () => {
    store.existingEventIds.clear();
    const event = await buildEvent();
    const env = { APP_ENV: "development" as const, R2_BUCKET: bucket };

    const first = await appendEvents(env, "demoTenant", [event]);
    expect(first.accepted.map((item) => item.event_id)).toEqual(["evt_idempotency_001"]);
    expect(first.rejected).toEqual([]);

    const second = await appendEvents(env, "demoTenant", [event]);
    expect(second.accepted.map((item) => item.event_id)).toEqual(["evt_idempotency_001"]);
    expect(second.rejected).toEqual([]);
    expect(second.accepted[0]?.ts_server).toBeTruthy();
  });

  it("rejects a cross-tenant event_id collision instead of failing the batch", async () => {
    store.existingEventIds.clear();
    store.crossTenantEventIds.clear();
    const event = await buildEvent();
    store.crossTenantEventIds.add(event.event_id);

    const result = await appendEvents(
      { APP_ENV: "development" as const, R2_BUCKET: bucket },
      "demoTenant",
      [event]
    );

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      { event_id: event.event_id, reason: "event_id_conflict" }
    ]);
    store.crossTenantEventIds.clear();
  });

  it("tenant-scopes the duplicate check", async () => {
    store.existingEventIds.clear();
    store.queries = [];
    const event = await buildEvent();

    await appendEvents({ APP_ENV: "development" as const, R2_BUCKET: bucket }, "demoTenant", [event]);

    const dedupQuery = store.queries.find((query) => query.includes("select to_char(ts_server"));
    expect(dedupQuery).toContain("tenant_id = ");
  });

  it("maps sync ack device authorization failures to 403 instead of 503", async () => {
    store.deviceRow = { subject_type: "USER", subject_id: "someone_else", revoked: false };
    const warnMock = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await app.request(
      "/v1/sync/ack",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer demoTenant:crew_1:CREW",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          cursor: "2026-05-31T00:01:00.000Z|evt_2",
          device_id: "mobile_crew_1"
        })
      },
      {
        APP_ENV: "development",
        NEON_DATABASE_URL: "postgresql://db.example/northline",
        R2_BUCKET: bucket
      }
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "sync_ack_device_forbidden" });

    store.deviceRow = null;
    warnMock.mockRestore();
  });

  it("echoes the client cursor when a sync upload accepts nothing", async () => {
    const response = await app.request(
      "/v1/sync/upload",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer demoTenant:crew_1:CREW",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          cursor: "2026-05-31T00:01:00.000Z|evt_2",
          events: [{ not: "an event" }]
        })
      },
      { APP_ENV: "development", R2_BUCKET: bucket }
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { cursor: string; accepted: string[]; rejected: unknown[] };
    expect(body.cursor).toBe("2026-05-31T00:01:00.000Z|evt_2");
    expect(body.accepted).toEqual([]);
    expect(body.rejected).toHaveLength(1);
  });
});
