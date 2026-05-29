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

## Environment

- `NEON_DATABASE_URL`
- `JWT_PUBLIC_KEY` (for production auth verification)
- `CORS_ORIGIN` (comma-separated production/staging browser origin allowlist)
- `R2_BUCKET` (for artifact storage binding)

Production browser builds must use a runtime session/JWT token, not static `VITE_*` bearer tokens. The active frontend clients read `northline.apiToken` from browser storage until a dedicated sign-in shell is added.

## Key specs

- `docs/API_CONTRACTS.md`
- `docs/EVENT_CATALOG.md`
- `docs/SYNC_SPEC.md`
- `docs/CERTIFICATE_SPEC.md`
- `docs/RULESET_SPEC.md`
- `docs/UI_SCREEN_MAP.md`

Legacy field apps were moved to `legacy-apps/mobile-ice` and `legacy-apps/tablet-offshore` for reference only.
