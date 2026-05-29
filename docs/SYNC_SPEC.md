# Sync Protocol Spec

## 1) Design constraints

- Offline operation for multi-day periods.
- Append-only event upload; no destructive mutation.
- Deterministic reconstruction from event stream.
- Cursor-based paging for incremental sync.

## 2) Upload flow (`POST /v1/sync/upload`)

1. Client sends `cursor` + queued events.
2. Server validates envelope + payload schema.
3. Server verifies hash chain continuity per event.
4. Dedupe by `event_id`.
5. Append accepted events.
6. Return merged `rejected` list and server-generated validation events.

### Upload response fields

- `cursor`: server timestamp cursor
- `accepted_count`
- `rejected[]`: `{ event_id?, reason }`
- `server_generated_events[]`: currently `SYNC_VALIDATION_REJECTED`

## 3) Download flow (`GET /v1/sync/download`)

- Input cursor optional on first pull.
- Returns all events `ts_server > cursor` ordered ascending.
- `nextCursor = lastEvent.ts_server || inputCursor || now`.

## 4) ACK flow (`POST /v1/sync/ack`)

- Client confirms durable local receipt of server stream.
- Cursor checkpoint can be persisted per device.

## 5) Conflict model

- No row-level overwrites.
- Conflicts resolved with correction events:
  - `CATCH_CORRECTED`
  - `GEAR_CORRECTED` (future catalog entry)
  - `COMPLIANCE_FIELD_CORRECTED`
- Projection applies latest correction while preserving complete history.

## 6) Security model

- Tenant context enforced through RLS + `app.tenant_id`.
- Device signing key support is represented by `sync_device` table.
- Server-generated events are signed as `server-generated` and hash-chained.

## 7) Operational metrics

Track in `sync_health_metric`:

- `sync_success_rate`
- `sync_duration_ms` (p50/p90/p99)
- `conflict_rate`
- `upload_queue_depth`
- `data_staleness_seconds`
