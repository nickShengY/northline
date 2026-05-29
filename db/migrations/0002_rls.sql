-- Row-level security with tenant scoping via current_setting('app.tenant_id')

create or replace function app_current_tenant() returns text
language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::text;
$$;

create or replace function enforce_tenant_column() returns trigger
language plpgsql as $$
begin
  if NEW.tenant_id is null then
    NEW.tenant_id := app_current_tenant();
  end if;

  if NEW.tenant_id is distinct from app_current_tenant() then
    raise exception 'tenant mismatch';
  end if;

  return NEW;
end;
$$;

create or replace procedure enable_rls_with_policy(tbl text)
language plpgsql as $$
begin
  execute format('alter table %I enable row level security', tbl);
  execute format('drop policy if exists tenant_isolation on %I', tbl);
  execute format(
    'create policy tenant_isolation on %I using (tenant_id = app_current_tenant()) with check (tenant_id = app_current_tenant())',
    tbl
  );

  execute format('drop trigger if exists trg_enforce_tenant on %I', tbl);
  execute format(
    'create trigger trg_enforce_tenant before insert or update on %I for each row execute function enforce_tenant_column()',
    tbl
  );
end;
$$;

call enable_rls_with_policy('ops_event');
call enable_rls_with_policy('trip_state');
call enable_rls_with_policy('gear_state_offshore');
call enable_rls_with_policy('gear_state_ice');
call enable_rls_with_policy('compliance_state');
call enable_rls_with_policy('lot_state');
call enable_rls_with_policy('lot_certificate');
call enable_rls_with_policy('hazard_layer_state');
call enable_rls_with_policy('safety_case');
call enable_rls_with_policy('training_state');
call enable_rls_with_policy('artifact_registry');

-- ruleset/risk_policy may include global records (tenant_id null), so custom policies:
alter table ruleset enable row level security;
drop policy if exists ruleset_visibility on ruleset;
create policy ruleset_visibility on ruleset
using (tenant_id = app_current_tenant() or tenant_id is null)
with check (tenant_id = app_current_tenant() or tenant_id is null);

alter table risk_policy enable row level security;
drop policy if exists risk_policy_visibility on risk_policy;
create policy risk_policy_visibility on risk_policy
using (tenant_id = app_current_tenant() or tenant_id is null)
with check (tenant_id = app_current_tenant() or tenant_id is null);

alter table export_template enable row level security;
drop policy if exists export_template_visibility on export_template;
create policy export_template_visibility on export_template
using (true)
with check (true);
