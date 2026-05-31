import type { AuthContext, Env } from "../types";
import { withTenant } from "./db";

export interface AuditInput {
  auth: AuthContext;
  action: string;
  subjectType:
    | "DEVICE"
    | "RULESET"
    | "RISK_POLICY"
    | "COMPLIANCE_PACKAGE"
    | "TRIP"
    | "EXPORT"
    | "CERTIFICATE"
    | "INTEGRATION"
    | "TRAINING_MODULE"
    | "TRAINING_ASSIGNMENT"
    | "CATCH"
    | "SAFETY";
  subjectId: string;
  outcome: "SUCCESS" | "DENIED" | "FAILED";
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export async function writeAuditLog(env: Env, input: AuditInput): Promise<void> {
  try {
    await withTenant(env, input.auth.tenantId, async (sql) => {
      await sql`
        insert into audit_log (
          audit_id, tenant_id, actor_id, actor_role, action, subject_type, subject_id,
          outcome, request_id, metadata_json
        ) values (
          ${crypto.randomUUID()}, ${input.auth.tenantId}, ${input.auth.actorId}, ${input.auth.role},
          ${input.action}, ${input.subjectType}, ${input.subjectId}, ${input.outcome},
          ${input.requestId ?? null}, ${JSON.stringify(input.metadata ?? {})}::jsonb
        )
      `;
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.warn(
      JSON.stringify({
        event: "audit_log_write_failed",
        action: input.action,
        subject_type: input.subjectType,
        subject_id: input.subjectId,
        reason
      })
    );

    if (env.APP_ENV !== "development") {
      throw new Error(`audit_log_write_failed: ${reason}`);
    }
  }
}
