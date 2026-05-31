# Northline

Offline-first operations platform for:

- Offshore commercial king crab fishing
- Ice fishing operations and safety

## Monorepo Layout

- `apps/mobile-ops`: unified field app for offshore + ice crews (phone/tablet responsive)
- `apps/web-portal`: fleet, processor, organizer portal
- `apps/tablet-ops`: vessel bridge/deck operations UI
- `api`: Cloudflare Worker API and sync engine
- `packages/shared`: event schemas, sync primitives, risk/rules helpers
- `db`: SQL migrations, RLS policies, seed data
- `docs`: API contracts, event catalog, sync/certificate/ruleset specs, screen maps

## Implemented backend modules

- Auth + tenancy + RLS context
- Event sync + cursoring + sync health metrics
- Ops projections dashboard and trip state views
- Safety risk scoring + incident workflows
- Gear transitions + sweep checks
- Rules/risk-policy resolution
- Trace certificate issue/verify
- Training assignment/completion/recommendation
- Export artifact generation + retrieval

## Quick start

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test
```

## API health gates

- `GET /health` confirms the Worker is reachable.
- `GET /ready` validates required deployment controls and returns `503` when production-like auth, CORS, database, artifact, rate-limit, telemetry, or server-signing bindings are missing.

## Environment

- `NEON_DATABASE_URL` (valid `postgres://` or `postgresql://` connection URL)
- `READINESS_CHECK_DATABASE` (`true`/`1` enables a live `select 1` database probe in `/ready`)
- `JWT_PUBLIC_KEY` (importable RS256 public key for production auth verification)
- `JWT_ISSUER` (valid HTTPS issuer URL) / `JWT_AUDIENCE` (production token constraints)
- `AUTH_LOGIN_URL` (optional HTTPS frontend identity-provider handoff) / `AUTH_CLIENT_ID` / `AUTH_SCOPES`
- `CORS_ORIGIN` (comma-separated production/staging HTTP(S) browser origin allowlist, without paths)
- `RATE_LIMIT_MAX_REQUESTS` / `RATE_LIMIT_WINDOW_SECONDS` (optional API throttle tuning; production uses `RATE_LIMITER` Durable Object binding)
- `OBSERVABILITY_WEBHOOK_URL` (valid HTTPS collector URL, required outside development) / `OBSERVABILITY_WEBHOOK_TOKEN` (required outside development) / `OBSERVABILITY_SAMPLE_RATE` (optional structured request/error telemetry tuning)
- `SIGNING_SECRET` (at least 32 characters outside development; signs server-generated event hashes)
- `R2_BUCKET` (for artifact storage binding)

Production browser builds must use a runtime session/JWT token, not static `VITE_*` bearer tokens. The active frontend clients now start behind a session gate that verifies `/v1/auth/session` before rendering the operations workspace and stores tokens under `northline.apiToken` only after user entry.

Security-sensitive operations enforce role checks and are written to `audit_log`; outside development, audit persistence failures fail the operation closed.
Outside development, sync uploads require trusted device signatures from registered devices; development still accepts `dev:*` signatures for local field-app workflows.
Clients cannot upload server-signed events; server-origin events are generated only inside the API and signed with `SIGNING_SECRET`.

## Key specs

- `docs/API_CONTRACTS.md`
- `docs/EVENT_CATALOG.md`
- `docs/SYNC_SPEC.md`
- `docs/CERTIFICATE_SPEC.md`
- `docs/RULESET_SPEC.md`
- `docs/UI_SCREEN_MAP.md`
- `docs/OPERATIONS_RUNBOOK.md`

Legacy field apps were moved to `legacy-apps/mobile-ice` and `legacy-apps/tablet-offshore` for reference only.
