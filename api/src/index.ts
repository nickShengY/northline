import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { authenticateToken, authMiddleware, bearerTokenFromHeader } from "./lib/auth";
import { syncRouter } from "./routes/sync";
import { stlRouter } from "./routes/stl";
import { opsRouter } from "./routes/ops";
import { safetyRouter } from "./routes/safety";
import { traceRouter } from "./routes/trace";
import { rulesRouter } from "./routes/rules";
import { gearRouter } from "./routes/gear";
import { trainingRouter } from "./routes/training";
import { exportRouter } from "./routes/export";
import { integrationsRouter } from "./routes/integrations";
import { aisProxyRouter } from "./routes/ais-proxy";
import { catchRouter } from "./routes/catch";
import { stationRouter } from "./routes/station";
import { iceRouter } from "./routes/ice";
import { projectionRouter } from "./routes/projection";
import { authProviderConfig, authRouter } from "./routes/auth";
import { auditRouter } from "./routes/audit";
import { rateLimitMiddleware } from "./lib/rate-limit";
export { RateLimiterDurableObject } from "./lib/rate-limit";
import { buildReadinessReport } from "./lib/readiness";
import { emitTelemetry } from "./lib/telemetry";

const app = new Hono<{ Bindings: Env }>();

function waitForTelemetry(c: Context<{ Bindings: Env }>, promise: Promise<void>) {
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    void promise;
  }
}

function allowedOrigin(origin: string, env: Env) {
  if (env.APP_ENV === "development") return origin;
  const configured = env.CORS_ORIGIN?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
  return configured.includes(origin) ? origin : "";
}

function validatePathSegments(pathname: string) {
  for (const rawSegment of pathname.split("/")) {
    if (!rawSegment) continue;
    let segment: string;
    try {
      segment = decodeURIComponent(rawSegment);
    } catch {
      return false;
    }
    if (segment.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(segment)) {
      return false;
    }
  }
  return true;
}

function validateQueryLength(search: string) {
  return search.length <= 4096;
}

app.use(
  "*",
  cors({
    origin: (origin, c) => allowedOrigin(origin, c.env),
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 86400
  })
);

app.use("*", async (c, next) => {
  const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
  const startedAt = Date.now();
  const url = new URL(c.req.url);
  const pathname = url.pathname;
  let shortCircuitStatus: number | undefined;
  c.header("x-request-id", requestId);
  c.header("x-content-type-options", "nosniff");
  c.header("x-frame-options", "DENY");
  c.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  c.header("referrer-policy", "no-referrer");
  c.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
  if (c.env.APP_ENV !== "development") {
    c.header("strict-transport-security", "max-age=31536000; includeSubDomains; preload");
  }

  try {
    if (!validatePathSegments(pathname)) {
      shortCircuitStatus = 400;
      return c.json({
        error: "invalid_route_path",
        message: "path segments must be 1-128 URL-safe identifier characters",
        request_id: requestId
      }, 400);
    }
    if (!validateQueryLength(url.search)) {
      shortCircuitStatus = 400;
      return c.json({
        error: "invalid_query_string",
        message: "query string must be 4096 bytes or less",
        request_id: requestId
      }, 400);
    }
    await next();
  } finally {
    const durationMs = Date.now() - startedAt;
    const event = {
      type: "request" as const,
      request_id: requestId,
      method: c.req.method,
      path: pathname,
      status: shortCircuitStatus ?? c.res.status,
      duration_ms: durationMs,
      env: c.env.APP_ENV
    };
    console.info(JSON.stringify(event));
    waitForTelemetry(c, emitTelemetry(c.env, event));
  }
});

app.onError((error, c) => {
  const requestId = c.res.headers.get("x-request-id") ?? c.req.header("x-request-id") ?? crypto.randomUUID();
  c.header("x-request-id", requestId);
  if (error instanceof SyntaxError && c.req.header("content-type")?.toLowerCase().includes("application/json")) {
    return c.json(
      {
        error: "invalid_payload",
        message: "request body must be valid JSON",
        request_id: requestId
      },
      400
    );
  }

  const event = {
    type: "error" as const,
    request_id: requestId,
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    error: error.message,
    env: c.env.APP_ENV
  };
  console.error(JSON.stringify(event));
  waitForTelemetry(c, emitTelemetry(c.env, event));

  if (error.message === "server_event_chain_conflict") {
    // The route's primary write committed but the server-event chain append
    // lost repeated races; the request is safe to retry.
    return c.json(
      {
        error: "server_event_chain_conflict",
        message: "concurrent update contention; retry the request",
        request_id: requestId
      },
      503
    );
  }

  return c.json(
    {
      error: "internal_error",
      request_id: requestId
    },
    500
  );
});

app.notFound((c) => c.json({ error: "not_found", path: new URL(c.req.url).pathname }, 404));

app.get("/health", (c) => c.json({ ok: true, env: c.env.APP_ENV }));
app.get("/ready", async (c) => {
  const report = await buildReadinessReport(c.env);

  // Detailed check messages reference env var names and configuration state;
  // only reveal them to authenticated callers. Unauthenticated probes get
  // generic check names plus booleans.
  const token = bearerTokenFromHeader(c.req.header("Authorization"));
  const auth = token ? await authenticateToken(c.env, token) : null;
  const body = auth
    ? report
    : {
        ok: report.ok,
        env: report.env,
        checks: report.checks.map(({ name, ok, required }) => ({ name, ok, required }))
      };

  return c.json(body, report.ok ? 200 : 503);
});

app.use("/v1/*", rateLimitMiddleware);
app.get("/v1/auth/config", (c) => c.json(authProviderConfig(c.env)));
app.use("/v1/*", authMiddleware);
app.route("/v1/auth", authRouter);
app.route("/v1/audit", auditRouter);
app.route("/v1/sync", syncRouter);
app.route("/v1/stl", stlRouter);
app.route("/v1/ops", opsRouter);
app.route("/v1/safety", safetyRouter);
app.route("/v1/trace", traceRouter);
app.route("/v1/rules", rulesRouter);
app.route("/v1/gear", gearRouter);
app.route("/v1/training", trainingRouter);
app.route("/v1/export", exportRouter);
app.route("/v1/integrations", integrationsRouter);
app.route("/v1/catch", catchRouter);
app.route("/v1/station", stationRouter);
app.route("/v1/ice", iceRouter);
app.route("/v1/projection", projectionRouter);

// AIS routes are authenticated by the shared /v1/* auth middleware above
// (which also handles websocket token extraction for /v1/ais/stream).
app.route("/v1/ais", aisProxyRouter);

export default app;
