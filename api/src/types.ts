import type { SqlValue } from "./lib/db";

export interface ObjectBucket {
  put(key: string, value: string | ArrayBuffer | ArrayBufferView, options?: { httpMetadata?: { contentType?: string } }): Promise<void>;
  get(key: string): Promise<unknown>;
}

export interface Env {
  APP_ENV: "development" | "staging" | "production";
  NEON_DATABASE_URL?: string;
  JWT_PUBLIC_KEY?: string;
  JWT_ISSUER?: string;
  JWT_AUDIENCE?: string;
  AUTH_LOGIN_URL?: string;
  AUTH_CLIENT_ID?: string;
  AUTH_SCOPES?: string;
  CORS_ORIGIN?: string;
  RATE_LIMIT_MAX_REQUESTS?: string;
  RATE_LIMIT_WINDOW_SECONDS?: string;
  RATE_LIMIT_NAMESPACE?: string;
  READINESS_CHECK_DATABASE?: string;
  OBSERVABILITY_WEBHOOK_URL?: string;
  OBSERVABILITY_WEBHOOK_TOKEN?: string;
  OBSERVABILITY_SAMPLE_RATE?: string;
  SIGNING_SECRET?: string;
  R2_BUCKET: ObjectBucket;
  RATE_LIMITER?: DurableObjectNamespace;
  DB?: D1Database;
  // AIS Proxy configuration
  AIS_PROXY_URL?: string;
  AISSTREAM_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  AIS_AI_TIMEOUT_MS?: string;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  exec(query: string): Promise<D1ExecResult>;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

export interface D1PreparedStatement {
  bind(...values: SqlValue[]): D1PreparedStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<D1Result<T>>;
  run(): Promise<D1ExecResult>;
}

export interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  meta?: unknown;
}

export interface D1ExecResult {
  success: boolean;
  meta?: unknown;
}

export interface SyncUploadRequest {
  cursor?: string;
  events: unknown[];
}

export interface AuthContext {
  tenantId: string;
  actorId: string;
  role: "CAPTAIN" | "CREW" | "OWNER" | "GUIDE" | "PROCESSOR" | "ORG_ADMIN";
}
