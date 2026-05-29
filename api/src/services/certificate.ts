import { sha256 } from "@northline/shared";

export interface CertificateInput {
  lot_id: string;
  tenant_id: string;
  trip_id: string;
  vessel_or_group: string;
  issued_by: string;
  event_ids: string[];
  stats: Record<string, unknown>;
}

export interface CertificateArtifact {
  certificate_id: string;
  issued_at: string;
  hash: string;
  payload: Record<string, unknown>;
}

export async function generateCertificate(input: CertificateInput): Promise<CertificateArtifact> {
  const issued_at = new Date().toISOString();
  const payload = {
    ...input,
    issued_at,
    schema_version: 1
  };
  const hash = await sha256(JSON.stringify(payload));

  return {
    certificate_id: `cert_${input.lot_id}_${hash.slice(0, 12)}`,
    issued_at,
    hash,
    payload
  };
}
