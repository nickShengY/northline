import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import { withTenant } from "../lib/db";
import { appendServerEvent } from "../lib/server-events";
import { recommendTrainingModules } from "../services/training";

const assignSchema = z.object({
  assign_id: z.string().optional(),
  user_id: z.string().min(2),
  module_id: z.string().min(3),
  reason: z.string().min(3),
  due_at: z.string().datetime().optional(),
  status: z.enum(["ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).default("ASSIGNED")
});

const completeSchema = z.object({
  assign_id: z.string().min(3),
  score: z.number().int().min(0).max(100).optional()
});

const recommendSchema = z.object({
  mode: z.enum(["OFFSHORE", "ICE"]),
  near_miss_count: z.number().int().min(0).optional(),
  missed_checkins: z.number().int().min(0).optional(),
  overdue_gear_checks: z.number().int().min(0).optional(),
  compliance_errors: z.number().int().min(0).optional(),
  scan_mismatch_rate: z.number().min(0).max(1).optional()
});

const moduleUpsertSchema = z.object({
  module_id: z.string().min(3),
  mode: z.enum(["OFFSHORE", "ICE", "BOTH"]),
  title: z.string().min(3),
  duration_sec: z.number().int().min(30),
  quiz_json: z.record(z.unknown()).optional(),
  prerequisites: z.array(z.string()).default([]),
  metadata_json: z.record(z.unknown()).default({}),
  active: z.boolean().default(true)
});

export const trainingRouter = new Hono<{ Bindings: Env; Variables: { auth: { tenantId: string; actorId: string } } }>();

trainingRouter.post("/assign", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = assignSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const assignId = parsed.data.assign_id ?? `assign_${crypto.randomUUID().replace(/-/g, "")}`;

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      insert into training_state (
        assign_id, tenant_id, user_id, module_id, reason, status, due_at
      ) values (
        ${assignId}, ${auth.tenantId}, ${parsed.data.user_id}, ${parsed.data.module_id},
        ${parsed.data.reason}, ${parsed.data.status}, ${parsed.data.due_at ?? null}::timestamptz
      )
      on conflict (assign_id) do update
      set user_id = excluded.user_id,
          module_id = excluded.module_id,
          reason = excluded.reason,
          status = excluded.status,
          due_at = excluded.due_at
    `;
  });

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "USER",
    subject_id: parsed.data.user_id,
    actor_id: auth.actorId,
    event_type: "TRAINING_ASSIGNED",
    payload_json: {
      assign_id: assignId,
      user_id: parsed.data.user_id,
      module_id: parsed.data.module_id,
      reason: parsed.data.reason,
      due_at: parsed.data.due_at
    }
  });

  return c.json({ ok: true, assign_id: assignId, emitted_event_id: emitted.event_id });
});

trainingRouter.post("/complete", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = completeSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const updated = await withTenant(c.env, auth.tenantId, async (sql) => {
    const rows = await sql`
      update training_state
      set status = 'COMPLETED',
          score = ${parsed.data.score ?? null},
          completed_at = now()
      where tenant_id = ${auth.tenantId}
        and assign_id = ${parsed.data.assign_id}
      returning assign_id, user_id, module_id, score, completed_at::text
    `;
    return rows;
  });

  if (!updated.length) {
    return c.json({ ok: false, reason: "assignment_not_found" }, 404);
  }

  const row = updated[0] as {
    assign_id: string;
    user_id: string;
    module_id: string;
    score: number | null;
    completed_at: string;
  };

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "USER",
    subject_id: row.user_id,
    actor_id: auth.actorId,
    event_type: "TRAINING_COMPLETED",
    payload_json: {
      assign_id: row.assign_id,
      module_id: row.module_id,
      score: row.score,
      completed_at: row.completed_at
    }
  });

  return c.json({ ok: true, assignment: row, emitted_event_id: emitted.event_id });
});

trainingRouter.post("/recommend", async (c) => {
  const body = await c.req.json();
  const parsed = recommendSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const recommended = recommendTrainingModules(parsed.data);
  return c.json({ ok: true, recommended });
});

trainingRouter.get("/user/:userId", async (c) => {
  const auth = c.get("auth");
  const userId = c.req.param("userId");

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select assign_id, user_id, module_id, reason, status, due_at::text, completed_at::text, score, created_at::text
      from training_state
      where tenant_id = ${auth.tenantId}
        and user_id = ${userId}
      order by created_at desc
      limit 200
    `;
  });

  return c.json({ user_id: userId, assignments: rows });
});

trainingRouter.get("/modules", async (c) => {
  const auth = c.get("auth");
  const mode = c.req.query("mode");

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return mode
      ? sql`
          select module_id, tenant_id, mode, title, duration_sec, quiz_json, prerequisites, metadata_json, active, created_at::text
          from training_module
          where (tenant_id = ${auth.tenantId} or tenant_id is null)
            and active = true
            and (mode = ${mode} or mode = 'BOTH')
          order by case when tenant_id is null then 1 else 0 end, created_at desc
          limit 500
        `
      : sql`
          select module_id, tenant_id, mode, title, duration_sec, quiz_json, prerequisites, metadata_json, active, created_at::text
          from training_module
          where (tenant_id = ${auth.tenantId} or tenant_id is null)
            and active = true
          order by case when tenant_id is null then 1 else 0 end, created_at desc
          limit 500
        `;
  });

  return c.json({ modules: rows });
});

trainingRouter.post("/modules/upsert", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = moduleUpsertSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      insert into training_module (
        module_id, tenant_id, mode, title, duration_sec, quiz_json, prerequisites, metadata_json, active
      ) values (
        ${parsed.data.module_id}, ${auth.tenantId}, ${parsed.data.mode}, ${parsed.data.title}, ${parsed.data.duration_sec},
        ${JSON.stringify(parsed.data.quiz_json ?? {})}::jsonb, ${JSON.stringify(parsed.data.prerequisites)}::jsonb,
        ${JSON.stringify(parsed.data.metadata_json)}::jsonb, ${parsed.data.active}
      )
      on conflict (module_id) do update
      set mode = excluded.mode,
          title = excluded.title,
          duration_sec = excluded.duration_sec,
          quiz_json = excluded.quiz_json,
          prerequisites = excluded.prerequisites,
          metadata_json = excluded.metadata_json,
          active = excluded.active
    `;
  });

  return c.json({ ok: true, module_id: parsed.data.module_id });
});
