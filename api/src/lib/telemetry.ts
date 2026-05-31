import type { Env } from "../types";

export type TelemetryEvent =
  | {
      type: "request";
      request_id: string;
      method: string;
      path: string;
      status: number;
      duration_ms: number;
      env: Env["APP_ENV"];
    }
  | {
      type: "error";
      request_id: string;
      method: string;
      path: string;
      error: string;
      env: Env["APP_ENV"];
    }
  | {
      type: "authorization_denied";
      request_id: string | null;
      tenant_id: string;
      actor_id: string;
      actor_role: string;
      method: string;
      path: string;
      required_roles: string[];
      env: Env["APP_ENV"];
    };

function sampleRate(env: Env) {
  const parsed = Number(env.OBSERVABILITY_SAMPLE_RATE ?? "0.05");
  if (!Number.isFinite(parsed)) return 0.05;
  return Math.min(1, Math.max(0, parsed));
}

export function shouldEmitTelemetry(env: Env, event: TelemetryEvent, random = Math.random()) {
  if (!env.OBSERVABILITY_WEBHOOK_URL) return false;
  if (event.type === "error" || event.type === "authorization_denied") return true;
  return random <= sampleRate(env);
}

export async function emitTelemetry(env: Env, event: TelemetryEvent) {
  if (!shouldEmitTelemetry(env, event)) return;

  const headers: Record<string, string> = {
    "content-type": "application/json"
  };
  if (env.OBSERVABILITY_WEBHOOK_TOKEN?.trim()) {
    headers.authorization = `Bearer ${env.OBSERVABILITY_WEBHOOK_TOKEN.trim()}`;
  }

  try {
    const response = await fetch(env.OBSERVABILITY_WEBHOOK_URL as string, {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "northline-api",
        ...event
      })
    });

    if (!response.ok) {
      console.warn(JSON.stringify({
        event: "telemetry_delivery_failed",
        status: response.status,
        request_id: event.request_id
      }));
    }
  } catch (error) {
    console.warn(JSON.stringify({ event: "telemetry_delivery_failed", error: String(error), request_id: event.request_id }));
  }
}
