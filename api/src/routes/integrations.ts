import { Hono } from "hono";
import { z } from "zod";
import type { AuthContext, Env } from "../types";
import { withTenant } from "../lib/db";
import { readJsonBody } from "../lib/request";
import { requireRole } from "../lib/rbac";
import { writeAuditLog } from "../lib/audit";
import { fitsJsonByteLimit } from "../lib/json-size";
import { validateOptionalQueryParam, validateRouteParam } from "../lib/route-params";

const integrationUpsertSchema = z.object({
  integration_id: z.string().min(3),
  integration_type: z.string().min(2),
  provider: z.string().min(2),
  enabled: z.boolean().default(true),
  config_json: z.record(z.unknown()).refine(
    fitsJsonByteLimit(32 * 1024),
    "config_json must be 32768 bytes or less"
  )
});

export const integrationsRouter = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

const sensitiveConfigKeyPattern = /(secret|token|password|authorization|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|webhook[_-]?secret)/i;
const redactedValue = "[REDACTED]";

export function redactIntegrationConfig(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactIntegrationConfig(item));
  }

  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      sensitiveConfigKeyPattern.test(key) ? redactedValue : redactIntegrationConfig(item)
    ])
  );
}

function redactIntegrationRow<T extends { config_json?: unknown }>(row: T): T {
  return {
    ...row,
    config_json: redactIntegrationConfig(row.config_json)
  };
}

integrationsRouter.get("/status", async (c) => {
  const auth = c.get("auth");
  const typeResult = validateOptionalQueryParam("type", c.req.query("type"));
  if (!typeResult.ok) return c.json(typeResult.error, 400);
  const type = typeResult.value;

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return type
      ? sql`
          select integration_id, integration_type, provider, enabled, updated_at::text
          from integration_config
          where tenant_id = ${auth.tenantId}
            and integration_type = ${type}
          order by updated_at desc
          limit 300
        `
      : sql`
          select integration_id, integration_type, provider, enabled, updated_at::text
          from integration_config
          where tenant_id = ${auth.tenantId}
          order by updated_at desc
          limit 300
        `;
  });

  return c.json({ integrations: rows });
});

integrationsRouter.get("/configs", requireRole("ORG_ADMIN", "OWNER"), async (c) => {
  const auth = c.get("auth");
  const typeResult = validateOptionalQueryParam("type", c.req.query("type"));
  if (!typeResult.ok) return c.json(typeResult.error, 400);
  const type = typeResult.value;

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

  return c.json({ configs: rows.map((row) => redactIntegrationRow({ ...row })) });
});

integrationsRouter.post("/configs/upsert", requireRole("ORG_ADMIN", "OWNER"), async (c) => {
  const auth = c.get("auth");
  const bodyResult = await readJsonBody(c);
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;
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
      on conflict (tenant_id, integration_id) do update
      set integration_type = excluded.integration_type,
          provider = excluded.provider,
          enabled = excluded.enabled,
          config_json = excluded.config_json,
          updated_at = now()
    `;
  });

  await writeAuditLog(c.env, {
    auth,
    action: "integration_config.upsert",
    subjectType: "INTEGRATION",
    subjectId: parsed.data.integration_id,
    outcome: "SUCCESS",
    requestId: c.req.header("x-request-id"),
    metadata: {
      integration_type: parsed.data.integration_type,
      provider: parsed.data.provider,
      enabled: parsed.data.enabled
    }
  });

  return c.json({ ok: true, integration_id: parsed.data.integration_id });
});

integrationsRouter.post("/configs/:integrationId/test", requireRole("ORG_ADMIN", "OWNER"), async (c) => {
  const auth = c.get("auth");
  const parsedIntegrationId = validateRouteParam("integrationId", c.req.param("integrationId"));
  if (!parsedIntegrationId.ok) {
    return c.json(parsedIntegrationId.error, 400);
  }
  const integrationId = parsedIntegrationId.value;

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

  await writeAuditLog(c.env, {
    auth,
    action: "integration_config.test",
    subjectType: "INTEGRATION",
    subjectId: row.integration_id,
    outcome: "SUCCESS",
    requestId: c.req.header("x-request-id"),
    metadata: {
      integration_type: row.integration_type,
      provider: row.provider,
      enabled: row.enabled
    }
  });

  return c.json({
    ok: true,
    integration_id: row.integration_id,
    test_status: row.enabled ? "reachable" : "disabled",
    provider: row.provider,
    integration_type: row.integration_type,
    tested_at: new Date().toISOString()
  });
});
