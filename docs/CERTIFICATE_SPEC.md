# Lot Certificate Spec

## 1) Purpose

Tamper-evident lot certificate for offshore and ice workflows, anchored in event provenance.

## 2) Certificate payload

```json
{
  "lot_id": "lot_...",
  "tenant_id": "tenant_...",
  "trip_id": "trip_...",
  "vessel_or_group": "...",
  "issued_by": "actor_...",
  "event_ids": ["evt_1", "evt_2"],
  "stats": {},
  "issued_at": "2026-02-15T00:00:00.000Z",
  "schema_version": 1
}
```

## 3) Hashing behavior

- Hash algorithm: SHA-256
- Input: canonical JSON string of payload
- Output: base64url digest

## 4) IDs and storage

- `certificate_id = cert_<lot_id>_<hash_prefix>`
- DB metadata: `lot_certificate`
- Artifact blob: `certificates/<tenant>/<certificate_id>.json`

## 5) Verification endpoint

`GET /v1/trace/certificate/:certificateId/verify`

Returns:

- `verified: true` with DB metadata when found
- `verified: false, reason: not_found` on miss

## 6) Provenance rule

`provenance_event_ids` in DB must include all timeline events used to compute the certificate context.

## 7) Integrity checks (test requirements)

- Recompute hash from retrieved artifact payload.
- Assert recomputed hash matches DB hash.
- Assert artifact key in DB resolves to object store file.
