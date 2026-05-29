-- Northline workflow tables for check-ins and scan ingestion batches

create table if not exists checkin_state (
  checkin_id text primary key,
  tenant_id text not null,
  trip_id text not null,
  due_at timestamptz,
  completed_at timestamptz,
  status text not null check (status in ('SCHEDULED', 'COMPLETED', 'MISSED', 'ESCALATED')),
  location_json jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_checkin_state_trip on checkin_state(tenant_id, trip_id, updated_at desc);

create table if not exists lot_scan_batch (
  batch_id text primary key,
  tenant_id text not null,
  lot_id text not null,
  trip_id text not null,
  source text not null check (source in ('API', 'CSV', 'JSON', 'MANUAL')),
  species_totals jsonb not null,
  mismatch_rate numeric(7,6) not null,
  expected_total integer not null,
  observed_total integer not null,
  requires_review boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_lot_scan_batch_lot on lot_scan_batch(tenant_id, lot_id, created_at desc);

call enable_rls_with_policy('checkin_state');
call enable_rls_with_policy('lot_scan_batch');
