-- Server-owned Firebase identity mapping. Firebase tokens establish identity only;
-- tenant and role always come from this table or the temporary deployment bootstrap.
create table if not exists firebase_identity_membership (
  firebase_uid text primary key,
  tenant_id text not null,
  role text not null check (role in ('CAPTAIN', 'CREW', 'OWNER', 'GUIDE', 'PROCESSOR', 'ORG_ADMIN')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_firebase_identity_membership_tenant
  on firebase_identity_membership (tenant_id, status);

-- Deliberately no tenant RLS policy: this table establishes tenant scope and must
-- only be read/written using the privileged server database credential.
revoke all on firebase_identity_membership from public;
