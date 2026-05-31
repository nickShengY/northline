-- Enterprise hardening primitives: immutable audit trail for sensitive actions.

create table if not exists audit_log (
  audit_id text primary key,
  tenant_id text not null,
  actor_id text not null,
  actor_role text not null,
  action text not null,
  subject_type text not null,
  subject_id text not null,
  outcome text not null check (outcome in ('SUCCESS', 'DENIED', 'FAILED')),
  request_id text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_log_tenant_created on audit_log(tenant_id, created_at desc);
create index if not exists idx_audit_log_actor_created on audit_log(tenant_id, actor_id, created_at desc);
create index if not exists idx_audit_log_subject_created on audit_log(tenant_id, subject_type, subject_id, created_at desc);

alter table audit_log enable row level security;

drop policy if exists audit_log_tenant_isolation on audit_log;
create policy audit_log_tenant_isolation on audit_log
using (tenant_id = app_current_tenant())
with check (tenant_id = app_current_tenant());

drop trigger if exists trg_enforce_tenant on audit_log;
create trigger trg_enforce_tenant before insert or update on audit_log
for each row execute function enforce_tenant_column();

