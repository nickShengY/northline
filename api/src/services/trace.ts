export interface ScanBatchInput {
  batch_id: string;
  source: "API" | "CSV" | "JSON" | "MANUAL";
  species_totals: Record<string, number>;
}

export interface LotStatsInput {
  species_totals: Record<string, number>;
}

export interface ScanMismatchResult {
  mismatch_rate: number;
  expected_total: number;
  observed_total: number;
  requires_review: boolean;
}

function totalFromMap(map: Record<string, number>): number {
  return Object.values(map).reduce((acc, value) => acc + (Number.isFinite(value) ? value : 0), 0);
}

export function detectScanMismatch(lotStats: LotStatsInput, batch: ScanBatchInput): ScanMismatchResult {
  const expected = totalFromMap(lotStats.species_totals);
  const observed = totalFromMap(batch.species_totals);
  const delta = Math.abs(expected - observed);
  const mismatchRate = expected > 0 ? delta / expected : observed > 0 ? 1 : 0;

  return {
    mismatch_rate: mismatchRate,
    expected_total: expected,
    observed_total: observed,
    requires_review: mismatchRate >= 0.08
  };
}

export function mergeSpeciesTotals(
  current: Record<string, number>,
  incoming: Record<string, number>
): Record<string, number> {
  const merged: Record<string, number> = { ...current };

  for (const [species, qty] of Object.entries(incoming)) {
    const safe = Number.isFinite(qty) ? qty : 0;
    merged[species] = (merged[species] ?? 0) + safe;
  }

  return merged;
}
