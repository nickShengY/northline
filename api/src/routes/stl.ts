/**
 * Semantic Transport Layer (STL) Routes
 *
 * API endpoints for optimized sync under weak connectivity.
 * Provides meaning-first packet upload/download with lossless audit trail.
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AuthContext, Env } from "../types";
import { withTenant } from "../lib/db";
import { readJsonBody } from "../lib/request";
import { appendServerEvent } from "../lib/server-events";
import {
  classifyEventPriority,
  generatePreview,
  calculatePacketSize,
  determineUploadStrategy,
  mergePacketsForUpload,
  type SemanticPacket,
  type PacketPriority,
  type ConnectivityQuality,
  type PacketQueueStats,
} from "../services/stl";
import { fitsJsonByteLimit } from "../lib/json-size";

const maxPacketPayloadBytes = 64 * 1024;
const maxPacketSourceEventIds = 100;
const maxAckPacketIds = 250;

const packetCreateSchema = z.object({
  packet_id: z.string().min(3),
  trip_id: z.string().optional(),
  event_type: z.string().min(1),
  payload_json: z.record(z.unknown()).refine(
    fitsJsonByteLimit(maxPacketPayloadBytes),
    `payload_json must be ${maxPacketPayloadBytes} bytes or less`
  ),
  source_event_ids: z.array(z.string()).min(1).max(maxPacketSourceEventIds),
  lossless_ref: z.string().min(1),
  ts_device: z.string().datetime()
});

const connectivityReportSchema = z.object({
  bandwidth_kbps: z.number().min(0),
  latency_ms: z.number().min(0),
  packet_loss_rate: z.number().min(0).max(1)
});

const packetAckSchema = z.object({
  packet_ids: z.array(z.string()).min(1).max(maxAckPacketIds)
});

export const stlRouter = new Hono<{
  Bindings: Env;
  Variables: { auth: AuthContext }
}>();

const deviceIdHeaderPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * The auth context carries no device identity; devices self-report it via the
 * optional x-device-id header (validated as a sync identifier).
 */
function requestDeviceId(c: Context<{ Bindings: Env; Variables: { auth: AuthContext } }>): string {
  const header = c.req.header("x-device-id")?.trim();
  return header && deviceIdHeaderPattern.test(header) ? header : "unknown";
}

/**
 * POST /v1/stl/packet - Create a new semantic packet
 *
 * Client creates a packet with both preview and full payload.
 * Server stores it for prioritized upload.
 */
stlRouter.post("/packet", async (c) => {
  const auth = c.get("auth");
  const bodyResult = await readJsonBody(c);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = packetCreateSchema.safeParse(bodyResult.body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const { packet_id, trip_id, event_type, payload_json, source_event_ids, lossless_ref, ts_device } = parsed.data;
  const priority = classifyEventPriority(event_type);

  const preview = generatePreview({ event_type, payload_json, ts_device });
  const { preview_bytes, full_bytes } = calculatePacketSize(preview, payload_json);

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      insert into stl_packet_queue (
        packet_id, tenant_id, device_id, trip_id, priority,
        preview_json, full_payload_json, source_event_ids, lossless_ref,
        preview_bytes, full_bytes, status, created_at
      ) values (
        ${packet_id}, ${auth.tenantId}, ${requestDeviceId(c)}, ${trip_id ?? null}, ${priority},
        ${JSON.stringify(preview)}::jsonb, ${JSON.stringify(payload_json)}::jsonb,
        ${JSON.stringify(source_event_ids)}::jsonb, ${lossless_ref},
        ${preview_bytes}, ${full_bytes}, 'QUEUED', now()
      )
      on conflict (tenant_id, packet_id) do update
      set priority = excluded.priority,
          preview_json = excluded.preview_json,
          full_payload_json = excluded.full_payload_json,
          status = 'QUEUED',
          retry_count = 0,
          last_error = null
    `;
  });

  return c.json({
    ok: true,
    packet_id,
    priority,
    preview_bytes,
    full_bytes
  });
});

/**
 * POST /v1/stl/upload - Upload packets based on connectivity
 *
 * Client reports connectivity quality, server determines optimal upload strategy.
 * Returns merged envelope with previews and selected full payloads.
 */
stlRouter.post("/upload", async (c) => {
  const auth = c.get("auth");
  const bodyResult = await readJsonBody(c);
  if (!bodyResult.ok) return bodyResult.response;
  const body = (bodyResult.body ?? {}) as { connectivity?: unknown };
  const connectivityParsed = connectivityReportSchema.safeParse(body.connectivity ?? {});

  // Default to moderate connectivity if not provided
  const connectivity: ConnectivityQuality = connectivityParsed.success
    ? connectivityParsed.data
    : { bandwidth_kbps: 50, latency_ms: 300, packet_loss_rate: 0.1 };

  // Fetch queued packets ordered by priority
  const packetRows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select
        packet_id, tenant_id, device_id, trip_id, priority,
        preview_json, full_payload_json, source_event_ids, lossless_ref,
        preview_bytes, full_bytes, status, retry_count, last_error,
        created_at, uploaded_at, acknowledged_at
      from stl_packet_queue
      where tenant_id = ${auth.tenantId}
        and status in ('QUEUED', 'FAILED')
      order by
        case priority
          when 'CRITICAL' then 1
          when 'HIGH' then 2
          when 'NORMAL' then 3
          when 'LOW' then 4
          when 'BATCH' then 5
        end,
        created_at asc
      limit 100
    `;
  });

  const packets: SemanticPacket[] = packetRows.map(row => ({
    packet_id: row.packet_id as string,
    tenant_id: row.tenant_id as string,
    device_id: row.device_id as string,
    trip_id: row.trip_id as string | undefined,
    priority: row.priority as PacketPriority,
    preview_json: row.preview_json as SemanticPacket['preview_json'],
    full_payload_json: row.full_payload_json as Record<string, unknown> | undefined,
    source_event_ids: row.source_event_ids as string[],
    lossless_ref: row.lossless_ref as string,
    preview_bytes: row.preview_bytes as number,
    full_bytes: row.full_bytes as number,
    status: row.status as SemanticPacket['status'],
    retry_count: row.retry_count as number,
    last_error: row.last_error as string | undefined,
    created_at: row.created_at as string,
    uploaded_at: row.uploaded_at as string | undefined,
    acknowledged_at: row.acknowledged_at as string | undefined
  }));

  if (!packets.length) {
    return c.json({ ok: true, packets: [], total_bytes: 0 });
  }

  const strategy = determineUploadStrategy(connectivity, {
    total_packets: packets.length,
    total_bytes: packets.reduce((sum, p) => sum + p.preview_bytes + p.full_bytes, 0),
    by_priority: {
      CRITICAL: { count: packets.filter(p => p.priority === 'CRITICAL').length, bytes: 0 },
      HIGH: { count: packets.filter(p => p.priority === 'HIGH').length, bytes: 0 },
      NORMAL: { count: packets.filter(p => p.priority === 'NORMAL').length, bytes: 0 },
      LOW: { count: packets.filter(p => p.priority === 'LOW').length, bytes: 0 },
      BATCH: { count: packets.filter(p => p.priority === 'BATCH').length, bytes: 0 }
    },
    retry_pending: 0
  });

  const { preview_envelope, full_payloads, total_bytes } = mergePacketsForUpload(packets, strategy);

  // Mark packets as uploading
  const packetIds = preview_envelope.map(p => p.packet_id);
  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      update stl_packet_queue
      set status = 'UPLOADING', uploaded_at = now()
      where tenant_id = ${auth.tenantId} and packet_id = any(${packetIds})
    `;
  });

  // Emit STL upload event for observability
  await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "ORG",
    subject_id: auth.tenantId,
    actor_id: auth.actorId,
    event_type: "STL_BATCH_UPLOADED",
    payload_json: {
      packet_count: packetIds.length,
      total_bytes,
      strategy_mode: strategy.mode,
      connectivity
    }
  });

  return c.json({
    ok: true,
    strategy: {
      mode: strategy.mode,
      max_packets: strategy.max_packets
    },
    packets: {
      previews: preview_envelope,
      full_payloads
    },
    total_bytes
  });
});

/**
 * POST /v1/stl/ack - Acknowledge successful receipt of packets
 *
 * Client confirms packets were durably stored locally.
 * Server marks them as acknowledged and can release from queue.
 */
stlRouter.post("/ack", async (c) => {
  const auth = c.get("auth");
  const bodyResult = await readJsonBody(c);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = packetAckSchema.safeParse(bodyResult.body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const { packet_ids } = parsed.data;

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      update stl_packet_queue
      set status = 'ACKNOWLEDGED', acknowledged_at = now()
      where tenant_id = ${auth.tenantId} and packet_id = any(${packet_ids})
    `;
  });

  return c.json({ ok: true, acknowledged: packet_ids.length });
});

