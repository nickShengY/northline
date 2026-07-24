import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { AuthContext, Env } from "../types";
import { getSql } from "./db";

const validRoles = new Set<AuthContext["role"]>(["CAPTAIN", "CREW", "OWNER", "GUIDE", "PROCESSOR", "ORG_ADMIN"]);
const firebaseJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));

interface FirebaseJwtPayload {
  sub?: string;
  firebase?: {
    sign_in_provider?: string;
  };
}

type MembershipLookup = (firebaseUid: string) => Promise<AuthContext | null>;

function bootstrapIdentity(env: Env, firebaseUid: string): AuthContext | null {
  const configuredUid = env.INITIAL_ORG_ADMIN_UID?.trim();
  const configuredTenantId = env.INITIAL_ORG_ADMIN_TENANT_ID?.trim();
  if (!configuredUid || !configuredTenantId || firebaseUid !== configuredUid) return null;
  return { tenantId: configuredTenantId, actorId: firebaseUid, role: "ORG_ADMIN" };
}

async function membershipLookup(env: Env, firebaseUid: string): Promise<AuthContext | null> {
  if (!env.NEON_DATABASE_URL) return null;
  try {
    // This is intentionally not tenant-scoped: it establishes the tenant boundary
    // before any tenant-scoped query can be run. The table is write-managed by
    // server-side administration/migrations only, never by Firebase custom claims.
    const rows = await getSql(env)`
      select tenant_id, role
      from firebase_identity_membership
      where firebase_uid = ${firebaseUid} and status = 'ACTIVE'
      limit 1
    ` as Array<{ tenant_id: string; role: string }>;
    const membership = rows[0];
    if (!membership || !validRoles.has(membership.role as AuthContext["role"])) return null;
    return { tenantId: membership.tenant_id, actorId: firebaseUid, role: membership.role as AuthContext["role"] };
  } catch {
    return null;
  }
}

export async function resolveFirebaseIdentity(
  env: Env,
  firebaseUid: string,
  lookup: MembershipLookup = (uid) => membershipLookup(env, uid)
): Promise<AuthContext | null> {
  return (await lookup(firebaseUid)) ?? bootstrapIdentity(env, firebaseUid);
}

function parseDevToken(token: string): AuthContext | null {
  // Development token format: tenant:actor:role. It is never accepted outside development.
  const parts = token.split(":");
  if (parts.length === 3 && parts[0] && parts[1] && parts[2] && validRoles.has(parts[2] as AuthContext["role"])) {
    return { tenantId: parts[0], actorId: parts[1], role: parts[2] as AuthContext["role"] };
  }
  return null;
}

export async function verifyFirebaseToken(
  token: string,
  env: Env,
  jwks: JWTVerifyGetKey = firebaseJwks,
  lookup?: MembershipLookup
): Promise<AuthContext | null> {
  const projectId = env.FIREBASE_PROJECT_ID?.trim();
  if (!projectId) return null;
  try {
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ["RS256"],
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId
    });
    const claims = payload as FirebaseJwtPayload;
    const subject = claims.sub;

    // Firebase's provider claim is verified inside the signed token. Restricting this
    // application to Google prevents accidentally enabling another Firebase provider.
    if (!subject || subject.length > 128 || claims.firebase?.sign_in_provider !== "google.com") return null;

    // Never trust tenant_id or role custom claims from a browser-issued token.
    return resolveFirebaseIdentity(env, subject, lookup);
  } catch {
    return null;
  }
}

async function parseFirebaseToken(token: string, env: Env): Promise<AuthContext | null> {
  return verifyFirebaseToken(token, env);
}

export async function authenticateToken(env: Env, token: string): Promise<AuthContext | null> {
  if (env.FIREBASE_PROJECT_ID) return parseFirebaseToken(token, env);
  return env.APP_ENV === "development" ? parseDevToken(token) : null;
}

export function bearerTokenFromHeader(header?: string | null): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.replace("Bearer ", "").trim();
  return token || null;
}

export function websocketTokenFromRequest(input: {
  appEnv: Env["APP_ENV"];
  url: string;
  authorization?: string | null;
  protocol?: string | null;
}): string | null {
  const headerToken = bearerTokenFromHeader(input.authorization);
  if (headerToken) return headerToken;
  const protocolToken = input.protocol?.split(",").map((item) => item.trim()).find((item) => item.startsWith("northline-token."))?.replace("northline-token.", "") ?? null;
  if (protocolToken) return protocolToken;
  if (input.appEnv === "development") return new URL(input.url).searchParams.get("token")?.trim() || null;
  return null;
}

export const authMiddleware = createMiddleware<{ Bindings: Env; Variables: { auth: AuthContext } }>(async (c, next) => {
  const token = c.req.header("Upgrade") === "websocket"
    ? websocketTokenFromRequest({ appEnv: c.env.APP_ENV, url: c.req.url, authorization: c.req.header("Authorization"), protocol: c.req.header("sec-websocket-protocol") })
    : bearerTokenFromHeader(c.req.header("Authorization"));
  if (!token) return c.json({ error: "unauthorized" }, 401);
  const auth = await authenticateToken(c.env, token);
  if (!auth) return c.json({ error: "unauthorized" }, 401);
  c.set("auth", auth);
  await next();
});
