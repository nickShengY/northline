import { Hono } from "hono";
import { z } from "zod";
import type { OpsEvent } from "@northline/shared";
import type { Env } from "../types";
import { validateIncomingEvent } from "../lib/validation";
import { appendEvents, eventsSinceCursor } from "../lib/events";
import { withTenant } from "../lib/db";
import { appendServerEvent } from "../lib/server-events";

const uploadSchema = z.object({
  cursor: z.string().optional(),
  events: z.array(z.unknown()).default([])
});

const ackSchema = z.object({
  cursor: z.string()
});

const metricSchema = z.object({
  metric_name: z.enum([
    "sync_success_rate",
    "sync_duration_ms",
    "conflict_rate",
    "upload_queue_depth",
    "data_staleness_seconds"
  ]),
  metric_value: z.number(),
  device_id: z.string().optional(),
  dimension_json: z.record(z.unknown()).default({})
});

const deviceRegisterSchema = z.object({
  device_id: z.string().min(3),
  subject_type: z.enum(["VESSEL", "USER", "GROUP", "ORG"]),
  subject_id: z.string().min(2),
  public_key: z.string().min(24),
  key_version: z.number().int().positive().default(1)
});

function eventIdFromUnknown(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const maybe = value as { event_id?: unknown };
  return typeof maybe.event_id === "string" ? maybe.event_id : undefined;
}

export const syncRouter = new Hono<{ Bindings: Env; Variables: { auth: { tenantId: string; actorId: string } } }>();

syncRouter.post("/upload", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = uploadSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const accepted: OpsEvent[] = [];
  const rejected: Array<{ event_id?: string; reason: unknown }> = [];

  for (const rawEvent of parsed.data.events) {
    const validation = validateIncomingEvent(rawEvent);
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

  const serverGeneratedEvents = appendResult.rejected.map((item) => ({
    event_type: "SYNC_VALIDATION_REJECTED",
    ts_server: new Date().toISOString(),
    payload_json: item
  }));

  return c.json({
    cursor: new Date().toISOString(),
    accepted: appendResult.accepted.map((event) => event.event_id),
    accepted_count: appendResult.accepted.length,
    rejected: [...rejected, ...appendResult.rejected],
    server_generated_events: serverGeneratedEvents
  });
});

syncRouter.get("/download", async (c) => {
  const auth = c.get("auth");
  const cursor = c.req.query("cursor");
  const events = await eventsSinceCursor(c.env, auth.tenantId, cursor);

  const lastEvent = events.at(-1);
  const nextCursor = lastEvent?.ts_server ?? cursor ?? new Date().toISOString();

  return c.json({ cursor: nextCursor, events });
});

syncRouter.post("/ack", async (c) => {
  const body = await c.req.json();
  const parsed = ackSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  return c.json({ ok: true, cursor: parsed.data.cursor, acknowledged_at: new Date().toISOString() });
});

syncRouter.post("/metrics", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = metricSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const metricId = `metric_${crypto.randomUUID().replace(/-/g, "")}`;

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      insert into sync_health_metric (
        metric_id, tenant_id, device_id, metric_name, metric_value, dimension_json
      ) values (
        ${metricId}, ${auth.tenantId}, ${parsed.data.device_id ?? null},
        ${parsed.data.metric_name}, ${parsed.data.metric_value}, ${JSON.stringify(parsed.data.dimension_json)}::jsonb
      )
    `;
  });

  return c.json({ ok: true, metric_id: metricId, measured_at: new Date().toISOString() });
});

syncRouter.get("/metrics/summary", async (c) => {
  const auth = c.get("auth");
  const hoursParam = Number(c.req.query("hours") ?? "24");
  const hours = Number.isFinite(hoursParam) && hoursParam > 0 ? Math.min(168, hoursParam) : 24;

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

syncRouter.post("/device/register", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = deviceRegisterSchema.safeParse(body);

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
      on conflict (device_id) do update
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

  return c.json({ ok: true, device_id: parsed.data.device_id, emitted_event_id: emitted.event_id });
});

syncRouter.post("/device/revoke/:deviceId", async (c) => {
  const auth = c.get("auth");
  const deviceId = c.req.param("deviceId");

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

  return c.json({ ok: true, device_id: row.device_id, emitted_event_id: emitted.event_id });
});

syncRouter.get("/devices", async (c) => {
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
