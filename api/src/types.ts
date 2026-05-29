import type { SqlValue } from "./lib/db";

export interface ObjectBucket {
  put(key: string, value: string | ArrayBuffer | ArrayBufferView, options?: { httpMetadata?: { contentType?: string } }): Promise<void>;
  get(key: string): Promise<unknown>;
}

export interface Env {
  APP_ENV: "development" | "staging" | "production";
  NEON_DATABASE_URL?: string;
  JWT_PUBLIC_KEY?: string;
  CORS_ORIGIN?: string;
  SIGNING_SECRET?: string;
  R2_BUCKET: ObjectBucket;
  DB?: D1Database;
  // AIS Proxy configuration
  AIS_PROXY_URL?: string;
  AISSTREAM_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
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
