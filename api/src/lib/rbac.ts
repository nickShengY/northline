import type { MiddlewareHandler } from "hono";
import type { AuthContext, Env } from "../types";
import { emitTelemetry } from "./telemetry";

export function requireRole(
  ...allowedRoles: AuthContext["role"][]
): MiddlewareHandler<{ Bindings: Env; Variables: { auth: AuthContext } }> {
  const allowed = new Set(allowedRoles);

  return async (c, next) => {
    const auth = c.get("auth");
    if (!allowed.has(auth.role)) {
      const event = {
        event: "authorization_denied",
        tenant_id: auth.tenantId,
        actor_id: auth.actorId,
        actor_role: auth.role,
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        required_roles: allowedRoles,
        request_id: c.req.header("x-request-id") ?? c.res.headers.get("x-request-id") ?? null
      };

      console.warn(JSON.stringify(event));
      const telemetry = emitTelemetry(c.env, {
        type: "authorization_denied",
        tenant_id: event.tenant_id,
        actor_id: event.actor_id,
        actor_role: event.actor_role,
        method: event.method,
        path: event.path,
        required_roles: event.required_roles,
        request_id: event.request_id,
        env: c.env.APP_ENV
      });
      try {
        c.executionCtx.waitUntil(telemetry);
      } catch {
        void telemetry;
      }

      return c.json({ error: "forbidden", required_roles: allowedRoles }, 403);
    }
    await next();
  };
}
