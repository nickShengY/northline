import { computeEventHash } from "@northline/shared";
import type { SubjectType } from "@northline/shared";
import type { Env } from "../types";
import { withTenant } from "./db";
import { signServerEventHash } from "./signature";

export interface ServerEventInput {
  subject_type: SubjectType;
  subject_id: string;
  actor_id: string;
  device_id?: string;
  event_type: string;
  payload_json: Record<string, unknown>;
  schema_version?: number;
}

export interface AppendedServerEvent {
  event_id: string;
  ts_device: string;
  prev_hash?: string;
  event_hash: string;
}

export async function appendServerEvent(env: Env, tenantId: string, input: ServerEventInput): Promise<AppendedServerEvent> {
  const event_id = `srv_${crypto.randomUUID().replace(/-/g, "")}`;
  const ts_device = new Date().toISOString();
  const schema_version = input.schema_version ?? 1;

  return withTenant(env, tenantId, async (sql) => {
    const prev = await sql`
      select event_hash
      from ops_event
      where tenant_id = ${tenantId} and subject_id = ${input.subject_id}
      order by ts_server desc
      limit 1
    `;

    const prev_hash = prev[0]?.event_hash ? String(prev[0].event_hash) : undefined;

    const eventEnvelope = {
      event_id,
      tenant_id: tenantId,
      subject_type: input.subject_type,
      subject_id: input.subject_id,
      actor_id: input.actor_id,
      device_id: input.device_id ?? "server",
      ts_device,
      event_type: input.event_type,
      schema_version,
      payload_json: input.payload_json,
      prev_hash,
      signature: ""
    };

    const event_hash = await computeEventHash(eventEnvelope);
    const signature = await signServerEventHash(env, event_hash);

    await sql`
      insert into ops_event (
        event_id, tenant_id, subject_type, subject_id, actor_id, device_id,
        ts_device, event_type, schema_version, payload_json, prev_hash, event_hash, signature
      ) values (
        ${event_id}, ${tenantId}, ${input.subject_type}, ${input.subject_id}, ${input.actor_id}, ${input.device_id ?? "server"},
        ${ts_device}::timestamptz, ${input.event_type}, ${schema_version}, ${JSON.stringify(input.payload_json)}::jsonb,
        ${prev_hash ?? null}, ${event_hash}, ${signature}
      )
    `;

    return {
      event_id,
      ts_device,
      prev_hash,
      event_hash
    };
  });
}
