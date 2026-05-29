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
pnpm typecheck
pnpm build
pnpm test
```

4. Update docs for behavior or architecture changes.
5. Open PR with test notes.

## Notes

- `legacy-apps/` contains historical mobile implementations and is reference-only.
- New field features should be added to `apps/mobile-ops`.
- Vessel-mounted bridge/deck workflows belong in `apps/tablet-ops`.
- For production-like browser builds, do not place bearer tokens in `VITE_*` variables. The frontend expects a runtime session token in `sessionStorage` or `localStorage` under `northline.apiToken` until a full sign-in shell is added.
- Outside development, configure `CORS_ORIGIN` on the API as a comma-separated allowlist for deployed web origins.
