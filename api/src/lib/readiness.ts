import type { Env } from "../types";
import { pingDatabase } from "./db";

export interface ReadinessCheck {
  name: string;
  ok: boolean;
  required: boolean;
  message: string;
}

export interface ReadinessReport {
  ok: boolean;
  env: Env["APP_ENV"];
  checks: ReadinessCheck[];
}

export interface ReadinessOptions {
  pingDatabase?: (env: Env) => Promise<void>;
}

function configured(value: string | undefined) {
  return Boolean(value?.trim());
}

function parseUrl(value: string | undefined): URL | null {
  if (!configured(value)) return null;
  try {
    return new URL(value as string);
  } catch {
    return null;
  }
}

function validDatabaseUrl(value: string | undefined) {
  const url = parseUrl(value);
  return Boolean(url && (url.protocol === "postgres:" || url.protocol === "postgresql:"));
}

function validHttpsUrl(value: string | undefined) {
  const url = parseUrl(value);
  return Boolean(url && url.protocol === "https:");
}

function validCorsOrigins(value: string | undefined) {
  const origins = value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
  return origins.length > 0 && origins.every((origin) => {
    const url = parseUrl(origin);
    return Boolean(
      url &&
        (url.protocol === "https:" || url.protocol === "http:") &&
        origin === url.origin
    );
  });
}

function enabled(value: string | undefined) {
  return value === "1" || value?.toLowerCase() === "true";
}

function validSigningSecret(value: string | undefined) {
  return Boolean(value && value.trim().length >= 32);
}

function firebaseProjectCheck(env: Env, productionLike: boolean): ReadinessCheck {
  if (!productionLike) {
    return {
      name: "firebase_project_id",
      ok: true,
      required: false,
      message: "Firebase project configuration optional in development"
    };
  }

  if (!configured(env.FIREBASE_PROJECT_ID)) {
    return {
      name: "firebase_project_id",
      ok: false,
      required: true,
      message: "FIREBASE_PROJECT_ID is required outside development"
    };
  }

  return { name: "firebase_project_id", ok: true, required: true, message: "Firebase project configured" };
}

async function databaseReachabilityCheck(
  env: Env,
  productionLike: boolean,
  probe: (env: Env) => Promise<void>
): Promise<ReadinessCheck> {
  const required = productionLike || enabled(env.READINESS_CHECK_DATABASE);
  if (!required) {
    return {
      name: "database_reachable",
      ok: true,
      required: false,
      message: "live database probe disabled"
    };
  }

  if (!validDatabaseUrl(env.NEON_DATABASE_URL)) {
    return {
      name: "database_reachable",
      ok: false,
      required: true,
      message: "live database probe requires a valid NEON_DATABASE_URL"
    };
  }

  try {
    await probe(env);
    return {
      name: "database_reachable",
      ok: true,
      required,
      message: "database connection verified"
    };
  } catch (error) {
    return {
      name: "database_reachable",
      ok: false,
      required: true,
      message: `database connection failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export async function buildReadinessReport(env: Env, options: ReadinessOptions = {}): Promise<ReadinessReport> {
  const productionLike = env.APP_ENV !== "development";
  const databaseProbe = options.pingDatabase ?? pingDatabase;
  const checks: ReadinessCheck[] = [
    {
      name: "database_url",
      ok: validDatabaseUrl(env.NEON_DATABASE_URL),
      required: true,
      message:
        !configured(env.NEON_DATABASE_URL)
          ? "NEON_DATABASE_URL is missing"
          : validDatabaseUrl(env.NEON_DATABASE_URL)
            ? "database connection configured"
            : "NEON_DATABASE_URL must be a valid postgres connection URL"
    },
    await databaseReachabilityCheck(env, productionLike, databaseProbe),
    {
      name: "artifact_bucket",
      ok: Boolean(env.R2_BUCKET),
      required: true,
      message: env.R2_BUCKET ? "artifact bucket binding configured" : "R2_BUCKET binding is missing"
    },
    firebaseProjectCheck(env, productionLike),
    {
      name: "cors_origin",
      ok: !productionLike || validCorsOrigins(env.CORS_ORIGIN),
      required: productionLike,
      message:
        !productionLike
          ? "browser origin allowlist configured"
          : !configured(env.CORS_ORIGIN)
            ? "CORS_ORIGIN is required outside development"
            : validCorsOrigins(env.CORS_ORIGIN)
              ? "browser origin allowlist configured"
              : "CORS_ORIGIN must contain comma-separated HTTP(S) origins without paths"
    },
    {
      name: "firebase_google_only",
      ok: !productionLike || configured(env.FIREBASE_PROJECT_ID),
      required: productionLike,
      message:
        !productionLike
          ? "Firebase Google-only token verification configured"
          : "FIREBASE_PROJECT_ID is required for Firebase Google-only token verification"
    },
    {
      name: "auth_login_url",
      ok: true,
      required: false,
      message:
        "Firebase client sign-in does not require a server login handoff"
    },
    {
      name: "durable_rate_limiter",
      ok: !productionLike || Boolean(env.RATE_LIMITER),
      required: productionLike,
      message:
        !productionLike || Boolean(env.RATE_LIMITER)
          ? "Durable rate limiter binding configured"
          : "RATE_LIMITER Durable Object binding is required outside development"
    },
    {
      name: "observability_webhook",
      ok:
        !productionLike ||
        enabled(env.OBSERVABILITY_NATIVE) ||
        (validHttpsUrl(env.OBSERVABILITY_WEBHOOK_URL) && configured(env.OBSERVABILITY_WEBHOOK_TOKEN)),
      required: productionLike,
      message:
        !productionLike
          ? "observability configured"
          : enabled(env.OBSERVABILITY_NATIVE)
            ? "Cloudflare native observability configured"
            : !configured(env.OBSERVABILITY_WEBHOOK_URL)
            ? "OBSERVABILITY_WEBHOOK_URL is required outside development"
            : validHttpsUrl(env.OBSERVABILITY_WEBHOOK_URL)
              ? configured(env.OBSERVABILITY_WEBHOOK_TOKEN)
                ? "observability webhook configured"
                : "OBSERVABILITY_WEBHOOK_TOKEN is required outside development"
              : "OBSERVABILITY_WEBHOOK_URL must be a valid HTTPS URL"
    },
    {
      name: "signing_secret",
      ok: !productionLike || validSigningSecret(env.SIGNING_SECRET),
      required: productionLike,
      message:
        !productionLike
          ? "server event signing configured"
          : validSigningSecret(env.SIGNING_SECRET)
            ? "server event signing secret configured"
            : "SIGNING_SECRET must be at least 32 characters outside development"
    }
  ];

  return {
    ok: checks.every((check) => !check.required || check.ok),
    env: env.APP_ENV,
    checks
  };
}
