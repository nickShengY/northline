# Northline API Contracts (v1)

## Auth

- Header: `Authorization: Bearer <tenant_id>:<actor_id>:<role>` (dev mode)
- All `/v1/*` routes are tenant-scoped.
- Outside development, bearer tokens must be issuer- and audience-constrained RS256 JWTs with `sub`, `tenant_id`, `role`, and `exp` claims. Missing or invalid tenant, role, or expiration claims are rejected.
- AIS WebSocket stream upgrades are authenticated as well. Non-browser clients should send the normal `Authorization` header; browser clients should use `sec-websocket-protocol: northline-token.<token>`. Query-string WebSocket tokens are accepted only in development to avoid leaking production credentials through URLs, browser history, or edge request logs. The API strips local auth tokens before connecting to the AIS upstream.
- API responses include defensive HTTP headers (`nosniff`, frame denial, restrictive CSP, no-referrer, and production HSTS).
- Route path segments and identifier query filters are bounded to URL-safe identifier characters and length-limited before database access. Full query strings are capped at 4096 bytes.

## Sync Service

- `POST /v1/sync/upload`
  - Input: `{ cursor?: string, events: OpsEvent[] }`
  - Limits: at most 250 events per upload request.
  - Optional `cursor` is capped at 256 URL-safe cursor characters.
  - Behavior: validate schema, verify hash chain, dedupe by `event_id`, append valid events
  - Output: `{ cursor, accepted_count, rejected[], server_generated_events[] }`
- `GET /v1/sync/download?cursor=<opaque_cursor>&limit=1000`
  - Output: `{ cursor, events[] }`
  - `limit` must be an integer from 1 to 5000.
  - Cursor is opaque to clients and capped at 256 URL-safe cursor characters. Current cursors are `ts_server|event_id`; timestamp-only cursors remain accepted for older clients.
- `POST /v1/sync/ack`
  - Input: `{ cursor: string, device_id?: string, scope?: string }`
  - Limits: `cursor` is capped at 256 URL-safe cursor characters; optional `device_id` and `scope` are bounded URL-safe identifiers.
  - Behavior: persists a tenant-scoped cursor acknowledgement when database persistence is configured; staging/production fail closed if persistence is unavailable. When `device_id` is provided, the device must be registered, unrevoked, and authorized for the caller before a checkpoint is written.
  - Output: `{ ok: true, cursor, acknowledged_at, ack_id? }`
- `POST /v1/sync/metrics`
  - Input: `{ metric_name, metric_value, device_id?, dimension_json? }`
  - Limits: `metric_value` must be finite and non-negative; `dimension_json` must be 4096 bytes or less; optional `device_id` must be a bounded URL-safe identifier.
  - Behavior: when `device_id` is provided, the device must be registered, unrevoked, and authorized for the caller before the metric is attributed to it.
- `GET /v1/sync/metrics/summary?hours=24`
  - `hours` must be an integer from 1 to 168.
- `POST /v1/sync/device/register`
  - Input: `{ device_id, subject_type, subject_id, public_key, key_version }`
  - Limits: `device_id` and `subject_id` must be bounded URL-safe identifiers; `public_key` must be a 24-128 character base64url Ed25519 public key.
- `POST /v1/sync/device/revoke/:deviceId`
- `GET /v1/sync/devices`
  - Requires `ORG_ADMIN`, `OWNER`, or `CAPTAIN`.

## Integrations

- `GET /v1/integrations/status`
  - Output: non-secret integration status fields: `integration_id`, `integration_type`, `provider`, `enabled`, and `updated_at`.
  - Optional `type` filter must be a bounded URL-safe identifier.
- `GET /v1/integrations/configs`
  - Requires `ORG_ADMIN` or `OWNER`.
  - Optional `type` filter must be a bounded URL-safe identifier.
  - Output config payloads are redacted by default. Secret-like fields such as API keys, tokens, passwords, authorization headers, client secrets, and access keys are returned as `[REDACTED]`.
- `POST /v1/integrations/configs/upsert`
  - Requires `ORG_ADMIN` or `OWNER`.
  - Limits: `config_json` must be 32 KiB or less.
- `POST /v1/integrations/configs/:integrationId/test`
  - Requires `ORG_ADMIN` or `OWNER`.

