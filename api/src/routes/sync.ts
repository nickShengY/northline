import { Hono, type Context } from "hono";
import { z } from "zod";
import { buildSyncValidationRejectedEvents, type OpsEvent, type SyncRejectedEvent } from "@northline/shared";
import type { AuthContext, Env } from "../types";
import { validateIncomingEventWithSignature } from "../lib/validation";
import { appendEvents, buildEventCursor, eventsSinceCursor } from "../lib/events";
import { type SqlQuery, withTenant } from "../lib/db";
import { readJsonBody } from "../lib/request";
import { appendServerEvent } from "../lib/server-events";
import { requireRole } from "../lib/rbac";
import { writeAuditLog } from "../lib/audit";
import { parseBoundedIntegerQueryParam, validateOptionalQueryParam, validateRouteParam } from "../lib/route-params";

type SyncContext = Context<{ Bindings: Env; Variables: { auth: AuthContext } }>;

const maxSyncUploadEvents = 250;
const maxSyncMetricDimensionBytes = 4096;
const syncIdentifierSchema = z.string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const syncCursorSchema = z.string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:|-]*$/);
const devicePublicKeySchema = z.string()
  .min(24)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

function jsonByteLength(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

async function readSyncJson(c: SyncContext) {
  return readJsonBody(c);
}

const uploadSchema = z.object({
  cursor: syncCursorSchema.optional(),
  events: z.array(z.unknown()).max(maxSyncUploadEvents).default([])
});

const ackSchema = z.object({
  cursor: syncCursorSchema,
  device_id: syncIdentifierSchema.optional(),
  scope: syncIdentifierSchema.optional()
});

const metricSchema = z.object({
  metric_name: z.enum([
    "sync_success_rate",
    "sync_duration_ms",
    "conflict_rate",
    "upload_queue_depth",
    "data_staleness_seconds"
  ]),
  metric_value: z.number().finite().nonnegative(),
  device_id: syncIdentifierSchema.optional(),
  dimension_json: z.record(z.unknown()).default({})
}).refine((value) => jsonByteLength(value.dimension_json) <= maxSyncMetricDimensionBytes, {
  path: ["dimension_json"],
  message: `dimension_json must be ${maxSyncMetricDimensionBytes} bytes or less`
});

const deviceRegisterSchema = z.object({
  device_id: syncIdentifierSchema.min(3),
  subject_type: z.enum(["VESSEL", "USER", "GROUP", "ORG"]),
  subject_id: syncIdentifierSchema.min(2),
  public_key: devicePublicKeySchema,
  key_version: z.number().int().positive().default(1)
});

const selfDeviceRegisterSchema = deviceRegisterSchema.pick({
  device_id: true,
  public_key: true,
  key_version: true
});

function eventIdFromUnknown(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const maybe = value as { event_id?: unknown };
  return typeof maybe.event_id === "string" ? maybe.event_id : undefined;
}

export function buildSelfDeviceRegistration(auth: AuthContext, input: z.infer<typeof selfDeviceRegisterSchema>) {
  return {
    device_id: input.device_id,
    subject_type: "USER" as const,
    subject_id: auth.actorId,
    public_key: input.public_key,
    key_version: input.key_version
  };
}

export type SyncAckDeviceAuthorizationResult =
  | "ok"
  | "device_not_found"
  | "device_revoked"
  | "device_actor_mismatch"
  | "device_role_forbidden";

export async function validateSyncDeviceAuthorization(
  sql: SqlQuery,
  auth: AuthContext,
  deviceId?: string
): Promise<SyncAckDeviceAuthorizationResult> {
  if (!deviceId) return "ok";

  const rows = await sql`
    select subject_type, subject_id, revoked
    from sync_device
    where tenant_id = ${auth.tenantId}
      and device_id = ${deviceId}
    limit 1
  `;

  if (!rows.length) return "device_not_found";

  const device = rows[0] as {
    subject_type: "VESSEL" | "USER" | "GROUP" | "ORG";
    subject_id: string;
    revoked: boolean;
  };

  if (device.revoked) return "device_revoked";
  if (device.subject_type === "USER") {
    return device.subject_id === auth.actorId ? "ok" : "device_actor_mismatch";
  }

  return ["ORG_ADMIN", "OWNER", "CAPTAIN"].includes(auth.role) ? "ok" : "device_role_forbidden";
}

export async function writeSyncCursorAck(env: Env, auth: AuthContext, input: {
  cursor: string;
  deviceId?: string;
  scope?: string;
  requestId?: string;
  userAgent?: string;
}) {
  if (!env.NEON_DATABASE_URL) {
    if (env.APP_ENV === "development") return null;
    throw new Error("sync_ack_persistence_unavailable");
  }

  const ackId = `ack_${crypto.randomUUID().replace(/-/g, "")}`;
  await withTenant(env, auth.tenantId, async (sql) => {
    const authorization = await validateSyncDeviceAuthorization(sql, auth, input.deviceId);
    if (authorization !== "ok") {
      throw new Error(`sync_ack_device_authorization_failed:${authorization}`);
    }

    await sql`
      insert into sync_cursor_ack (
        ack_id, tenant_id, actor_id, device_id, scope, cursor, request_id, user_agent
      ) values (
        ${ackId}, ${auth.tenantId}, ${auth.actorId}, ${input.deviceId ?? null},
        ${input.scope ?? "default"}, ${input.cursor}, ${input.requestId ?? null}, ${input.userAgent ?? null}
      )
    `;
  });

  return ackId;
}

export const syncRouter = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

syncRouter.post("/upload", async (c) => {
  const auth = c.get("auth");
  const body = await readSyncJson(c);
  if (!body.ok) return body.response;

  const parsed = uploadSchema.safeParse(body.body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const accepted: OpsEvent[] = [];
  const rejected: SyncRejectedEvent[] = [];

  for (const rawEvent of parsed.data.events) {
    const validation = await validateIncomingEventWithSignature(c.env, auth.tenantId, rawEvent);
    if (!validation.ok) {
      rejected.push({
        event_id: eventIdFromUnknown(rawEvent),
        reason: validation.reason
      });
      continue;
    }

    if (validation.event.tenant_id !== auth.tenantId) {
      rejected.push({ event_id: validation.event.event_id, reason: "tenant_mismatch" });
      continue;
    }

    accepted.push(validation.event);
  }

  const appendResult = await appendEvents(c.env, auth.tenantId, accepted);

  const allRejected = [...rejected, ...appendResult.rejected];
  const serverGeneratedEvents = buildSyncValidationRejectedEvents(allRejected);

  if (allRejected.length > 0) {
    console.warn(JSON.stringify({
      event: "sync_upload_rejected",
      tenant_id: auth.tenantId,
      actor_id: auth.actorId,
      accepted_count: appendResult.accepted.length,
      rejected_count: allRejected.length,
      rejected_event_ids: allRejected.map((item) => item.event_id).filter(Boolean),
      request_id: c.req.header("x-request-id") ?? c.res.headers.get("x-request-id") ?? null
    }));
  }

  // Advance the cursor to the newest accepted event (ts_server|event_id,
  // matching the /sync/download cursor format). When nothing was accepted,
  // echo the client's cursor back unchanged so it does not skip ahead.
  const lastAccepted = appendResult.accepted.reduce<OpsEvent | null>((max, event) => {
    if (!event.ts_server) return max;
    if (!max?.ts_server) return event;
    const order = event.ts_server.localeCompare(max.ts_server);
    return order > 0 || (order === 0 && event.event_id > max.event_id) ? event : max;
  }, null);

  return c.json({
    cursor: lastAccepted ? buildEventCursor(lastAccepted) : parsed.data.cursor ?? new Date().toISOString(),
    accepted: appendResult.accepted.map((event) => event.event_id),
    accepted_count: appendResult.accepted.length,
    rejected: allRejected,
    server_generated_events: serverGeneratedEvents
  });
});

syncRouter.get("/download", async (c) => {
  const auth = c.get("auth");
  const cursorResult = validateOptionalQueryParam("cursor", c.req.query("cursor"), {
    maxLength: 256,
    pattern: /^[A-Za-z0-9][A-Za-z0-9._:|-]*$/
  });
  if (!cursorResult.ok) return c.json(cursorResult.error, 400);
  const cursor = cursorResult.value;
  const limitResult = parseBoundedIntegerQueryParam("limit", c.req.query("limit"), {
    defaultValue: 1000,
    min: 1,
    max: 5000
  });
  if (!limitResult.ok) return c.json(limitResult.error, 400);
  const limit = limitResult.value;
  const events = await eventsSinceCursor(c.env, auth.tenantId, cursor, limit);

  const lastEvent = events.at(-1);
  const nextCursor = lastEvent?.ts_server ? buildEventCursor(lastEvent) : cursor ?? new Date().toISOString();

  return c.json({ cursor: nextCursor, events });
});

syncRouter.post("/ack", async (c) => {
  const auth = c.get("auth");
  const body = await readSyncJson(c);
  if (!body.ok) return body.response;

  const parsed = ackSchema.safeParse(body.body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  try {
    const ackId = await writeSyncCursorAck(c.env, auth, {
      cursor: parsed.data.cursor,
      deviceId: parsed.data.device_id,
      scope: parsed.data.scope,
      requestId: c.req.header("x-request-id"),
      userAgent: c.req.header("user-agent")
    });

    return c.json({
      ok: true,
      cursor: parsed.data.cursor,
      acknowledged_at: new Date().toISOString(),
      ...(ackId ? { ack_id: ackId } : {})
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.startsWith("sync_ack_device_authorization_failed:")) {
      console.warn(JSON.stringify({
        event: "sync_ack_device_authorization_failed",
        tenant_id: auth.tenantId,
        actor_id: auth.actorId,
        device_id: parsed.data.device_id ?? null,
        reason: message.replace("sync_ack_device_authorization_failed:", ""),
        request_id: c.req.header("x-request-id") ?? null
      }));
      return c.json({ error: "sync_ack_device_forbidden" }, 403);
    }

    console.warn(JSON.stringify({
      event: "sync_ack_persistence_failed",
      tenant_id: auth.tenantId,
      actor_id: auth.actorId,
      cursor: parsed.data.cursor,
      error: message,
      request_id: c.req.header("x-request-id") ?? null
    }));
    return c.json({ error: "sync_ack_persistence_failed" }, 503);
  }
});

syncRouter.post("/metrics", async (c) => {
  const auth = c.get("auth");
  const body = await readSyncJson(c);
  if (!body.ok) return body.response;

  const parsed = metricSchema.safeParse(body.body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const metricId = `metric_${crypto.randomUUID().replace(/-/g, "")}`;

  try {
    await withTenant(c.env, auth.tenantId, async (sql) => {
      const authorization = await validateSyncDeviceAuthorization(sql, auth, parsed.data.device_id);
      if (authorization !== "ok") {
        throw new Error(`sync_metric_device_authorization_failed:${authorization}`);
      }

      await sql`
        insert into sync_health_metric (
          metric_id, tenant_id, device_id, metric_name, metric_value, dimension_json
        ) values (
          ${metricId}, ${auth.tenantId}, ${parsed.data.device_id ?? null},
          ${parsed.data.metric_name}, ${parsed.data.metric_value}, ${JSON.stringify(parsed.data.dimension_json)}::jsonb
        )
      `;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("sync_metric_device_authorization_failed:")) {
      console.warn(JSON.stringify({
        event: "sync_metric_device_authorization_failed",
        tenant_id: auth.tenantId,
        actor_id: auth.actorId,
        device_id: parsed.data.device_id ?? null,
        reason: message.replace("sync_metric_device_authorization_failed:", ""),
        request_id: c.req.header("x-request-id") ?? null
      }));
      return c.json({ error: "sync_metric_device_forbidden" }, 403);
    }
    throw error;
  }

  return c.json({ ok: true, metric_id: metricId, measured_at: new Date().toISOString() });
});

syncRouter.get("/metrics/summary", async (c) => {
  const auth = c.get("auth");
  const hoursResult = parseBoundedIntegerQueryParam("hours", c.req.query("hours"), {
    defaultValue: 24,
    min: 1,
    max: 168
  });
  if (!hoursResult.ok) return c.json(hoursResult.error, 400);
  const hours = hoursResult.value;

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select metric_name,
             avg(metric_value)::float as avg_value,
             max(metric_value)::float as max_value,
             min(metric_value)::float as min_value,
             count(*)::int as samples,
             max(measured_at)::text as latest_at
      from sync_health_metric
      where tenant_id = ${auth.tenantId}
        and measured_at >= now() - make_interval(hours => ${hours})
      group by metric_name
      order by metric_name asc
    `;
  });

  return c.json({
    tenant_id: auth.tenantId,
    window_hours: hours,
    metrics: rows
  });
});

syncRouter.post("/device/register", requireRole("ORG_ADMIN", "OWNER", "CAPTAIN"), async (c) => {
  const auth = c.get("auth");
  const body = await readSyncJson(c);
  if (!body.ok) return body.response;

  const parsed = deviceRegisterSchema.safeParse(body.body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      insert into sync_device (
        device_id, tenant_id, subject_type, subject_id, public_key, key_version, revoked, last_seen_at
      ) values (
        ${parsed.data.device_id}, ${auth.tenantId}, ${parsed.data.subject_type}, ${parsed.data.subject_id},
        ${parsed.data.public_key}, ${parsed.data.key_version}, false, now()
      )
      on conflict (tenant_id, device_id) do update
      set subject_type = excluded.subject_type,
          subject_id = excluded.subject_id,
          public_key = excluded.public_key,
          key_version = excluded.key_version,
          revoked = false,
          last_seen_at = now()
    `;
  });

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: parsed.data.subject_type,
    subject_id: parsed.data.subject_id,
    actor_id: auth.actorId,
    event_type: "DEVICE_REGISTERED",
    payload_json: {
      device_id: parsed.data.device_id,
      subject_type: parsed.data.subject_type,
      subject_id: parsed.data.subject_id,
      key_version: parsed.data.key_version
    }
  });

  await writeAuditLog(c.env, {
    auth,
    action: "device.register",
    subjectType: "DEVICE",
    subjectId: parsed.data.device_id,
    outcome: "SUCCESS",
    requestId: c.req.header("x-request-id"),
    metadata: {
      subject_type: parsed.data.subject_type,
      subject_id: parsed.data.subject_id,
      key_version: parsed.data.key_version
    }
  });

  return c.json({ ok: true, device_id: parsed.data.device_id, emitted_event_id: emitted.event_id });
});

syncRouter.post("/device/register-self", async (c) => {
  const auth = c.get("auth");
  const body = await readSyncJson(c);
  if (!body.ok) return body.response;

  const parsed = selfDeviceRegisterSchema.safeParse(body.body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const registration = buildSelfDeviceRegistration(auth, parsed.data);

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      insert into sync_device (
        device_id, tenant_id, subject_type, subject_id, public_key, key_version, revoked, last_seen_at
      ) values (
        ${registration.device_id}, ${auth.tenantId}, ${registration.subject_type}, ${registration.subject_id},
        ${registration.public_key}, ${registration.key_version}, false, now()
      )
      on conflict (tenant_id, device_id) do update
      set subject_type = excluded.subject_type,
          subject_id = excluded.subject_id,
          public_key = excluded.public_key,
          key_version = excluded.key_version,
          revoked = false,
          last_seen_at = now()
    `;
  });

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: registration.subject_type,
    subject_id: registration.subject_id,
    actor_id: auth.actorId,
    event_type: "DEVICE_REGISTERED",
    payload_json: {
      device_id: registration.device_id,
      subject_type: registration.subject_type,
      subject_id: registration.subject_id,
      key_version: registration.key_version,
      registration_mode: "self"
    }
  });

  await writeAuditLog(c.env, {
    auth,
    action: "device.self_register",
    subjectType: "DEVICE",
    subjectId: registration.device_id,
    outcome: "SUCCESS",
    requestId: c.req.header("x-request-id"),
    metadata: {
      subject_type: registration.subject_type,
      subject_id: registration.subject_id,
      key_version: registration.key_version
    }
  });

  return c.json({ ok: true, device_id: registration.device_id, emitted_event_id: emitted.event_id });
});

syncRouter.post("/device/revoke/:deviceId", requireRole("ORG_ADMIN", "OWNER", "CAPTAIN"), async (c) => {
  const auth = c.get("auth");
  const parsedDeviceId = validateRouteParam("deviceId", c.req.param("deviceId"));
  if (!parsedDeviceId.ok) {
    return c.json(parsedDeviceId.error, 400);
  }
  const deviceId = parsedDeviceId.value;

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      update sync_device
      set revoked = true,
          last_seen_at = now()
      where tenant_id = ${auth.tenantId} and device_id = ${deviceId}
      returning device_id, subject_type, subject_id
    `;
  });

  if (!rows.length) {
    return c.json({ ok: false, reason: "device_not_found" }, 404);
  }

  const row = rows[0] as { device_id: string; subject_type: "VESSEL" | "USER" | "GROUP" | "ORG"; subject_id: string };
  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: row.subject_type,
    subject_id: row.subject_id,
    actor_id: auth.actorId,
    event_type: "DEVICE_REVOKED",
    payload_json: {
      device_id: row.device_id,
      subject_type: row.subject_type,
      subject_id: row.subject_id
    }
  });

  await writeAuditLog(c.env, {
    auth,
    action: "device.revoke",
    subjectType: "DEVICE",
    subjectId: row.device_id,
    outcome: "SUCCESS",
    requestId: c.req.header("x-request-id"),
    metadata: {
      subject_type: row.subject_type,
      subject_id: row.subject_id
    }
  });

  return c.json({ ok: true, device_id: row.device_id, emitted_event_id: emitted.event_id });
});

syncRouter.get("/devices", requireRole("ORG_ADMIN", "OWNER", "CAPTAIN"), async (c) => {
  const auth = c.get("auth");

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select device_id, subject_type, subject_id, key_version, revoked, last_seen_at::text, created_at::text
      from sync_device
      where tenant_id = ${auth.tenantId}
      order by created_at desc
      limit 500
    `;
  });

  return c.json({ devices: rows });
});
