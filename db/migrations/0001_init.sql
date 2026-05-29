-- Northline core schema
create extension if not exists pgcrypto;

create table if not exists ops_event (
  event_id text primary key,
  tenant_id text not null,
  subject_type text not null check (subject_type in ('VESSEL', 'USER', 'GROUP', 'ORG')),
  subject_id text not null,
  actor_id text not null,
  device_id text not null,
  ts_device timestamptz not null,
  ts_server timestamptz not null default now(),
  event_type text not null,
  schema_version integer not null,
  payload_json jsonb not null,
  prev_hash text,
  event_hash text not null,
  signature text not null,
  unique (tenant_id, subject_id, event_id)
);

create index if not exists idx_ops_event_tenant_ts on ops_event(tenant_id, ts_server);
create index if not exists idx_ops_event_subject_ts on ops_event(tenant_id, subject_id, ts_server);
create index if not exists idx_ops_event_type on ops_event(tenant_id, event_type);

create table if not exists trip_state (
  trip_id text primary key,
  tenant_id text not null,
  mode text not null check (mode in ('OFFSHORE', 'ICE')),
  owner_id text not null,
  status text not null check (status in ('PLANNED', 'ACTIVE', 'ENDED', 'CANCELLED')),
  started_at timestamptz,
  ended_at timestamptz,
  location_name text,
  completion_meter integer not null default 0,
  compliance_open_issues integer not null default 0,
  latest_risk_tier text not null default 'LOW',
  updated_at timestamptz not null default now()
);

create table if not exists gear_state_offshore (
  gear_id text primary key,
  tenant_id text not null,
  trip_id text not null,
  status text not null,
  buoy_label text,
  pot_count integer,
  line_length_m integer,
  target_depth_m integer,
  set_time timestamptz,
  last_position jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists gear_state_ice (
  gear_id text primary key,
  tenant_id text not null,
  trip_id text not null,
  station_id text,
  status text not null,
  tipup_type text,
  bait text,
  depth_m numeric(5,2),
  check_interval_min integer,
  last_position jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists compliance_state (
  pkg_id text primary key,
  tenant_id text not null,
  trip_id text not null,
  completion_meter integer not null,
  open_errors integer not null,
  warnings integer not null,
  status text not null,
  details_json jsonb not null,
  signed_by text,
  signed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists lot_state (
  lot_id text primary key,
  tenant_id text not null,
  trip_id text not null,
  mode text not null check (mode in ('OFFSHORE', 'ICE')),
  totals_json jsonb not null,
  quality_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists lot_certificate (
  certificate_id text primary key,
  tenant_id text not null,
  lot_id text not null,
  trip_id text not null,
  hash text not null,
  artifact_key text not null,
  issued_by text not null,
  issued_at timestamptz not null,
  provenance_event_ids jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists hazard_layer_state (
  hazard_id text primary key,
  tenant_id text not null,
  type text not null,
  severity integer not null check (severity between 1 and 5),
  confidence numeric(4,3) not null,
  location jsonb not null,
  sharing_scope text not null,
  reported_by text not null,
  confirmed_count integer not null default 0,
  ts_last_update timestamptz not null default now()
);

create table if not exists safety_case (
  case_id text primary key,
  tenant_id text not null,
  trip_id text,
  category text not null,
  severity integer not null,
  status text not null,
  summary text not null,
  action_taken text,
  media_refs jsonb,
  opened_by text not null,
  opened_at timestamptz not null,
  closed_at timestamptz
);

create table if not exists training_state (
  assign_id text primary key,
  tenant_id text not null,
  user_id text not null,
  module_id text not null,
  reason text not null,
  status text not null,
  due_at timestamptz,
  completed_at timestamptz,
  score integer,
  created_at timestamptz not null default now()
);

create table if not exists ruleset (
  ruleset_id text primary key,
  tenant_id text,
  mode text not null check (mode in ('OFFSHORE', 'ICE')),
  region_code text not null,
  effective_from date not null,
  effective_to date,
  priority integer not null default 100,
  rules_json jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists risk_policy (
  policy_id text primary key,
  tenant_id text,
  mode text,
  policy_json jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists export_template (
  template_id text primary key,
  mode text not null,
  kind text not null,
  schema_version integer not null,
  template_json jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists artifact_registry (
  artifact_id text primary key,
  tenant_id text not null,
  artifact_kind text not null,
  object_key text not null,
  content_hash text not null,
  provenance_event_ids jsonb not null,
  metadata_json jsonb,
  created_at timestamptz not null default now()
);