## Operations Service

- `GET /v1/ops/dashboard`
  - Output: `{ active_trips, missing_gear, compliance_issues_open, hazard_count }`
- `GET /v1/ops/trips?status=ACTIVE&mode=OFFSHORE`
  - Optional `status` and `mode` filters must be bounded URL-safe identifiers.
- `GET /v1/ops/trip/:tripId/state`
  - Output: `{ trip, gear[], hazards, compliance }`
- `GET /v1/ops/trip/:tripId/timeline?limit=120`
  - `limit` must be an integer from 1 to 5000.
  - Output: `{ trip_id, count, timeline[] }`
- `GET /v1/ops/trip/:tripId/compliance/summary`
- `POST /v1/ops/trip/:tripId/compliance/sign`
  - Input: `{ pkg_id? }`

## AIS AI Service

- `GET /v1/ais/nearby?lat=<lat>&lon=<lon>&radius=<km>`
  - `lat` must be between -90 and 90, `lon` between -180 and 180, and optional `radius` must be 1 to 500 km.
- `POST /v1/ais/risk/assess`
  - Body limit: 64 KiB.
  - Input cap: `vessels.length <= 25`.
  - Behavior: uses OpenRouter when configured and falls back to deterministic local risk analysis when upstream AI is unavailable.
- `POST /v1/ais/ai/recommendations`
  - Body limit: 64 KiB.
  - Behavior: uses OpenRouter when configured and falls back to deterministic local recommendations when upstream AI is unavailable.
- `POST /v1/ais/risk/predict-collision`
  - Body limit: 64 KiB.
  - Behavior: uses OpenRouter when configured and falls back to deterministic local CPA-style prediction when upstream AI is unavailable.
- `POST /v1/ais/ai/behavior`
  - Body limit: 64 KiB.
  - Input cap: `observations.length <= 500`.

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
  - Optional `scope` must be one of `PRIVATE`, `GROUP`, `ORG`, `DELAYED_PUBLIC`, or `PUBLIC`.
- `POST /v1/safety/checkin/schedule`
- `POST /v1/safety/checkin/complete`
- `POST /v1/safety/checkin/missed`
- `GET /v1/safety/checkins/:tripId`
- `POST /v1/safety/stop-work/trigger`
  - Any authenticated field user may trigger a stop-work event.
- `POST /v1/safety/stop-work/:stopId/acknowledge`
  - Behavior: records the acknowledging actor and writes an audit entry.
- `POST /v1/safety/stop-work/:stopId/clear`
  - Roles: `ORG_ADMIN`, `OWNER`, `CAPTAIN`
  - Behavior: clears active stop-work state, emits provenance, and writes an audit entry.
- `POST /v1/safety/mob/start`
  - Any authenticated field user may start a MOB workflow.
  - Location coordinates must use valid latitude and longitude ranges when provided.
- `POST /v1/safety/mob/update`
  - Limits: `checklist_json` must be 32 KiB or less; `roles_assigned` must be 8 KiB or less.
  - Behavior: updates an active MOB workflow, emits provenance, and writes an audit entry.
- `POST /v1/safety/mob/:workflowId/complete`
  - Roles: `ORG_ADMIN`, `OWNER`, `CAPTAIN`
  - Behavior: resolves the MOB workflow, emits provenance, and writes an audit entry.
- `POST /v1/safety/shelter/heater-flag`
  - Input: `{ trip_id, shelter_id?, reason? }`
- `POST /v1/safety/shelter/co-reminder-ack`
  - Input: `{ trip_id, shelter_id? }`
- `POST /v1/safety/near-miss`
  - Limits: at most 20 witness IDs.
  - Location coordinates must use valid latitude and longitude ranges when provided.
- `POST /v1/safety/briefing`
  - Limits: `checklist_json` must be 32 KiB or less.
- `POST /v1/safety/playbook/trigger`
  - Limits: `context_json` must be 16 KiB or less.

## Gear Service

- `POST /v1/gear/transition`
  - Input: `{ trip_id, gear_id, mode, transition, position?, note? }`
  - Transition values: `SET|CHECKED|HAULED|MISSING|RECOVERED|REMOVED`
