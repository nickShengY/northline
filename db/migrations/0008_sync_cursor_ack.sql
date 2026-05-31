-- Durable sync cursor acknowledgement history for offline clients.

create table if not exists sync_cursor_ack (
  ack_id text primary key,
  tenant_id text not null,
  actor_id text not null,
  device_id text,
  scope text not null default 'default',
  cursor text not null,
  request_id text,
  user_agent text,
  acknowledged_at timestamptz not null default now()
);

create index if not exists idx_sync_cursor_ack_actor_time
  on sync_cursor_ack(tenant_id, actor_id, acknowledged_at desc);

create index if not exists idx_sync_cursor_ack_device_time
  on sync_cursor_ack(tenant_id, device_id, acknowledged_at desc)
  where device_id is not null;

call enable_rls_with_policy('sync_cursor_ack');
