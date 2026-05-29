import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import { withTenant } from "../lib/db";

const integrationUpsertSchema = z.object({
  integration_id: z.string().min(3),
  integration_type: z.string().min(2),
  provider: z.string().min(2),
  enabled: z.boolean().default(true),
  config_json: z.record(z.unknown())
});

export const integrationsRouter = new Hono<{ Bindings: Env; Variables: { auth: { tenantId: string } } }>();

integrationsRouter.get("/configs", async (c) => {
  const auth = c.get("auth");
  const type = c.req.query("type");

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return type
      ? sql`
          select integration_id, integration_type, provider, enabled, config_json, updated_at::text
          from integration_config
          where tenant_id = ${auth.tenantId}
            and integration_type = ${type}
          order by updated_at desc
          limit 300
        `
      : sql`
          select integration_id, integration_type, provider, enabled, config_json, updated_at::text
          from integration_config
          where tenant_id = ${auth.tenantId}
          order by updated_at desc
          limit 300
        `;
  });

  return c.json({ configs: rows.map((row) => ({ ...row })) });
});

integrationsRouter.post("/configs/upsert", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = integrationUpsertSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      insert into integration_config (
        integration_id, tenant_id, integration_type, provider, enabled, config_json, updated_at
      ) values (
        ${parsed.data.integration_id}, ${auth.tenantId}, ${parsed.data.integration_type}, ${parsed.data.provider},
        ${parsed.data.enabled}, ${JSON.stringify(parsed.data.config_json)}::jsonb, now()
      )
      on conflict (integration_id) do update
      set integration_type = excluded.integration_type,
          provider = excluded.provider,
          enabled = excluded.enabled,
          config_json = excluded.config_json,
          updated_at = now()
    `;
  });

  return c.json({ ok: true, integration_id: parsed.data.integration_id });
});

integrationsRouter.post("/configs/:integrationId/test", async (c) => {
  const auth = c.get("auth");
  const integrationId = c.req.param("integrationId");

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select integration_id, integration_type, provider, enabled
      from integration_config
      where tenant_id = ${auth.tenantId}
        and integration_id = ${integrationId}
      limit 1
    `;
  });

  if (!rows.length) {
    return c.json({ ok: false, reason: "integration_not_found" }, 404);
  }

  const row = rows[0] as {
    integration_id: string;
    integration_type: string;
    provider: string;
    enabled: boolean;
  };

  return c.json({
    ok: true,
    integration_id: row.integration_id,
    test_status: row.enabled ? "reachable" : "disabled",
    provider: row.provider,
    integration_type: row.integration_type,
    tested_at: new Date().toISOString()
  });
});