/**
 * GET /v1/stl/queue - Get packet queue statistics
 *
 * Returns current queue state for monitoring and UI display.
 */
stlRouter.get("/queue", async (c) => {
  const auth = c.get("auth");

  const stats = await withTenant(c.env, auth.tenantId, async (sql) => {
    const rows = await sql`
      select
        priority,
        count(*) as count,
        sum(preview_bytes + full_bytes) as total_bytes,
        min(created_at) as oldest_created
      from stl_packet_queue
      where tenant_id = ${auth.tenantId}
        and status in ('QUEUED', 'UPLOADING', 'FAILED')
      group by priority
    `;

    return rows;
  });

  const queueStats: PacketQueueStats = {
    total_packets: 0,
    total_bytes: 0,
    by_priority: {
      CRITICAL: { count: 0, bytes: 0 },
      HIGH: { count: 0, bytes: 0 },
      NORMAL: { count: 0, bytes: 0 },
      LOW: { count: 0, bytes: 0 },
      BATCH: { count: 0, bytes: 0 }
    },
    retry_pending: 0
  };

  for (const row of stats) {
    const priority = row.priority as PacketPriority;
    const count = parseInt(row.count as string, 10);
    const bytes = parseInt(row.total_bytes as string, 10) || 0;

    queueStats.total_packets += count;
    queueStats.total_bytes += bytes;
    queueStats.by_priority[priority] = { count, bytes };

    if (row.oldest_created && !queueStats.oldest_pending) {
      queueStats.oldest_pending = row.oldest_created as string;
    }
  }

  // Count retry pending
  const retryRows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select count(*) as count
      from stl_packet_queue
      where tenant_id = ${auth.tenantId}
        and status = 'FAILED'
        and retry_count < 5
    `;
  });

  if (retryRows[0]) {
    queueStats.retry_pending = parseInt(retryRows[0].count, 10);
  }

  return c.json({ ok: true, queue: queueStats });
});

/**
 * POST /v1/stl/retry - Retry failed packets
 *
 * Manually trigger retry of failed packets.
 */
stlRouter.post("/retry", async (c) => {
  const auth = c.get("auth");

  const result = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      update stl_packet_queue
      set status = 'QUEUED', retry_count = retry_count + 1, last_error = null
      where tenant_id = ${auth.tenantId}
        and status = 'FAILED'
        and retry_count < 5
      returning packet_id
    `;
  });

  return c.json({
    ok: true,
    retried: result.length,
    packet_ids: result.map(r => r.packet_id)
  });
});
