import { createMiddleware } from "hono/factory";
import { importSPKI, jwtVerify } from "jose";
import type { AuthContext, Env } from "../types";

const validRoles = new Set<AuthContext["role"]>(["CAPTAIN", "CREW", "OWNER", "GUIDE", "PROCESSOR", "ORG_ADMIN"]);

interface NorthlineJwtPayload {
  sub?: string;
  tenant_id?: string;
  role?: string;
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
    const key = await importSPKI(env.JWT_PUBLIC_KEY, "RS256");
    const { payload } = await jwtVerify(token, key);
    const claims = payload as NorthlineJwtPayload;
    const subject = claims.sub;

    if (!subject) return null;

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

export const authMiddleware = createMiddleware<{ Bindings: Env; Variables: { auth: AuthContext } }>(
  async (c, next) => {
    const header = c.req.header("Authorization");
    if (!header?.startsWith("Bearer ")) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const token = header.replace("Bearer ", "").trim();
    const auth =
      c.env.APP_ENV === "development"
        ? parseDevToken(token) ?? (await parseJwtToken(token, c.env))
        : await parseJwtToken(token, c.env);

    if (!auth) {
      return c.json({ error: "unauthorized" }, 401);
    }
    c.set("auth", auth);
    await next();
  }
);
