import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { authMiddleware } from "./lib/auth";
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

const app = new Hono<{ Bindings: Env }>();

function allowedOrigin(origin: string, env: Env) {
  if (env.APP_ENV === "development") return origin;
  const configured = env.CORS_ORIGIN?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
  return configured.includes(origin) ? origin : "";
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
app.get("/health", (c) => c.json({ ok: true, env: c.env.APP_ENV }));

app.use("/v1/*", authMiddleware);
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

// AIS routes without auth middleware (handle auth internally)
app.route("/v1/ais", aisProxyRouter);

export default app;
