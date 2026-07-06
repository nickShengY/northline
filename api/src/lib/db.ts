import { neon } from "@neondatabase/serverless";
import type { Env } from "../types";

export type SqlValue = string | number | boolean | null | object;
export type SqlQuery = (strings: TemplateStringsArray, ...values: SqlValue[]) => Promise<any[]>;

function templateToParameterized(strings: TemplateStringsArray, values: SqlValue[]) {
  let query = strings[0] ?? "";

  for (let i = 0; i < values.length; i += 1) {
    query += `$${i + 1}`;
    query += strings[i + 1] ?? "";
  }

  return query;
}

export function getSql(env: Env) {
  if (!env.NEON_DATABASE_URL) {
    throw new Error("NEON_DATABASE_URL is required for database access");
  }

  return neon(env.NEON_DATABASE_URL);
}

function shouldUseNodePostgres(connectionString: string) {
  try {
    const url = new URL(connectionString);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  } catch {
    return false;
  }
}

export async function pingDatabase(env: Env): Promise<void> {
  if (!env.NEON_DATABASE_URL) {
    throw new Error("NEON_DATABASE_URL is required for database access");
  }

  if (shouldUseNodePostgres(env.NEON_DATABASE_URL)) {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: env.NEON_DATABASE_URL });
    await client.connect();
    try {
      await client.query("select 1");
    } finally {
      await client.end();
    }
    return;
  }

  const sql = getSql(env);
  await sql`select 1`;
}

export async function withTenant<T>(
  env: Env,
  tenantId: string,
  fn: (sql: SqlQuery) => Promise<T>
): Promise<T> {
  if (env.NEON_DATABASE_URL && shouldUseNodePostgres(env.NEON_DATABASE_URL)) {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: env.NEON_DATABASE_URL });
    await client.connect();
    try {
      await client.query("select set_config('app.tenant_id', $1, false)", [tenantId]);

      const tenantScopedSql: SqlQuery = async (strings, ...values) => {
        const query = templateToParameterized(strings, values);
        const result = await client.query(query, values);
        return result.rows as any[];
      };

      return await fn(tenantScopedSql);
    } finally {
      await client.end();
    }
  }

  const sql = getSql(env);

  // The Neon HTTP driver has no session state, so each statement runs
  // set_config as its own transaction-local statement in a two-statement
  // transaction. An unreferenced CTE would never be evaluated by Postgres,
  // so the GUC would silently stay unset; the explicit transaction batch
  // guarantees the tenant GUC is applied before the query executes.
  // All queries additionally carry explicit tenant predicates as
  // defense in depth.
  const tenantScopedSql: SqlQuery = async (strings, ...values) => {
    const query = templateToParameterized(strings, values);
    const results = await sql.transaction((txn) => [
      txn("select set_config('app.tenant_id', $1, true)", [tenantId]),
      txn(query, values as unknown[])
    ]);
    return (results[1] ?? []) as any[];
  };

  return fn(tenantScopedSql);
}
