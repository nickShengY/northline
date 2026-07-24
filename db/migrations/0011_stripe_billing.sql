-- Stripe remains the external payment source of truth. These rows are a
-- tenant-scoped, idempotent entitlement projection populated only by verified webhooks.
create table if not exists billing_entitlement (
  tenant_id text not null,
  entitlement_key text not null,
  stripe_checkout_session_id text,
  stripe_subscription_id text,
  stripe_customer_id text,
  status text not null,
  stripe_price_id text,
  current_period_end timestamptz,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, entitlement_key)
);

create table if not exists stripe_webhook_event (
  tenant_id text not null,
  stripe_event_id text not null,
  event_type text not null,
  received_at timestamptz not null default now(),
  primary key (tenant_id, stripe_event_id)
);

create index if not exists idx_billing_entitlement_tenant_status
  on billing_entitlement (tenant_id, status, updated_at desc);

call enable_rls_with_policy('billing_entitlement');
call enable_rls_with_policy('stripe_webhook_event');
