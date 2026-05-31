import { createMiddleware } from "hono/factory";
import type { Env } from "../types";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function clientAddress(headers: Headers) {
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function authFingerprint(headers: Headers) {
  const auth = headers.get("authorization");
  if (!auth) return "anonymous";
  return auth.slice(0, 32);
}

function rateLimitKey(env: Env, request: Request) {
  const url = new URL(request.url);
  return [
    env.RATE_LIMIT_NAMESPACE ?? env.APP_ENV ?? "default",
    url.pathname,
    clientAddress(request.headers),
    authFingerprint(request.headers)
  ].join(":");
}

function applyRateLimitHeaders(headers: (name: string, value: string) => void, result: RateLimitResult) {
  headers("ratelimit-limit", String(result.limit));
  headers("ratelimit-remaining", String(result.remaining));
  headers("ratelimit-reset", String(result.resetAt));
  if (result.retryAfter !== undefined) {
    headers("retry-after", String(result.retryAfter));
  }
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

function incrementMemoryBucket(key: string, maxRequests: number, windowSeconds: number, now = Date.now()): RateLimitResult {
  const windowMs = windowSeconds * 1000;
  const existing = buckets.get(key);
  const bucket = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + windowMs };
  bucket.count += 1;
  buckets.set(key, bucket);

  const remaining = Math.max(0, maxRequests - bucket.count);
  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

  return {
    allowed: bucket.count <= maxRequests,
    limit: maxRequests,
    remaining,
    resetAt: Math.ceil(bucket.resetAt / 1000),
    retryAfter: bucket.count > maxRequests ? retryAfter : undefined
  };
}

async function incrementDurableBucket(env: Env, key: string, maxRequests: number, windowSeconds: number) {
  if (!env.RATE_LIMITER) return null;

  const id = env.RATE_LIMITER.idFromName(key);
  const stub = env.RATE_LIMITER.get(id);
  const response = await stub.fetch("https://rate-limit.northline.local/increment", {
    method: "POST",
    body: JSON.stringify({ key, maxRequests, windowSeconds })
  });

  if (!response.ok) return null;
  return (await response.json()) as RateLimitResult;
}

export const rateLimitMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const maxRequests = parsePositiveInt(c.env.RATE_LIMIT_MAX_REQUESTS, 120);
  const windowSeconds = parsePositiveInt(c.env.RATE_LIMIT_WINDOW_SECONDS, 60);
  const key = rateLimitKey(c.env, c.req.raw);
  const result =
    (await incrementDurableBucket(c.env, key, maxRequests, windowSeconds)) ??
    incrementMemoryBucket(key, maxRequests, windowSeconds);

  applyRateLimitHeaders((name, value) => c.header(name, value), result);

  if (!result.allowed) {
    return c.json({ error: "rate_limited" }, 429);
  }

  await next();
});

export function clearRateLimitBucketsForTests() {
  buckets.clear();
}

export class RateLimiterDurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("not found", { status: 404 });
    }

    const body = await request.json() as { key?: string; maxRequests?: number; windowSeconds?: number };
    if (!body.key || !body.maxRequests || !body.windowSeconds) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }

    const { key, maxRequests, windowSeconds } = body as {
      key: string;
      maxRequests: number;
      windowSeconds: number;
    };

    const result = await this.state.blockConcurrencyWhile(async () => {
      const storageKey = `bucket:${key}`;
      const now = Date.now();
      const existing = await this.state.storage.get<Bucket>(storageKey);
      const bucket = existing && existing.resetAt > now
        ? existing
        : { count: 0, resetAt: now + windowSeconds * 1000 };
      bucket.count += 1;
      await this.state.storage.put(storageKey, bucket);

      const remaining = Math.max(0, maxRequests - bucket.count);
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

      return {
        allowed: bucket.count <= maxRequests,
        limit: maxRequests,
        remaining,
        resetAt: Math.ceil(bucket.resetAt / 1000),
        retryAfter: bucket.count > maxRequests ? retryAfter : undefined
      } satisfies RateLimitResult;
    });

    return Response.json(result);
  }
}
