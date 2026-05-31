# Northline Operations Runbook

This runbook defines the minimum evidence required before promoting Northline to a production-like environment and the operational checks to run after every release.

## Release Gates

Run these checks before every deploy:

```bash
pnpm install --frozen-lockfile
pnpm release:check
```

Run the live database integration check when a disposable Postgres-compatible database is available:

```bash
$env:NORTHLINE_TEST_DATABASE_URL="postgresql://..."
pnpm test:db
```

The database test creates an isolated schema, applies every migration, verifies row-level security primitives, and drops the schema when complete.

## Required Production Configuration

The Worker must not be promoted unless `GET /ready` returns `200`.

Required bindings and variables:

| Control | Requirement | Evidence |
|---|---|---|
| Database | `NEON_DATABASE_URL` is a valid Postgres connection URL for the production database role | `/ready` check `database_url` is passing |
| Live database probe | Production-like environments always verify database reachability; development can opt in with `READINESS_CHECK_DATABASE=true` | `/ready` check `database_reachable` is passing |
| Artifact storage | `R2_BUCKET` binding exists | `/ready` check `artifact_bucket` is passing |
| JWT validation | `JWT_PUBLIC_KEY` is a valid importable RS256 public key | `/ready` check `jwt_public_key` is passing |
| Token constraints | `JWT_ISSUER` is an HTTPS issuer URL and `JWT_AUDIENCE` is configured | `/ready` check `issuer_audience` is passing |
| Identity handoff | `AUTH_LOGIN_URL` points to the production identity-provider authorization URL | `/ready` check `auth_login_url` is passing |
| Browser allowlist | `CORS_ORIGIN` contains every deployed frontend HTTP(S) origin without paths | `/ready` check `cors_origin` is passing |
| Coordinated throttling | `RATE_LIMITER` Durable Object binding exists | `/ready` check `durable_rate_limiter` is passing |
| Telemetry | `OBSERVABILITY_WEBHOOK_URL` is an HTTPS collector URL and `OBSERVABILITY_WEBHOOK_TOKEN` authenticates delivery | `/ready` check `observability_webhook` is passing and collector receives error events during smoke tests |
| Server event signing | `SIGNING_SECRET` is at least 32 characters and rotated through the deployment secret store | `/ready` check `signing_secret` is passing; server-generated events use `server:v1:*` signatures |

Optional tuning:

| Variable | Default | Use |
|---|---:|---|
| `RATE_LIMIT_MAX_REQUESTS` | `120` | Per-client API request allowance |
| `RATE_LIMIT_WINDOW_SECONDS` | `60` | Rate-limit rolling window |
| `OBSERVABILITY_SAMPLE_RATE` | `0.05` | Request telemetry sampling rate; errors and authorization denials always emit |
| `SIGNING_SECRET` | required outside development | HMAC secret for server-generated event hashes |
| `AUTH_LOGIN_URL` | empty | HTTPS identity-provider entry point shown by frontend session gates |
| `AUTH_CLIENT_ID` | empty | Public client identifier shown in auth config |
| `AUTH_SCOPES` | empty | Public auth scopes shown in auth config |

## Deployment Procedure

1. Apply database migrations in order from `db/migrations`.
2. Confirm RLS policies are enabled on tenant-scoped tables.
3. Configure Worker secrets and bindings for the target environment.
4. Deploy the Worker.
5. Call `GET /health`; it must return `200`.
6. Call `GET /ready`; every required check must be `ok: true`.
7. Deploy web, mobile, and tablet frontends with production API URLs.
8. Sign in through the configured identity provider and verify `/v1/auth/session` returns the expected tenant, actor, and roles.
9. Generate or install field-device signing keys, then register their public keys through `/v1/sync/device/register-self` for user devices or the admin device registry for vessel/group/org devices before accepting production sync traffic.
10. Run a smoke workflow:
    - Open portal dashboard and load trips, sync metrics, devices, rulesets, and audit events.
    - Verify `/v1/ais/stream` rejects unauthenticated WebSocket upgrades and accepts only authenticated short-lived session tokens.
    - Open mobile app, confirm a trusted device key is installed, queue an offline draft event, reload, sync it, confirm the queue reconciles, then queue one more event and verify it extends the accepted device chain.
    - Open tablet app, load trip context, and verify vessel workflow actions reach the API.
    - Generate a compliance export and confirm the artifact can be retrieved from R2.

