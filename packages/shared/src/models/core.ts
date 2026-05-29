export type Mode = "OFFSHORE" | "ICE";

export type SubjectType = "VESSEL" | "USER" | "GROUP" | "ORG";

export type RiskTier = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

export interface OpsEvent<T = unknown> {
  event_id: string;
  tenant_id: string;
  subject_type: SubjectType;
  subject_id: string;
  actor_id: string;
  device_id: string;
  ts_device: string;
  ts_server?: string;
  event_type: string;
  schema_version: number;
  payload_json: T;
  prev_hash?: string;
  event_hash: string;
  signature: string;
}

export interface TripState {
  trip_id: string;
  tenant_id: string;
  mode: Mode;
  owner_id: string;
  status: "PLANNED" | "ACTIVE" | "ENDED" | "CANCELLED";
  started_at?: string;
  ended_at?: string;
  location_name?: string;
  completion_meter: number;
  compliance_open_issues: number;
  latest_risk_tier: RiskTier;
}

export interface GearState {
  gear_id: string;
  trip_id: string;
  mode: Mode;
  status: "REGISTERED" | "SET" | "CHECKED" | "HAULED" | "MISSING" | "RECOVERED" | "REMOVED";
  last_seen_at: string;
  last_position?: {
    lat: number;
    lon: number;
  };
  metadata: Record<string, unknown>;
}

export interface ComplianceIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
  fix_hint?: string;
}
