import { Hono } from "hono";
import type { AuthContext, Env } from "../types";

const roleCapabilities: Record<AuthContext["role"], string[]> = {
  ORG_ADMIN: [
    "admin:manage_org",
    "devices:manage",
    "rulesets:manage",
    "compliance:sign",
    "exports:create",
    "ops:read",
    "ops:write"
  ],
  OWNER: ["devices:manage", "compliance:sign", "exports:create", "ops:read", "ops:write"],
  CAPTAIN: ["compliance:sign", "exports:create", "ops:read", "ops:write"],
  GUIDE: ["ops:read", "ops:write", "hazards:share"],
  PROCESSOR: ["trace:read", "trace:verify", "exports:create", "ops:read"],
  CREW: ["ops:read", "ops:write"]
};

export const authRouter = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

export function authProviderConfig(env: Env) {
  return {
    enabled: Boolean(env.AUTH_LOGIN_URL),
    login_url: env.AUTH_LOGIN_URL ?? null,
    client_id: env.AUTH_CLIENT_ID ?? null,
    scopes: env.AUTH_SCOPES ?? "openid profile email"
  };
}

authRouter.get("/session", (c) => {
  const auth = c.get("auth");

  return c.json({
    tenant_id: auth.tenantId,
    actor_id: auth.actorId,
    role: auth.role,
    capabilities: roleCapabilities[auth.role],
    issued_at: new Date().toISOString()
  });
});
