import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dbDir = join(process.cwd(), "..", "db");
const migrationsDir = join(dbDir, "migrations");

function migration(name: string) {
  return readFileSync(join(migrationsDir, name), "utf8");
}

describe("database migration invariants", () => {
  it("keeps migrations ordered without gaps", () => {
    const migrations = readdirSync(migrationsDir)
      .filter((file) => /^\d{4}_.*\.sql$/.test(file))
      .sort();

    expect(migrations).toEqual([
      "0001_init.sql",
      "0002_rls.sql",
      "0003_extensions.sql",
      "0004_workflows.sql",
      "0005_complete_schema.sql",
      "0006_stl_packet_queue.sql",
      "0007_enterprise_hardening.sql",
      "0008_sync_cursor_ack.sql",
      "0009_tenant_composite_keys.sql",
      "0010_tenant_scoped_projection_keys.sql",
      "0011_stripe_billing.sql",
      "0012_firebase_identity_membership.sql"
    ]);
  });

  it("enforces tenant RLS on the audit log", () => {
    const sql = migration("0007_enterprise_hardening.sql");

    expect(sql).toContain("create table if not exists audit_log");
    expect(sql).toContain("alter table audit_log enable row level security");
    expect(sql).toContain("create policy audit_log_tenant_isolation");
    expect(sql).toContain("tenant_id = app_current_tenant()");
    expect(sql).toContain("execute function enforce_tenant_column()");
  });

  it("keeps projection tables protected by tenant RLS", () => {
    const sql = migration("0002_rls.sql");

    for (const table of [
      "ops_event",
      "trip_state",
      "gear_state_offshore",
      "gear_state_ice",
      "hazard_layer_state",
      "artifact_registry"
    ]) {
      expect(sql).toContain(`call enable_rls_with_policy('${table}')`);
    }
  });

  it("persists sync cursor acknowledgements behind tenant RLS", () => {
    const sql = migration("0008_sync_cursor_ack.sql");

    expect(sql).toContain("create table if not exists sync_cursor_ack");
    expect(sql).toContain("cursor text not null");
    expect(sql).toContain("call enable_rls_with_policy('sync_cursor_ack')");
    expect(sql).toContain("idx_sync_cursor_ack_actor_time");
    expect(sql).toContain("idx_sync_cursor_ack_device_time");
  });

  it("scopes tenant-owned natural IDs by tenant", () => {
    const sql = migration("0009_tenant_composite_keys.sql");

    expect(sql).toContain("primary key (tenant_id, trip_id)");
    expect(sql).toContain("primary key (tenant_id, gear_id)");
    expect(sql).toContain("primary key (tenant_id, device_id)");
    expect(sql).toContain("primary key (tenant_id, checkin_id)");
  });

  it("persists Stripe webhook receipts and entitlements behind tenant RLS", () => {
    const sql = migration("0011_stripe_billing.sql");

    expect(sql).toContain("create table if not exists billing_entitlement");
    expect(sql).toContain("create table if not exists stripe_webhook_event");
    expect(sql).toContain("primary key (tenant_id, entitlement_key)");
    expect(sql).toContain("primary key (tenant_id, stripe_event_id)");
    expect(sql).toContain("call enable_rls_with_policy('billing_entitlement')");
    expect(sql).toContain("call enable_rls_with_policy('stripe_webhook_event')");
  });

  it("maps Firebase UIDs to server-owned tenant memberships and roles", () => {
    const sql = migration("0012_firebase_identity_membership.sql");
    expect(sql).toContain("create table if not exists firebase_identity_membership");
    expect(sql).toContain("firebase_uid text primary key");
    expect(sql).toContain("role text not null check");
    expect(sql).toContain("status text not null default 'ACTIVE'");
    expect(sql).toContain("revoke all on firebase_identity_membership from public");
  });

  it("keeps the live Postgres integration gate aligned with every migration file", () => {
    const testSource = readFileSync(join(process.cwd(), "test", "db-integration.test.ts"), "utf8");

    expect(testSource).toContain("readdir(migrationsDir)");
    expect(testSource).toContain("/^\\d{4}_.*\\.sql$/.test(file)");
    expect(testSource).not.toContain("\"0007_enterprise_hardening.sql\"");
  });
});
