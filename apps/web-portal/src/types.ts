export interface KpiCard {
  label: string;
  value: string;
  trend: string;
}

export interface HazardRow {
  id: string;
  type: string;
  confidence: number;
  scope: "PRIVATE" | "GROUP" | "ORG" | "DELAYED_PUBLIC" | "PUBLIC";
}

export interface CertificateRow {
  certificate_id: string;
  lot_id: string;
  trip_id: string;
  issued_at: string;
  hash: string;
}
