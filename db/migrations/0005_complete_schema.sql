-- Northline complete schema: catch records, stations, routes, safety workflows, ice thickness

-- Catch records table for individual fish/haul records
create table if not exists catch_record (
  catch_id text primary key,
  tenant_id text not null,
  trip_id text not null,
  cycle_id text,
  mode text not null check (mode in ('OFFSHORE', 'ICE')),
  species text not null,
  kept boolean not null default true,
  release_reason text,
  length_cm numeric(8,2),
  weight_kg numeric(10,3),
  station_id text,
  gear_id text,
  method text,
  location jsonb,
  photo_refs jsonb,
  measurement_confidence numeric(4,3),
  qa_flagged boolean not null default false,
  qa_reason text,
  recorded_by text not null,
  recorded_at timestamptz not null default now(),
  corrected_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_catch_record_trip on catch_record(tenant_id, trip_id, recorded_at desc);
create index if not exists idx_catch_record_cycle on catch_record(tenant_id, cycle_id);
create index if not exists idx_catch_record_species on catch_record(tenant_id, species);

-- Ice stations table
create table if not exists station_state (
  station_id text primary key,
  tenant_id text not null,
  trip_id text not null,
  name text not null,
  status text not null check (status in ('ACTIVE', 'ARCHIVED', 'REMOVED')),
  hole_count integer not null default 0,
  tipup_count integer not null default 0,
  location jsonb not null,
  notes text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_station_state_trip on station_state(tenant_id, trip_id, updated_at desc);

-- Ice thickness logs
create table if not exists ice_thickness_log (
  log_id text primary key,
  tenant_id text not null,
  trip_id text not null,
  station_id text,
  thickness_cm numeric(6,2) not null,
  confidence numeric(4,3) not null default 0.5,
  location jsonb not null,
  photo_ref text,
  notes text,
  logged_by text not null,
  logged_at timestamptz not null default now()
);

create index if not exists idx_ice_thickness_trip on ice_thickness_log(tenant_id, trip_id, logged_at desc);
create index if not exists idx_ice_thickness_location on ice_thickness_log(tenant_id, location);

-- Route points for ice mode
create table if not exists route_point (
  point_id text primary key,
  tenant_id text not null,
  trip_id text not null,
  sequence integer not null,
  point_type text not null check (point_type in ('WAYPOINT', 'HAZARD_AVOID', 'STATION', 'ACCESS_POINT', 'SHELTER')),
  location jsonb not null,
  notes text,
  logged_by text not null,
  logged_at timestamptz not null default now()
);

create index if not exists idx_route_point_trip on route_point(tenant_id, trip_id, sequence);

-- Safety briefings table
create table if not exists safety_briefing (
  briefing_id text primary key,
  tenant_id text not null,
  trip_id text not null,
  mode text not null check (mode in ('OFFSHORE', 'ICE')),
  briefing_type text not null check (briefing_type in ('PRE_TRIP', 'TOOLBOX_TALK', 'STORM_PREP', 'HAZARD_ALERT')),
  checklist_json jsonb not null,
  acknowledged_by jsonb not null default '[]'::jsonb,
  acknowledged_at timestamptz,
  delivered_by text not null,
  delivered_at timestamptz not null default now()
);

create index if not exists idx_safety_briefing_trip on safety_briefing(tenant_id, trip_id, delivered_at desc);

-- MOB (Man Overboard) workflow state
create table if not exists mob_workflow_state (
  workflow_id text primary key,
  tenant_id text not null,
  trip_id text not null,
  status text not null check (status in ('ACTIVE', 'RESCUED', 'STOOD_DOWN')),
  victim_id text,
  last_known_location jsonb,
  started_at timestamptz not null default now(),
  started_by text not null,
  checklist_json jsonb not null default '{}'::jsonb,
  roles_assigned jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by text,
  notes text
);

create index if not exists idx_mob_workflow_trip on mob_workflow_state(tenant_id, trip_id, started_at desc);

-- Stop-work events
create table if not exists stop_work_state (
  stop_id text primary key,
  tenant_id text not null,
  trip_id text not null,
  reason text not null,
  severity integer not null check (severity between 1 and 5),
  status text not null check (status in ('ACTIVE', 'CLEARED')),
  initiated_by text not null,
  initiated_at timestamptz not null default now(),
  acknowledged_by text,
  acknowledged_at timestamptz,
  cleared_by text,
  cleared_at timestamptz,
  resolution_notes text
);

create index if not exists idx_stop_work_trip on stop_work_state(tenant_id, trip_id, initiated_at desc);

-- Gear recovery plans
create table if not exists gear_recovery_plan (
  plan_id text primary key,
  tenant_id text not null,
  trip_id text not null,
  gear_ids jsonb not null,
  search_lanes jsonb not null default '[]'::jsonb,
  priority_order jsonb not null default '[]'::jsonb,
  status text not null check (status in ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  created_by text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  notes text
);

create index if not exists idx_gear_recovery_trip on gear_recovery_plan(tenant_id, trip_id, created_at desc);

-- Return plans for ice mode
create table if not exists return_plan (
  plan_id text primary key,
  tenant_id text not null,
  trip_id text not null,
  return_by timestamptz not null,
  access_point text,
  route_summary jsonb,
  escalation_contacts jsonb not null default '[]'::jsonb,
  status text not null check (status in ('SET', 'ESCALATED', 'COMPLETED', 'MISSED')),
  set_by text not null,
  set_at timestamptz not null default now(),
  escalated_at timestamptz,
  completed_at timestamptz
);

create index if not exists idx_return_plan_trip on return_plan(tenant_id, trip_id);

-- Apply RLS policies
call enable_rls_with_policy('catch_record');
call enable_rls_with_policy('station_state');
call enable_rls_with_policy('ice_thickness_log');
call enable_rls_with_policy('route_point');
call enable_rls_with_policy('safety_briefing');
call enable_rls_with_policy('mob_workflow_state');
call enable_rls_with_policy('stop_work_state');
call enable_rls_with_policy('gear_recovery_plan');
call enable_rls_with_policy('return_plan');
