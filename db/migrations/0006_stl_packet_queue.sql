-- Semantic Transport Layer (STL) packet queue
-- Stores prioritized packets for optimized sync under weak connectivity

create table if not exists stl_packet_queue (
  packet_id text primary key,
  tenant_id text not null,
  device_id text not null,
  trip_id text,

  -- Priority determines upload order
  priority text not null check (priority in ('CRITICAL', 'HIGH', 'NORMAL', 'LOW', 'BATCH')),

  -- Semantic preview - compact representation for quick display
  preview_json jsonb not null,

  -- Full payload - uploaded when connectivity permits
  full_payload_json jsonb,

  -- Original event IDs this packet represents
  source_event_ids jsonb not null,

  -- Lossless reference - ensures audit trail integrity
  lossless_ref text not null,

  -- Size metadata
  preview_bytes integer not null,
  full_bytes integer not null,

  -- Status tracking
  status text not null default 'QUEUED' check (status in ('QUEUED', 'UPLOADING', 'UPLOADED', 'ACKNOWLEDGED', 'FAILED')),
  retry_count integer not null default 0,
  last_error text,

  -- Timestamps
  created_at timestamptz not null default now(),
  uploaded_at timestamptz,
  acknowledged_at timestamptz,

  unique (tenant_id, packet_id)
);

-- Indexes for efficient queue queries
create index if not exists idx_stl_packet_tenant_status on stl_packet_queue(tenant_id, status);
create index if not exists idx_stl_packet_tenant_priority on stl_packet_queue(tenant_id, priority, created_at);
create index if not exists idx_stl_packet_device on stl_packet_queue(device_id, status);

-- RLS policies
alter table stl_packet_queue enable row level security;

drop policy if exists "stl_packets_tenant_isolated" on stl_packet_queue;
create policy "stl_packets_tenant_isolated" on stl_packet_queue
  using (tenant_id = current_setting('app.tenant_id')::text);

drop policy if exists "stl_packets_insert_tenant" on stl_packet_queue;
create policy "stl_packets_insert_tenant" on stl_packet_queue
  for insert with check (tenant_id = current_setting('app.tenant_id')::text);

drop policy if exists "stl_packets_update_tenant" on stl_packet_queue;
create policy "stl_packets_update_tenant" on stl_packet_queue
  for update using (tenant_id = current_setting('app.tenant_id')::text);

-- Add STL events to event catalog
comment on table stl_packet_queue is 'Semantic Transport Layer packet queue for optimized sync under weak connectivity';
