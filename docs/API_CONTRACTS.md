# Northline API Contracts (v1)

## Auth

- Header: `Authorization: Bearer <tenant_id>:<actor_id>:<role>` (dev mode)
- All `/v1/*` routes are tenant-scoped.

## Sync Service

- `POST /v1/sync/upload`
  - Input: `{ cursor?: string, events: OpsEvent[] }`
  - Behavior: validate schema, verify hash chain, dedupe by `event_id`, append valid events
  - Output: `{ cursor, accepted_count, rejected[], server_generated_events[] }`
- `GET /v1/sync/download?cursor=<iso_ts>`
  - Output: `{ cursor, events[] }`
- `POST /v1/sync/ack`
  - Input: `{ cursor: string }`
  - Output: `{ ok: true, cursor, acknowledged_at }`
- `POST /v1/sync/metrics`
  - Input: `{ metric_name, metric_value, device_id?, dimension_json? }`
- `GET /v1/sync/metrics/summary?hours=24`
- `POST /v1/sync/device/register`
  - Input: `{ device_id, subject_type, subject_id, public_key, key_version }`
- `POST /v1/sync/device/revoke/:deviceId`
- `GET /v1/sync/devices`

## Operations Service

- `GET /v1/ops/dashboard`
  - Output: `{ active_trips, missing_gear, compliance_issues_open, hazard_count }`
- `GET /v1/ops/trips?status=ACTIVE&mode=OFFSHORE`
- `GET /v1/ops/trip/:tripId/state`
  - Output: `{ trip, gear[], hazards, compliance }`
- `GET /v1/ops/trip/:tripId/timeline?limit=120`
  - Output: `{ trip_id, count, timeline[] }`
- `GET /v1/ops/trip/:tripId/compliance/summary`
- `POST /v1/ops/trip/:tripId/compliance/sign`
  - Input: `{ pkg_id? }`

## Safety Service

- `POST /v1/safety/risk/score`
  - Input: `{ mode, workloadIntensity, weatherSeverity, nearMissCount, daylightHoursLeft, soloOperator?, checkinMisses? }`
  - Output: `{ score, tier, rationale[], mitigations[] }`
- `POST /v1/safety/incident`
  - Input: `{ case_id, trip_id, category, severity, summary, action_taken? }`
  - Output: `{ ok, incident, emitted_event_id }`
- `GET /v1/safety/incident/:caseId`
- `GET /v1/safety/incidents/open`
- `POST /v1/safety/hazard/report`
- `POST /v1/safety/hazard/:hazardId/confirm`
- `GET /v1/safety/hazards?scope=GROUP|ORG|...`
- `POST /v1/safety/checkin/schedule`
- `POST /v1/safety/checkin/complete`
- `POST /v1/safety/checkin/missed`
- `GET /v1/safety/checkins/:tripId`

## Gear Service

- `POST /v1/gear/transition`
  - Input: `{ trip_id, gear_id, mode, transition, position?, note? }`
  - Transition values: `SET|CHECKED|HAULED|MISSING|RECOVERED|REMOVED`
- `POST /v1/gear/sweep-check`
  - Input: `{ trip_id, mode, outstanding_gear_ids[] }`
  - Output: blocked/ok sweep status
- `GET /v1/gear/trip/:tripId?mode=OFFSHORE|ICE`

## Rules Service

- `GET /v1/rules/effective?mode=OFFSHORE|ICE&region=<code>&effective_date=YYYY-MM-DD`
- `GET /v1/rules/risk-policy?mode=OFFSHORE|ICE`

## Trace Service

- `POST /v1/trace/lot/create`
- `POST /v1/trace/lot/scan-attach`
- `GET /v1/trace/lot/:lotId`
- `GET /v1/trace/lots?trip_id=...`
- `POST /v1/trace/certificate/issue`
  - Input: `{ lot_id, trip_id, vessel_or_group, event_ids[], stats }`
  - Output: certificate + object key
- `GET /v1/trace/certificate/:certificateId/verify`
- `GET /v1/trace/certificates?lot_id=...|trip_id=...`

## Training Service

- `POST /v1/training/assign`
- `POST /v1/training/complete`
- `POST /v1/training/recommend`
- `GET /v1/training/user/:userId`
- `GET /v1/training/modules?mode=OFFSHORE|ICE`
- `POST /v1/training/modules/upsert`

## Export Service

- `POST /v1/export/compliance-package`
  - Input: `{ trip_id, format: JSON|CSV|PDF }`
  - Output: artifact metadata + compliance summary
- `GET /v1/export/artifact/:artifactId`

## Error shape

All validation failures use:

```json
{
  "error": "invalid_payload",
  "details": {}
}
```
