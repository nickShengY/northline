import { Hono } from "hono";
import { z } from "zod";
import { sha256 } from "@northline/shared";
import type { AuthContext, Env } from "../types";
import { eventsForTrip } from "../lib/events";
import { withTenant } from "../lib/db";
import { readJsonBody } from "../lib/request";
import { runComplianceValidation } from "../services/compliance";
import { appendServerEvent } from "../lib/server-events";
import { requireRole } from "../lib/rbac";
import { writeAuditLog } from "../lib/audit";
import { validateOptionalQueryParam } from "../lib/route-params";

const complianceExportSchema = z.object({
  trip_id: z.string().min(3),
  format: z.enum(["JSON", "CSV", "PDF"]).default("JSON")
});

function escapeHtml(value: unknown) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function csvCell(value: unknown) {
  const raw = String(value ?? "");
  const guarded = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, "\"\"")}"`;
}

async function generatePDFContent(payload: {
  trip_id: string;
  generated_at: string;
  completion_meter: number;
  error_count: number;
  warning_count: number;
  event_count: number;
  event_ids: string[];
  compliance: ReturnType<typeof runComplianceValidation>;
}): Promise<string> {
  const eventHash = await sha256(payload.event_ids.join(","));
  const tripId = escapeHtml(payload.trip_id);
  const generatedAt = escapeHtml(new Date(payload.generated_at).toLocaleDateString());
  const generatedAtRaw = escapeHtml(payload.generated_at);
  const errors = payload.compliance.errors.map((error) => ({
    code: escapeHtml(error.code),
    severity: escapeHtml(error.severity),
    message: escapeHtml(error.message),
    fixHint: escapeHtml(error.fix_hint || "N/A")
  }));
  const warnings = payload.compliance.warnings.map((warning) => ({
    code: escapeHtml(warning.code),
    severity: escapeHtml(warning.severity),
    message: escapeHtml(warning.message),
    fixHint: escapeHtml(warning.fix_hint || "N/A")
  }));
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Compliance Report - ${tripId}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
    h1 { color: #1a365d; border-bottom: 3px solid #2b6cb0; padding-bottom: 10px; }
    h2 { color: #2d3748; margin-top: 30px; }
    .header-info { background: #f7fafc; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .metric { display: inline-block; margin: 10px 20px 10px 0; }
    .metric-value { font-size: 24px; font-weight: bold; color: #2b6cb0; }
    .metric-label { font-size: 12px; color: #718096; text-transform: uppercase; }
    .progress-bar { width: 100%; height: 30px; background: #e2e8f0; border-radius: 15px; overflow: hidden; margin: 20px 0; }
    .progress-fill { height: 100%; background: ${payload.completion_meter > 80 ? '#48bb78' : payload.completion_meter > 50 ? '#ed8936' : '#f56565'}; }
    .issues { margin: 20px 0; }
    .error { background: #fed7d7; border-left: 4px solid #f56565; padding: 12px; margin: 8px 0; border-radius: 4px; }
    .warning { background: #feebc8; border-left: 4px solid #ed8936; padding: 12px; margin: 8px 0; border-radius: 4px; }
    .success { background: #c6f6d5; border-left: 4px solid #48bb78; padding: 12px; margin: 8px 0; border-radius: 4px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th { background: #2b6cb0; color: white; padding: 12px; text-align: left; }
    td { padding: 12px; border-bottom: 1px solid #e2e8f0; }
    tr:nth-child(even) { background: #f7fafc; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 2px solid #e2e8f0; font-size: 12px; color: #718096; }
    .tamper-evident { background: #1a202c; color: #48bb78; padding: 10px; font-family: monospace; font-size: 10px; word-break: break-all; margin: 20px 0; }
  </style>
</head>
<body>
  <h1>Northline Compliance Report</h1>
  <div class="header-info">
    <div class="metric"><div class="metric-value">${tripId}</div><div class="metric-label">Trip ID</div></div>
    <div class="metric"><div class="metric-value">${generatedAt}</div><div class="metric-label">Generated</div></div>
    <div class="metric"><div class="metric-value">${payload.completion_meter}%</div><div class="metric-label">Completion</div></div>
    <div class="metric"><div class="metric-value">${payload.event_count}</div><div class="metric-label">Events</div></div>
  </div>
  <h2>Compliance Progress</h2>
  <div class="progress-bar"><div class="progress-fill" style="width: ${payload.completion_meter}%"></div></div>
  <h2>Issues Summary</h2>
  <div class="issues">
    ${payload.error_count > 0 ? `<div class="error"><strong>${payload.error_count} Blocking Errors</strong> - Must be resolved before sign-off</div>` : ''}
    ${payload.warning_count > 0 ? `<div class="warning"><strong>${payload.warning_count} Warnings</strong> - Review recommended</div>` : ''}
    ${payload.error_count === 0 && payload.warning_count === 0 ? `<div class="success"><strong>All Checks Passed</strong> - Ready for sign-off</div>` : ''}
  </div>
  ${payload.compliance.errors.length > 0 ? `
  <h2>Blocking Errors</h2>
  <table>
    <tr><th>Code</th><th>Severity</th><th>Message</th><th>Fix Hint</th></tr>
    ${errors.map(e => `<tr><td>${e.code}</td><td>${e.severity}</td><td>${e.message}</td><td>${e.fixHint}</td></tr>`).join('')}
  </table>` : ''}
  ${payload.compliance.warnings.length > 0 ? `
  <h2>Warnings</h2>
  <table>
    <tr><th>Code</th><th>Severity</th><th>Message</th><th>Fix Hint</th></tr>
    ${warnings.map(w => `<tr><td>${w.code}</td><td>${w.severity}</td><td>${w.message}</td><td>${w.fixHint}</td></tr>`).join('')}
  </table>` : ''}
  <h2>Tamper-Evident Seal</h2>
  <div class="tamper-evident">
    CONTENT_HASH: ${escapeHtml(eventHash)}<br/>
    EVENT_COUNT: ${payload.event_count}<br/>
    GENERATED: ${generatedAtRaw}
  </div>
  <div class="footer">
    <p>Generated by Northline Platform | This report contains tamper-evident metadata for audit purposes.</p>
    <p>Report ID: ${tripId}_${generatedAtRaw}</p>
  </div>
</body>
</html>`;
  return html;
}

export async function serializeExport(
  format: "JSON" | "CSV" | "PDF",
  payload: {
    trip_id: string;
    generated_at: string;
    completion_meter: number;
    error_count: number;
    warning_count: number;
    event_count: number;
    event_ids: string[];
    compliance: ReturnType<typeof runComplianceValidation>;
  }
): Promise<{ content: string; contentType: string; extension: string }> {
  if (format === "PDF") {
    return {
      content: await generatePDFContent(payload),
      contentType: "text/html",
      extension: "pdf.html"
    };
  }

  if (format === "CSV") {
    const lines = [
      "trip_id,generated_at,completion_meter,error_count,warning_count,event_count,event_ids",
      [
        csvCell(payload.trip_id),
        csvCell(payload.generated_at),
        csvCell(payload.completion_meter),
        csvCell(payload.error_count),
        csvCell(payload.warning_count),
        csvCell(payload.event_count),
        csvCell(payload.event_ids.join("|"))
      ].join(",")
    ];
    return {
      content: `${lines.join("\n")}\n`,
      contentType: "text/csv",
      extension: "csv"
    };
  }

  return {
    content: JSON.stringify(payload, null, 2),
    contentType: "application/json",
    extension: "json"
  };
}

export const exportRouter = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

exportRouter.post("/compliance-package", requireRole("ORG_ADMIN", "OWNER", "CAPTAIN", "PROCESSOR"), async (c) => {
  const auth = c.get("auth");
  const bodyResult = await readJsonBody(c);
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;
  const parsed = complianceExportSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
  }

  const tripEvents = await eventsForTrip(c.env, auth.tenantId, parsed.data.trip_id, { limit: 10000 });

  const compliance = runComplianceValidation(tripEvents);
  const generatedAt = new Date().toISOString();

  const eventIds = tripEvents.map((event) => event.event_id);
  const payload = {
    trip_id: parsed.data.trip_id,
    generated_at: generatedAt,
    completion_meter: compliance.completion_meter,
    error_count: compliance.errors.length,
    warning_count: compliance.warnings.length,
    event_count: tripEvents.length,
    event_ids: eventIds,
    compliance
  };

  const serialized = await serializeExport(parsed.data.format, payload);
  const content = serialized.content;
  const contentHash = await sha256(content);
  const artifactId = `artifact_${crypto.randomUUID().replace(/-/g, "")}`;
  const objectKey = `exports/${auth.tenantId}/${artifactId}.${serialized.extension}`;

  await c.env.R2_BUCKET.put(objectKey, content, {
    httpMetadata: { contentType: serialized.contentType }
  });

  await withTenant(c.env, auth.tenantId, async (sql) => {
    await sql`
      insert into artifact_registry (
        artifact_id, tenant_id, artifact_kind, object_key, content_hash, provenance_event_ids, metadata_json
      ) values (
        ${artifactId}, ${auth.tenantId}, ${"COMPLIANCE_PACKAGE"}, ${objectKey}, ${contentHash},
        ${JSON.stringify(eventIds)}::jsonb,
        ${JSON.stringify({
          trip_id: parsed.data.trip_id,
          format: parsed.data.format,
          completion_meter: payload.completion_meter,
          generated_at: generatedAt
        })}::jsonb
      )
    `;
  });

  const emitted = await appendServerEvent(c.env, auth.tenantId, {
    subject_type: "ORG",
    subject_id: parsed.data.trip_id,
    actor_id: auth.actorId,
    event_type: "EXPORT_GENERATED",
    payload_json: {
      artifact_id: artifactId,
      artifact_kind: "COMPLIANCE_PACKAGE",
      object_key: objectKey,
      trip_id: parsed.data.trip_id,
      content_hash: contentHash,
      format: parsed.data.format
    }
  });

  await writeAuditLog(c.env, {
    auth,
    action: "export.compliance_package",
    subjectType: "EXPORT",
    subjectId: artifactId,
    outcome: "SUCCESS",
    requestId: c.req.header("x-request-id"),
    metadata: {
      trip_id: parsed.data.trip_id,
      format: parsed.data.format,
      content_hash: contentHash,
      event_count: tripEvents.length
    }
  });

  return c.json({
    ok: true,
    artifact_id: artifactId,
    object_key: objectKey,
    content_hash: contentHash,
    emitted_event_id: emitted.event_id,
    summary: {
      completion_meter: payload.completion_meter,
      errors: payload.error_count,
      warnings: payload.warning_count,
      event_count: payload.event_count
    }
  });
});

exportRouter.get("/artifact/:artifactId", requireRole("ORG_ADMIN", "OWNER", "CAPTAIN", "PROCESSOR"), async (c) => {
  const auth = c.get("auth");
  const artifactId = c.req.param("artifactId");

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    return sql`
      select artifact_id, artifact_kind, object_key, content_hash, provenance_event_ids, metadata_json, created_at::text
      from artifact_registry
      where tenant_id = ${auth.tenantId}
        and artifact_id = ${artifactId}
      limit 1
    `;
  });

  if (!rows.length) {
    return c.json({ found: false, reason: "artifact_not_found" }, 404);
  }

  return c.json({ found: true, artifact: rows[0] });
});

exportRouter.get("/artifacts", requireRole("ORG_ADMIN", "OWNER", "CAPTAIN", "PROCESSOR"), async (c) => {
  const auth = c.get("auth");
  const kindResult = validateOptionalQueryParam("kind", c.req.query("kind"));
  const tripIdResult = validateOptionalQueryParam("trip_id", c.req.query("trip_id"));
  if (!kindResult.ok) return c.json(kindResult.error, 400);
  if (!tripIdResult.ok) return c.json(tripIdResult.error, 400);
  const kind = kindResult.value;
  const tripId = tripIdResult.value;

  const rows = await withTenant(c.env, auth.tenantId, async (sql) => {
    if (kind && tripId) {
      return sql`
        select artifact_id, artifact_kind, object_key, content_hash, metadata_json, created_at::text
        from artifact_registry
        where tenant_id = ${auth.tenantId}
          and artifact_kind = ${kind}
          and metadata_json->>'trip_id' = ${tripId}
        order by created_at desc
        limit 500
      `;
    }

    if (kind) {
      return sql`
        select artifact_id, artifact_kind, object_key, content_hash, metadata_json, created_at::text
        from artifact_registry
        where tenant_id = ${auth.tenantId}
          and artifact_kind = ${kind}
        order by created_at desc
        limit 500
      `;
    }

    if (tripId) {
      return sql`
        select artifact_id, artifact_kind, object_key, content_hash, metadata_json, created_at::text
        from artifact_registry
        where tenant_id = ${auth.tenantId}
          and metadata_json->>'trip_id' = ${tripId}
        order by created_at desc
        limit 500
      `;
    }

    return sql`
      select artifact_id, artifact_kind, object_key, content_hash, metadata_json, created_at::text
      from artifact_registry
      where tenant_id = ${auth.tenantId}
      order by created_at desc
      limit 500
    `;
  });

  return c.json({ artifacts: rows });
});