- `POST /v1/gear/sweep-check`
  - Input: `{ trip_id, mode, outstanding_gear_ids[] }`
  - Limits: at most 500 outstanding gear IDs.
  - Output: blocked/ok sweep status
- `GET /v1/gear/trip/:tripId?mode=OFFSHORE|ICE`
  - Optional `mode` must be `OFFSHORE` or `ICE`.

## Ice Station Service

- `POST /v1/station/create`
  - Location coordinates must use valid latitude and longitude ranges.
- `POST /v1/station/update`
  - Location coordinates must use valid latitude and longitude ranges when provided.
- `POST /v1/station/tipup/set`
  - Location coordinates must use valid latitude and longitude ranges when provided.
- `GET /v1/station/trip/:tripId`
- `GET /v1/station/tipups/:tripId`
  - Optional `station_id` filter must be a bounded URL-safe identifier.
- `POST /v1/station/remove/:stationId`
  - Roles: `ORG_ADMIN`, `OWNER`, `CAPTAIN`
  - Behavior: marks the station removed, emits provenance, and writes an audit entry.
- `POST /v1/ice/thickness`
  - Location coordinates must use valid latitude and longitude ranges.
- `POST /v1/ice/route-point`
  - Location coordinates must use valid latitude and longitude ranges.
- `DELETE /v1/ice/route-point/:pointId`
  - Roles: `ORG_ADMIN`, `OWNER`, `CAPTAIN`
  - Behavior: deletes a route point and writes an audit entry.
- `POST /v1/ice/return-plan`
  - Limits: at most 10 escalation contacts; `route_summary` must be 8 KiB or less.
- `POST /v1/ice/return-plan/:planId/escalate`
  - Behavior: escalates a return plan, emits provenance, and writes an audit entry.
- `POST /v1/ice/return-plan/:planId/complete`
  - Behavior: marks a return plan complete and writes an audit entry.

## Catch Service

- `POST /v1/catch/record`
  - Limits: at most 20 photo references.
  - Location coordinates must use valid latitude and longitude ranges when provided.
- `POST /v1/catch/correct`
  - Input: `{ catch_id, corrections }`
  - Roles: `ORG_ADMIN`, `OWNER`, `CAPTAIN`, `PROCESSOR`
  - Corrections are limited to known catch fields such as `species`, `kept`, `release_reason`, `length_cm`, `weight_kg`, `station_id`, `gear_id`, `method`, `measurement_confidence`, `qa_flagged`, and `qa_reason`.
  - Behavior: applies corrections to the catch record, emits a `CATCH_CORRECTED` event for replayable provenance, and writes an audit entry with corrected field names.
- `POST /v1/catch/qa`
  - Input: `{ catch_id, flagged, reason }`
  - Roles: `ORG_ADMIN`, `OWNER`, `CAPTAIN`, `PROCESSOR`
  - Behavior: updates QA flag state, emits a provenance event, and writes an audit entry.
- `GET /v1/catch/trip/:tripId`
  - Optional `species` filter must be a bounded URL-safe identifier.
- `GET /v1/catch/summary/:tripId`

## Rules Service

- `GET /v1/rules/effective?mode=OFFSHORE|ICE&region=<code>&effective_date=YYYY-MM-DD`
  - `mode` must be `OFFSHORE` or `ICE`; optional `region` must be a bounded URL-safe identifier; optional `effective_date` must be `YYYY-MM-DD`.
- `GET /v1/rules/risk-policy?mode=OFFSHORE|ICE`
- `GET /v1/rules/all?mode=OFFSHORE|ICE`
- `POST /v1/rules/upsert`
  - Roles: `ORG_ADMIN`, `OWNER`
  - Limits: `rules_json` must be 64 KiB or less.
- `POST /v1/rules/risk-policy/upsert`
  - Roles: `ORG_ADMIN`, `OWNER`
  - Limits: `policy_json` must be 32 KiB or less.

## Trace Service

- `POST /v1/trace/lot/create`
  - Limits: `quality_json` must be 16 KiB or less; `species_totals` must have at most 100 non-negative entries and be 8 KiB or less.
- `POST /v1/trace/lot/scan-attach`
  - Limits: `species_totals` must have at most 100 non-negative entries and be 8 KiB or less.
