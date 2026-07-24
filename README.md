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
pnpm install --frozen-lockfile
pnpm dev
pnpm release:check
```

## API health gates

- `GET /health` confirms the Worker is reachable.
- `GET /ready` validates required deployment controls and returns `503` when production-like auth, CORS, database, artifact, rate-limit, telemetry, or server-signing bindings are missing.

## Environment

- `NEON_DATABASE_URL` (valid `postgres://` or `postgresql://` connection URL)
- `READINESS_CHECK_DATABASE` (`true`/`1` enables a live `select 1` database probe in `/ready`)
- `FIREBASE_PROJECT_ID` (required outside development; API verifies only Google Firebase ID tokens for this project)
- `INITIAL_ORG_ADMIN_UID` / `INITIAL_ORG_ADMIN_TENANT_ID` (one-time bootstrap mapping for the first Google user; remove after inserting durable memberships)
- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` (public Firebase web configuration for each frontend build)
- `CORS_ORIGIN` (comma-separated production/staging HTTP(S) browser origin allowlist, without paths)
- `RATE_LIMIT_MAX_REQUESTS` / `RATE_LIMIT_WINDOW_SECONDS` (optional API throttle tuning; production uses `RATE_LIMITER` Durable Object binding)
- `OBSERVABILITY_WEBHOOK_URL` (valid HTTPS collector URL, required outside development) / `OBSERVABILITY_WEBHOOK_TOKEN` (required outside development) / `OBSERVABILITY_SAMPLE_RATE` (optional structured request/error telemetry tuning)
- `SIGNING_SECRET` (at least 32 characters outside development; signs server-generated event hashes)
- `R2_BUCKET` (for artifact storage binding)
- `STRIPE_SECRET_KEY` (Worker secret; never expose this to a browser)
- `STRIPE_PRICE_ID` (the server-configured Stripe Price ID; products and amounts are not accepted from clients)
- `STRIPE_CHECKOUT_MODE` (`subscription` or `payment`; defaults to `subscription`)
- `STRIPE_SUCCESS_URL` / `STRIPE_CANCEL_URL` (HTTPS browser URLs outside development)
- `STRIPE_WEBHOOK_SECRET` (Worker secret used to verify the raw Stripe webhook payload)

Billing endpoints: `POST /v1/billing/checkout` is limited to tenant `OWNER` and `ORG_ADMIN` users and returns a Stripe-hosted Checkout URL. `POST /v1/billing/webhook` is intentionally unauthenticated because Stripe signs it; it accepts only a valid, current `Stripe-Signature` and updates the tenant's entitlement projection idempotently. Apply `db/migrations/0011_stripe_billing.sql` before configuring the webhook. Use Stripe Checkout's webhook endpoint URL, not a browser route.

Production browser builds use Firebase Google sign-in only. The active frontend clients exchange the Firebase ID token with the API at runtime, verify `/v1/auth/session` before rendering the operations workspace, and store the resulting runtime token under `northline.apiToken`; no static bearer token is shipped in `VITE_*` variables.
Production frontend artifacts are checked by `pnpm verify:dist` so public builds do not publish source maps, static development tokens, or incomplete PWA install metadata.
When smoke-testing preview servers, run `pnpm verify:app-identity` before using screenshots or browser state as evidence. It fails if a local port is serving another app.

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
