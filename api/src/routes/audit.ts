import { Hono } from "hono";
import type { AuthContext, Env } from "../types";
import { withTenant } from "../lib/db";
import { requireRole } from "../lib/rbac";
import { parseBoundedIntegerQueryParam, validateOptionalQueryParam } from "../lib/route-params";

export const auditRouter = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

auditRouter.get("/events", requireRole("ORG_ADMIN", "OWNER"), async (c) => {
  const auth = c.get("auth");
  const actorIdResult = validateOptionalQueryParam("actor_id", c.req.query("actor_id"));
  const subjectTypeResult = validateOptionalQueryParam("subject_type", c.req.query("subject_type"));
  const subjectIdResult = validateOptionalQueryParam("subject_id", c.req.query("subject_id"));
  const limitResult = parseBoundedIntegerQueryParam("limit", c.req.query("limit"), {
    defaultValue: 100,
    min: 1,
    max: 500
  });

  if (!actorIdResult.ok) return c.json(actorIdResult.error, 400);
  if (!subjectTypeResult.ok) return c.json(subjectTypeResult.error, 400);
  if (!subjectIdResult.ok) return c.json(subjectIdResult.error, 400);
  if (!limitResult.ok) return c.json(limitResult.error, 400);

  const actorId = actorIdResult.value;
  const subjectType = subjectTypeResult.value;
  const subjectId = subjectIdResult.value;
  const limit = limitResult.value;

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select audit_id, tenant_id, actor_id, actor_role, action, subject_type, subject_id,
             outcome, request_id, metadata_json, created_at::text
      from audit_log
      where tenant_id = ${auth.tenantId}
        and (${actorId ?? null}::text is null or actor_id = ${actorId ?? null})
        and (${subjectType ?? null}::text is null or subject_type = ${subjectType ?? null})
        and (${subjectId ?? null}::text is null or subject_id = ${subjectId ?? null})
      order by created_at desc
      limit ${limit}
    `;
  });

  return c.json({ events: rows });
});
