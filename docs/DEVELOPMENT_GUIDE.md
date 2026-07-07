# Northline Development Guide

## Prerequisites

- Node.js 18+
- PNPM
- Git

## Quick Start

```bash
git clone <repository-url>
cd northline
pnpm install
pnpm dev
pnpm typecheck
pnpm test
```

## Development Servers

| Service | URL | Port | Description |
|---|---|---:|---|
| Web Portal | http://localhost:5173 | 5173 | Fleet management portal |
| Mobile Ops | http://localhost:5174 | 5174 | Unified offshore + ice field UI |
| Tablet Ops | http://localhost:5175 | 5175 | Vessel bridge/deck operations UI |
| API Backend | http://localhost:8787 | 8787 | Cloudflare Workers API |

## Project Structure

```text
northline/
  apps/
    web-portal/
    mobile-ops/
    tablet-ops/
  api/
  packages/
    shared/
  db/
  docs/
  legacy-apps/
```

## Workflow

1. Create a feature branch.
2. Implement changes in the relevant app/package.
3. Run validation:

```bash
pnpm release:check
```

4. Update docs for behavior or architecture changes.
5. Open PR with test notes.

For production-like promotion, follow `docs/OPERATIONS_RUNBOOK.md` and attach the evidence packet described there.

## Preview Smoke Checks

The app preview scripts bind to fixed local ports and fail if the port is occupied:

| App | Preview URL | Expected title |
|---|---|---|
| Web Portal | http://127.0.0.1:4173 | Northline Command Portal |
| Mobile Ops | http://127.0.0.1:4174 | Northline Field Ops |
| Tablet Ops | http://127.0.0.1:4175 | Northline Tablet Ops |

Before treating screenshots or browser walkthroughs as evidence, run:

```bash
pnpm verify:app-identity
```

If a port is occupied and you intentionally preview an app elsewhere, pass an override such as `pnpm verify:app-identity -- --only=mobile --mobile-url=http://127.0.0.1:4274/`.

## Notes

- `legacy-apps/` contains historical mobile implementations and is reference-only.
- New field features should be added to `apps/mobile-ops`.
- Vessel-mounted bridge/deck workflows belong in `apps/tablet-ops`.
- For production-like browser builds, do not place bearer tokens in `VITE_*` variables. The frontend session gate collects a runtime token, stores it in `sessionStorage` or `localStorage` under `northline.apiToken`, and verifies it against `/v1/auth/session` before rendering.
- If `AUTH_LOGIN_URL` is configured, the session gate shows an identity-provider sign-in action. Redirects can hand tokens back through `#access_token=...`, `#id_token=...`, or `?token=...`; the token is stored and then removed from browser history before session verification.
- Outside development, configure `CORS_ORIGIN` on the API as a comma-separated allowlist for deployed HTTP(S) web origins, without paths.
- Outside development, configure an importable RS256 `JWT_PUBLIC_KEY`, an HTTPS `JWT_ISSUER`, and `JWT_AUDIENCE` so the API rejects tokens from unexpected issuers or clients. Production-like JWTs must include `sub`, `tenant_id`, a valid Northline `role`, and `exp`; the API fails closed instead of defaulting missing claims.
- Configure `RATE_LIMIT_MAX_REQUESTS` and `RATE_LIMIT_WINDOW_SECONDS` per environment if the default API throttle of 120 requests per minute is not appropriate. Staging and production readiness require the `RATE_LIMITER` Durable Object binding so throttles are coordinated across Worker isolates.
- Configure an HTTPS `OBSERVABILITY_WEBHOOK_URL` and `OBSERVABILITY_WEBHOOK_TOKEN` outside development to export structured request, error, and authorization-denial events to an authenticated external collector. Errors and authorization denials are always emitted when configured; request events respect `OBSERVABILITY_SAMPLE_RATE`.
- Sync uploads in staging/production require registered device signatures. Local development can use `dev:*` signatures to keep PWA workflows fast.
- Sensitive operations such as device administration, ruleset changes, compliance signing, and export generation write audit records that admins can inspect through `/v1/audit/events`; outside development, audit write failures fail the operation closed.
- To validate migrations against a live Postgres-compatible database, set `NORTHLINE_TEST_DATABASE_URL` and run `pnpm test:db`. The test creates and drops an isolated schema. CI provides a disposable Postgres service for this check and blocks deploy jobs when it fails.
- Public production builds do not emit source maps by default. Set `VITE_ENABLE_SOURCEMAPS=true` only for controlled diagnostic builds, and keep `pnpm verify:dist` green before publishing frontend artifacts.
