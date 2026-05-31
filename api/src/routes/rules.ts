import { Hono } from "hono";
import { z } from "zod";
import type { AuthContext, Env } from "../types";
import { withTenant } from "../lib/db";
import { appendServerEvent } from "../lib/server-events";
import { requireRole } from "../lib/rbac";
import { writeAuditLog } from "../lib/audit";
import { fitsJsonByteLimit } from "../lib/json-size";
import { validateOptionalQueryParam } from "../lib/route-params";

const modeSchema = z.enum(["OFFSHORE", "ICE"]);

const rulesetUpsertSchema = z.object({
  ruleset_id: z.string().min(3),
  mode: modeSchema,
  region_code: z.string().min(2),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  priority: z.number().int().min(1).default(100),
  rules_json: z.record(z.unknown()).refine(
    fitsJsonByteLimit(64 * 1024),
    "rules_json must be 65536 bytes or less"
  )
});

const riskPolicyUpsertSchema = z.object({
  policy_id: z.string().min(3),
  mode: modeSchema.optional(),
  policy_json: z.record(z.unknown()).refine(
    fitsJsonByteLimit(32 * 1024),
    "policy_json must be 32768 bytes or less"
  )
});

export const rulesRouter = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

rulesRouter.get("/effective", async (c) => {
  const auth = c.get("auth");
  const modeResult = modeSchema.safeParse(c.req.query("mode"));
  const regionResult = validateOptionalQueryParam("region", c.req.query("region"));
  if (!regionResult.ok) return c.json(regionResult.error, 400);
  const regionCode = regionResult.value ?? "default";
  const effectiveDateResult = validateOptionalQueryParam("effective_date", c.req.query("effective_date"), {
    maxLength: 10,
    pattern: /^\d{4}-\d{2}-\d{2}$/
  });
  if (!effectiveDateResult.ok) return c.json(effectiveDateResult.error, 400);
  const effectiveDate = effectiveDateResult.value ?? new Date().toISOString().slice(0, 10);

  if (!modeResult.success) {
    return c.json({ error: "invalid_mode" }, 400);
  }

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select ruleset_id, tenant_id, mode, region_code, effective_from::text, effective_to::text, priority, rules_json
      from ruleset
      where mode = ${modeResult.data}
        and region_code = ${regionCode}
        and effective_from <= ${effectiveDate}::date
        and (effective_to is null or effective_to >= ${effectiveDate}::date)
      order by case when tenant_id is null then 1 else 0 end, priority asc, effective_from desc
      limit 1
    `;
  });

  if (!rows.length) {
    return c.json({ found: false, reason: "ruleset_not_found" }, 404);
  }

  return c.json({ found: true, ruleset: rows[0] });
});

rulesRouter.get("/risk-policy", async (c) => {
  const auth = c.get("auth");
  const modeResult = modeSchema.optional().safeParse(c.req.query("mode"));
  if (!modeResult.success) return c.json({ error: "invalid_mode" }, 400);
  const mode = modeResult.data;

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return mode
      ? sql`
          select policy_id, tenant_id, mode, policy_json, created_at::text
          from risk_policy
          where mode = ${mode}
          order by case when tenant_id is null then 1 else 0 end, created_at desc
          limit 1
        `
      : sql`
          select policy_id, tenant_id, mode, policy_json, created_at::text
          from risk_policy
          order by case when tenant_id is null then 1 else 0 end, created_at desc
          limit 1
        `;
  });

  if (!rows.length) {
    return c.json({ found: false, reason: "risk_policy_not_found" }, 404);
  }

  return c.json({ found: true, policy: rows[0] });
});

rulesRouter.get("/all", async (c) => {
  const auth = c.get("auth");
  const modeResult = modeSchema.optional().safeParse(c.req.query("mode"));
  if (!modeResult.success) return c.json({ error: "invalid_mode" }, 400);
  const mode = modeResult.data;

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return mode
      ? sql`
          select ruleset_id, tenant_id, mode, region_code, effective_from::text, effective_to::text, priority, rules_json, created_at::text
          from ruleset
          where (tenant_id = ${auth.tenantId} or tenant_id is null)
            and mode = ${mode}
          order by case when tenant_id is null then 1 else 0 end, priority asc, effective_from desc
          limit 500
        `
      : sql`
          select ruleset_id, tenant_id, mode, region_code, effective_from::text, effective_to::text, priority, rules_json, created_at::text
          from ruleset
          where tenant_id = ${auth.tenantId} or tenant_id is null
          order by case when tenant_id is null then 1 else 0 end, priority asc, effective_from desc
          limit 500
        `;
  });

  return c.json({ rulesets: rows.map((row) => ({ ...row })) });
});

rulesRouter.post("/upsert", requireRole("ORG_ADMIN", "OWNER"), async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = rulesetUpsertSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      insert into ruleset (
        ruleset_id, tenant_id, mode, region_code, effective_from, effective_to, priority, rules_json
      ) values (
        ${parsed.data.ruleset_id}, ${auth.tenantId}, ${parsed.data.mode}, ${parsed.data.region_code},
        ${parsed.data.effective_from}::date, ${parsed.data.effective_to ?? null}::date, ${parsed.data.priority},
        ${JSON.stringify(parsed.data.rules_json)}::jsonb
      )
      on conflict (ruleset_id) do update
      set mode = excluded.mode,
          region_code = excluded.region_code,
          effective_from = excluded.effective_from,
          effective_to = excluded.effective_to,
          priority = excluded.priority,
          rules_json = excluded.rules_json
    `;
  });

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "ORG",
    subject_id: parsed.data.region_code,
    actor_id: auth.actorId,
    event_type: "RULESET_EFFECTIVE",
    payload_json: {
      ruleset_id: parsed.data.ruleset_id,
      mode: parsed.data.mode,
      region_code: parsed.data.region_code,
      effective_from: parsed.data.effective_from,
      effective_to: parsed.data.effective_to,
      priority: parsed.data.priority
    }
  });

  await writeAuditLog(c.env, {
    auth,
    action: "ruleset.upsert",
    subjectType: "RULESET",
    subjectId: parsed.data.ruleset_id,
    outcome: "SUCCESS",
    requestId: c.req.header("x-request-id"),
    metadata: {
      mode: parsed.data.mode,
      region_code: parsed.data.region_code,
      effective_from: parsed.data.effective_from
    }
  });

  return c.json({ ok: true, ruleset_id: parsed.data.ruleset_id, emitted_event_id: emitted.event_id });
});

rulesRouter.post("/risk-policy/upsert", requireRole("ORG_ADMIN", "OWNER"), async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = riskPolicyUpsertSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      insert into risk_policy (
        policy_id, tenant_id, mode, policy_json
      ) values (
        ${parsed.data.policy_id}, ${auth.tenantId}, ${parsed.data.mode ?? null}, ${JSON.stringify(parsed.data.policy_json)}::jsonb
      )
      on conflict (policy_id) do update
      set mode = excluded.mode,
          policy_json = excluded.policy_json
    `;
  });

  await writeAuditLog(c.env, {
    auth,
    action: "risk_policy.upsert",
    subjectType: "RISK_POLICY",
    subjectId: parsed.data.policy_id,
    outcome: "SUCCESS",
    requestId: c.req.header("x-request-id"),
    metadata: {
      mode: parsed.data.mode ?? null
    }
  });

  return c.json({ ok: true, policy_id: parsed.data.policy_id });
});
