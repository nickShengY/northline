-- Northline extension schema: cycle rollups, module catalogs, integration config, and sync observability

create table if not exists haul_cycle_state (
  cycle_id text primary key,
  tenant_id text not null,
  trip_id text not null,
  mode text not null check (mode in ('OFFSHORE', 'ICE')),
  status text not null,
  started_at timestamptz,
  ended_at timestamptz,
  gear_ids jsonb not null default '[]'::jsonb,
  notes text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_haul_cycle_tenant_trip on haul_cycle_state(tenant_id, trip_id, updated_at desc);

create table if not exists catch_rollups (
  rollup_id text primary key,
  tenant_id text not null,
  trip_id text not null,
  cycle_id text,
  mode text not null check (mode in ('OFFSHORE', 'ICE')),
  species text not null,
  kept_count integer not null default 0,
  released_count integer not null default 0,
  total_weight_kg numeric(10,2),
  total_length_cm numeric(10,2),
  evidence_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists idx_catch_rollups_trip on catch_rollups(tenant_id, trip_id, updated_at desc);

create table if not exists training_module (
  module_id text primary key,
  tenant_id text,
  mode text not null check (mode in ('OFFSHORE', 'ICE', 'BOTH')),
  title text not null,
  duration_sec integer not null,
  quiz_json jsonb,
  prerequisites jsonb not null default '[]'::jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists integration_config (
  integration_id text primary key,
  tenant_id text not null,
  integration_type text not null,
  provider text not null,
  enabled boolean not null default true,
  config_json jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists sync_device (
  device_id text primary key,
  tenant_id text not null,
  subject_type text not null check (subject_type in ('VESSEL', 'USER', 'GROUP', 'ORG')),
  subject_id text not null,
  public_key text not null,
  key_version integer not null default 1,
  revoked boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists sync_health_metric (
  metric_id text primary key,
  tenant_id text not null,
  device_id text,
  metric_name text not null,
  metric_value numeric(14,4) not null,
  dimension_json jsonb,
  measured_at timestamptz not null default now()
);

create index if not exists idx_sync_health_metric_tenant_name_time
  on sync_health_metric(tenant_id, metric_name, measured_at desc);

-- Apply RLS policies for tenant-scoped extension tables.
call enable_rls_with_policy('haul_cycle_state');
call enable_rls_with_policy('catch_rollups');
call enable_rls_with_policy('integration_config');
call enable_rls_with_policy('sync_device');
call enable_rls_with_policy('sync_health_metric');

-- training_module supports both tenant and global templates.
alter table training_module enable row level security;
drop policy if exists training_module_visibility on training_module;
create policy training_module_visibility on training_module
using (tenant_id = app_current_tenant() or tenant_id is null)
with check (tenant_id = app_current_tenant() or tenant_id is null);
