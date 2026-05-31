# Sync Protocol Spec

## 1) Design constraints

- Offline operation for multi-day periods.
- Append-only event upload; no destructive mutation.
- Deterministic reconstruction from event stream.
- Cursor-based paging for incremental sync.

## 2) Upload flow (`POST /v1/sync/upload`)

Uploads are capped at 250 events per request so a single reconnecting client cannot monopolize validation, signature verification, or projection work. Clients with larger durable queues must send multiple batches and keep unsent events in local storage until accepted.
The optional upload cursor is bounded to 256 URL-safe cursor characters and is treated as opaque compatibility metadata.

1. Client sends `cursor` + queued events.
2. Server validates envelope + payload schema.
3. Server recomputes the canonical event hash and rejects mismatches.
4. Server verifies trusted device signatures outside local development.
5. Dedupe by `event_id`, preserving idempotent duplicate retries.
6. Server verifies device-chain continuity against the latest stored event hash for that device.
7. Append accepted events and update operational projections.
8. Return merged `rejected` list and server-generated validation events.

### Upload response fields

- `cursor`: upload completion timestamp for compatibility with older clients. Clients must not treat this as the durable download checkpoint.
- `accepted_count`
- `rejected[]`: `{ event_id?, reason }`
- `server_generated_events[]`: currently `SYNC_VALIDATION_REJECTED`

## 3) Download flow (`GET /v1/sync/download`)

- Input cursor optional on first pull.
- Returns events after the cursor ordered by `ts_server asc, event_id asc`.
- For timestamp-only cursors, the server returns `ts_server > cursor`.
- For `ts_server|event_id` cursors, the server returns `ts_server > cursor_ts` or the next `event_id` at the same timestamp.
- `nextCursor = lastEvent.ts_server|lastEvent.event_id || inputCursor || now`.
- Field clients persist downloaded server events and the returned download cursor durably before ACKing it. This cursor is the only client checkpoint used for future downloads.

## 4) ACK flow (`POST /v1/sync/ack`)

- Client confirms durable local receipt of server stream.
- Cursor checkpoint can be persisted per device, tenant, subject, or client scope.
- ACK `cursor` is bounded to 256 URL-safe cursor characters. Optional `device_id` and `scope` are bounded URL-safe identifiers before persistence.
- The API appends `sync_cursor_ack` rows when database persistence is configured. Staging and production fail closed if ACK persistence is unavailable so release evidence can prove client checkpoint receipt.

## 5) Conflict model

- No row-level overwrites.
- Conflicts resolved with correction events:
  - `CATCH_CORRECTED`
  - `GEAR_CORRECTED` (future catalog entry)
  - `COMPLIANCE_FIELD_CORRECTED`
- Projection applies latest correction while preserving complete history.

## 6) Security model

- Tenant context enforced through RLS + `app.tenant_id`.
- Device signing keys are registered in `sync_device`; staging/production uploads reject unsigned, tampered, or untrusted device events.
- Field clients can register their own `USER` device key through `/v1/sync/device/register-self`; broader device administration remains role-gated. Device ids and subject ids are bounded URL-safe identifiers; Ed25519 public keys are accepted only as bounded base64url strings.
- Server-generated events are created only inside the API, hash-chained, and signed as `server:v1:<hmac>` with `SIGNING_SECRET`. Uploads that attempt to submit `server-generated` or `server:*` signatures are rejected.

## 7) Operational metrics

Track in `sync_health_metric`:

- `sync_success_rate`
- `sync_duration_ms` (p50/p90/p99)
- `conflict_rate`
- `upload_queue_depth`
- `data_staleness_seconds`

Metric values must be finite and non-negative. Optional `dimension_json` is limited to 4096 bytes to keep telemetry rollups predictable. When a metric includes `device_id`, the API authorizes that attribution with the same trusted-device ownership rules used for cursor ACKs: user devices must belong to the authenticated actor, and vessel/group/org devices require an administrative or captain role.
