import { verifyHashChain, type OpsEvent } from "@northline/shared";
import type { Env } from "../types";
import { withTenant } from "./db";

export async function appendEvents(env: Env, tenantId: string, events: OpsEvent[]) {
  if (!events.length) return { accepted: [], rejected: [] as Array<{ event_id: string; reason: string }> };

  const accepted: OpsEvent[] = [];
  const rejected: Array<{ event_id: string; reason: string }> = [];

  await withTenant(env, tenantId, async (sql) => {
    for (const event of events) {
      const chainOk = await verifyHashChain(event);
      if (!chainOk) {
        rejected.push({ event_id: event.event_id, reason: "hash_chain_invalid" });
        continue;
      }

      const dup = await sql`select 1 from ops_event where event_id = ${event.event_id} limit 1`;
      if (dup.length) {
        continue;
      }

      await sql`
        insert into ops_event (
          event_id, tenant_id, subject_type, subject_id, actor_id, device_id,
          ts_device, event_type, schema_version, payload_json, prev_hash, event_hash, signature
        ) values (
          ${event.event_id}, ${event.tenant_id}, ${event.subject_type}, ${event.subject_id}, ${event.actor_id}, ${event.device_id},
          ${event.ts_device}::timestamptz, ${event.event_type}, ${event.schema_version}, ${JSON.stringify(event.payload_json)}::jsonb,
          ${event.prev_hash ?? null}, ${event.event_hash}, ${event.signature}
        )
      `;
      accepted.push(event);
    }
  });

  return { accepted, rejected };
}

export async function eventsSinceCursor(env: Env, tenantId: string, cursor?: string, limit = 1000): Promise<OpsEvent[]> {
  return withTenant(env, tenantId, async (sql) => {
    const rows = cursor
      ? await sql`
        select event_id, tenant_id, subject_type, subject_id, actor_id, device_id,
               ts_device::text, ts_server::text, event_type, schema_version, payload_json,
               prev_hash, event_hash, signature
        from ops_event
        where tenant_id = ${tenantId}
          and ts_server > ${cursor}::timestamptz
        order by ts_server asc
        limit ${limit}
      `
      : await sql`
        select event_id, tenant_id, subject_type, subject_id, actor_id, device_id,
               ts_device::text, ts_server::text, event_type, schema_version, payload_json,
               prev_hash, event_hash, signature
        from ops_event
        where tenant_id = ${tenantId}
        order by ts_server asc
        limit ${limit}
      `;

    return rows as OpsEvent[];
  });
}
