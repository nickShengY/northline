import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.NORTHLINE_TEST_DATABASE_URL;
const run = databaseUrl ? describe : describe.skip;

async function applyMigrations(client: Client, schema: string) {
  const migrationsDir = join("..", "db", "migrations");
  const migrations = (await readdir(migrationsDir))
    .filter((file) => /^\d{4}_.*\.sql$/.test(file))
    .sort();

  await client.query(`create schema ${schema}`);
  await client.query(`set search_path to ${schema}, public`);

  for (const migration of migrations) {
    const sql = await readFile(join(migrationsDir, migration), "utf8");
    await client.query(sql);
  }
}

run("postgres integration migrations", () => {
  it("applies migrations and enforces tenant triggers against audit rows", async () => {
    const schema = `northline_it_${randomUUID().replace(/-/g, "")}`;
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    try {
      await applyMigrations(client, schema);
      await client.query("select set_config('app.tenant_id', $1, false)", ["tenant_a"]);
      await client.query(
        `
          insert into audit_log (
            audit_id, tenant_id, actor_id, actor_role, action, subject_type, subject_id, outcome
          )
          values ('audit_1', 'tenant_a', 'actor_1', 'ORG_ADMIN', 'DEVICE_REGISTER', 'DEVICE', 'device_1', 'SUCCESS')
        `
      );

      const ok = await client.query("select count(*)::int as count from audit_log where tenant_id = 'tenant_a'");
      expect(ok.rows[0].count).toBe(1);

      await client.query(
        `
          insert into sync_cursor_ack (
            ack_id, tenant_id, actor_id, device_id, cursor
          )
          values ('ack_1', 'tenant_a', 'actor_1', 'device_1', '2026-05-31T00:00:00.000Z|evt_1')
        `
      );

      const ack = await client.query("select count(*)::int as count from sync_cursor_ack where tenant_id = 'tenant_a'");
      expect(ack.rows[0].count).toBe(1);

      await expect(
        client.query(
          `
            insert into audit_log (
              audit_id, tenant_id, actor_id, actor_role, action, subject_type, subject_id, outcome
            )
            values ('audit_2', 'tenant_b', 'actor_1', 'ORG_ADMIN', 'DEVICE_REGISTER', 'DEVICE', 'device_2', 'SUCCESS')
          `
        )
      ).rejects.toThrow(/tenant mismatch/);
    } finally {
      await client.query(`drop schema if exists ${schema} cascade`);
      await client.end();
    }
  });
});
