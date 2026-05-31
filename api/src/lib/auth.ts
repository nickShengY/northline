import { createMiddleware } from "hono/factory";
import { importSPKI, jwtVerify } from "jose";
import type { AuthContext, Env } from "../types";

const validRoles = new Set<AuthContext["role"]>(["CAPTAIN", "CREW", "OWNER", "GUIDE", "PROCESSOR", "ORG_ADMIN"]);
const publicKeyCache = new Map<string, Awaited<ReturnType<typeof importSPKI>>>();

interface NorthlineJwtPayload {
  sub?: string;
  tenant_id?: string;
  role?: string;
  exp?: number;
}

function parseDevToken(token: string): AuthContext | null {
  // Dev token format: tenant:actor:role
  const parts = token.split(":");
  if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
    if (!validRoles.has(parts[2] as AuthContext["role"])) return null;
    return {
      tenantId: parts[0],
      actorId: parts[1],
      role: parts[2] as AuthContext["role"]
    };
  }
  return null;
}

async function parseJwtToken(token: string, env: Env): Promise<AuthContext | null> {
  if (!env.JWT_PUBLIC_KEY) return null;

  try {
    const key = await jwtVerificationKey(env.JWT_PUBLIC_KEY);
    const { payload } = await jwtVerify(token, key, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE
    });
    const claims = payload as NorthlineJwtPayload;
    const subject = claims.sub;

    if (!subject) return null;
    if (env.APP_ENV !== "development") {
      if (!claims.tenant_id) return null;
      if (!claims.exp) return null;
      if (!validRoles.has(claims.role as AuthContext["role"])) return null;
    }

    const role = validRoles.has(claims.role as AuthContext["role"])
      ? (claims.role as AuthContext["role"])
      : "CREW";

    return {
      tenantId: claims.tenant_id || subject,
      actorId: subject,
      role
    };
  } catch {
    return null;
  }
}

async function jwtVerificationKey(publicKeyPem: string) {
  const cached = publicKeyCache.get(publicKeyPem);
  if (cached) return cached;

  const key = await importSPKI(publicKeyPem, "RS256");
  publicKeyCache.set(publicKeyPem, key);
  return key;
}

export async function authenticateToken(env: Env, token: string): Promise<AuthContext | null> {
  return env.APP_ENV === "development"
    ? parseDevToken(token) ?? (await parseJwtToken(token, env))
    : await parseJwtToken(token, env);
}

export function bearerTokenFromHeader(header?: string | null): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.replace("Bearer ", "").trim();
  return token || null;
}

export function websocketTokenFromRequest(input: {
  url: string;
  authorization?: string | null;
  protocol?: string | null;
}): string | null {
  const headerToken = bearerTokenFromHeader(input.authorization);
  if (headerToken) return headerToken;

  const urlToken = new URL(input.url).searchParams.get("token")?.trim();
  if (urlToken) return urlToken;

  return input.protocol
    ?.split(",")
    .map((item) => item.trim())
    .find((item) => item.startsWith("northline-token."))
    ?.replace("northline-token.", "") ?? null;
}

export const authMiddleware = createMiddleware<{ Bindings: Env; Variables: { auth: AuthContext } }>(
  async (c, next) => {
    const token = c.req.header("Upgrade") === "websocket"
      ? websocketTokenFromRequest({
          url: c.req.url,
          authorization: c.req.header("Authorization"),
          protocol: c.req.header("sec-websocket-protocol")
        })
      : bearerTokenFromHeader(c.req.header("Authorization"));
    if (!token) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const auth = await authenticateToken(c.env, token);

    if (!auth) {
      return c.json({ error: "unauthorized" }, 401);
    }
    c.set("auth", auth);
    await next();
  }
);