## Operational Monitoring

Monitor these signals continuously:

| Signal | Source | Action |
|---|---|---|
| Readiness failure | `GET /ready` | Block promotion; page on-call if production regresses |
| Error telemetry | `OBSERVABILITY_WEBHOOK_URL` collector | Triage by `request_id`, method, path, and environment |
| Rate-limit spikes | `429` responses and telemetry | Check client loops, token misuse, or attack traffic |
| Sync rejection rate | `/v1/sync/metrics` and audit trail | Inspect device signatures, schema drift, and rejected event ids |
| Audit activity | `/v1/audit/events` and fail-closed API responses | Review sensitive operations and unexpected role use; outside development, sensitive operations must not succeed when audit writes fail |
| Authorization denials | Structured `authorization_denied` logs and first-class authorization-denial telemetry | Investigate actor, role, path, request id, and required roles for unexpected access attempts |
| Projection freshness | Ops dashboard and trip state | Reconcile accepted events if projected tables lag |

## Incident Response

For auth failures:

1. Confirm `JWT_PUBLIC_KEY`, `JWT_ISSUER`, and `JWT_AUDIENCE` match the active identity provider.
2. Verify frontend users are not using static `VITE_*` bearer tokens in production.
3. Inspect telemetry for `401` and `403` responses by `request_id`.

For sync failures:

1. Keep clients online; the mobile queue is durable in IndexedDB with a localStorage fallback.
2. Export queued drafts from the mobile app before clearing browser data.
3. Confirm the device has a registered, non-revoked signing key.
4. Confirm the mobile server-event cache and download cursor both survive a browser reload after a successful queue sync.
5. Inspect rejected event ids returned by `/v1/sync/upload`; hash mismatches indicate a tampered or stale event envelope, while `hash_chain_gap` and `hash_chain_conflict` indicate missing or out-of-order device history.

For database incidents:

1. Put the deployment behind a maintenance page or remove frontend traffic while preserving API evidence.
2. Verify tenant RLS context before running manual SQL.
3. Re-run migrations in a disposable schema using `pnpm test:db`.
4. Restore projections from accepted event history if projected tables are stale or damaged; rebuild replay uses server append order (`ts_server`, then deterministic tie-breakers) so skewed field-device clocks do not reorder operational truth. Gear and catch rebuilds replace stale rows for the target trip before replaying accepted events.

For artifact incidents:

1. Verify the `R2_BUCKET` binding and object permissions.
2. Regenerate exports only after confirming audit logging is operational.
3. Compare generated artifact ids with audit events for the same actor and tenant.

## Rollback Criteria

Rollback or halt promotion when any of these are true:

- `/ready` returns `503` in a production-like environment.
- Production accepts `dev:*` event signatures.
- Production accepts an event whose canonical hash does not match its submitted `event_hash`.
- A crew role can access audit logs, device administration, ruleset writes, compliance signing, or export generation.
- Audit writes fail for sensitive operations in production-like environments.
- Offline queued drafts are lost during reload or partial sync reconciliation.
- Telemetry export is unavailable during an active incident.

## Evidence Packet

Attach this evidence to every release:

- Commit SHA and environment name.
- Output summary from `pnpm release:check`.
- Output summary from `pnpm test:db`, or a note that no live database URL was available.
- `/ready` JSON response from the target Worker.
- Identity-provider token smoke result for `/v1/auth/session`.
- Mobile offline queue smoke result, including durable downloaded-event cache, durable download cursor, and `/v1/sync/ack` confirmation.
- Audit console screenshot or API response showing the release smoke actions.