- `GET /v1/trace/lot/:lotId`
- `GET /v1/trace/lots?trip_id=...`
  - Optional `trip_id` filter must be a bounded URL-safe identifier.
- `POST /v1/trace/certificate/issue`
  - Input: `{ lot_id, trip_id, vessel_or_group, event_ids[], stats }`
  - Limits: 1 to 500 provenance event IDs; `stats` must be 16 KiB or less.
  - Output: certificate + object key
  - Roles: `ORG_ADMIN`, `OWNER`, `CAPTAIN`, `PROCESSOR`
- `GET /v1/trace/certificate/:certificateId/verify`
- `GET /v1/trace/certificates?lot_id=...|trip_id=...`
  - Optional `lot_id` and `trip_id` filters must be bounded URL-safe identifiers.

## Training Service

- `POST /v1/training/assign`
  - Roles: `ORG_ADMIN`, `OWNER`, `CAPTAIN`
  - Behavior: assigns required training, emits provenance, and writes an audit entry.
- `POST /v1/training/complete`
- `POST /v1/training/recommend`
- `GET /v1/training/user/:userId`
- `GET /v1/training/modules?mode=OFFSHORE|ICE`
  - Optional `mode` filter must be a bounded URL-safe identifier.
- `POST /v1/training/modules/upsert`
  - Roles: `ORG_ADMIN`, `OWNER`, `CAPTAIN`
  - Limits: `quiz_json` must be 32 KiB or less; `metadata_json` must be 16 KiB or less; at most 20 prerequisites.

## Export Service

- `POST /v1/export/compliance-package`
  - Input: `{ trip_id, format: JSON|CSV|PDF }`
  - Output: artifact metadata + compliance summary
  - Roles: `ORG_ADMIN`, `OWNER`, `CAPTAIN`, `PROCESSOR`
  - Generated report fields are encoded for the selected format. HTML/PDF reports escape interpolated content and CSV reports quote cells with formula-injection guards.
- `GET /v1/export/artifact/:artifactId`
  - Roles: `ORG_ADMIN`, `OWNER`, `CAPTAIN`, `PROCESSOR`
- `GET /v1/export/artifacts`
  - Roles: `ORG_ADMIN`, `OWNER`, `CAPTAIN`, `PROCESSOR`
  - Optional `kind` and `trip_id` filters must be bounded URL-safe identifiers.

## Semantic Transport Layer

- `POST /v1/stl/packet`
  - Limits: `payload_json` must be 64 KiB or less; `source_event_ids` must contain 1 to 100 IDs.
- `POST /v1/stl/upload`
- `POST /v1/stl/ack`
  - Limits: acknowledges 1 to 250 packet IDs per request.
- `GET /v1/stl/queue`
- `POST /v1/stl/retry`

## Projection Admin

- `POST /v1/projection/rebuild`
  - Roles: `ORG_ADMIN`, `OWNER`, `CAPTAIN`
  - Input: `{ trip_id, projection_types?: ["trip_state"|"gear_state"|"catch_rollups"|"all"] }`
  - Behavior: replays accepted trip events in deterministic order and replaces stale gear/catch projection rows for rebuilt projection types.
  - Output includes `ok`, `error_count`, and per-projection results; projection rebuild errors return `ok: false`.
- `POST /v1/projection/rebuild/batch`
  - Roles: `ORG_ADMIN`, `OWNER`, `CAPTAIN`
  - Input: `{ trip_ids: string[] }`
  - Limits: 1 to 50 trip IDs per request; duplicate IDs are rebuilt once.
  - Output includes `ok`, `total_count`, `succeeded_count`, `failed_count`, and per-trip results. Trips with nested projection errors count as failed.

## Integrations Admin

- `GET /v1/integrations/configs`
  - Roles: `ORG_ADMIN`, `OWNER`
  - Returns redacted config payloads for admin review only.
- `POST /v1/integrations/configs/upsert`
  - Roles: `ORG_ADMIN`, `OWNER`
  - Limits: `config_json` must be 32 KiB or less.
- `POST /v1/integrations/configs/:integrationId/test`
  - Roles: `ORG_ADMIN`, `OWNER`

## Error shape

All validation failures use:

```json
{
  "error": "invalid_payload",
  "details": {}
}
```
