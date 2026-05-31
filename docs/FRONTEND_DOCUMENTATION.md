# Northline Frontend Documentation

## Overview

The active frontend is now composed of three React applications:

- `apps/web-portal`: shore-side fleet, compliance, and analytics portal
- `apps/mobile-ops`: unified field app for offshore and ice crews (phone + tablet responsive)
- `apps/tablet-ops`: vessel-mounted bridge/deck operations surface

The previous split mobile apps were consolidated and moved to:

- `legacy-apps/mobile-ice`
- `legacy-apps/tablet-offshore`

Those legacy folders are reference-only and are not part of the active workspace build graph.

## Applications

### 1. Web Portal (`apps/web-portal`)

Purpose:
- Fleet management and operational visibility
- Compliance, traceability, and export actions
- Live visualizations (fleet map, risk map, sync health, trace flow)

Productivity features:
- Command Center for fast action execution
- Role Command Center for owner, captain, compliance, and admin workflows
- Workspace presets (save/apply context trip/certificate/lot IDs)
- Batch trip workflows (multi-trip compliance sign/export)
- Guided compliance closeout with trace lot, blocker, signing, and export stages
- Trusted-device administration and audited ruleset publishing controls
- Audit Console for admin/owner review of sensitive operation history
- Session activity feed for operational traceability

Security boundary:
- All active apps start behind the shared `SessionGate`
- Runtime tokens are verified through `/v1/auth/session` before rendering the workspace
- Production browser builds use entered runtime tokens, not static `VITE_*` bearer tokens

Tech stack:
- React 18 + TypeScript
- Vite + PWA plugin
- Custom SVG chart/visualization components

Development:
```bash
cd apps/web-portal
pnpm dev    # http://localhost:5173
pnpm build
pnpm typecheck
```

### 3. Tablet Ops (`apps/tablet-ops`)

Purpose:
- Bridge/deck workflow for active vessel operations
- Gear status and transition controls
- Man-overboard and all-hands safety actions
- Bridge log, connected-device state, and live risk context
- Bridge decision-support playbook and watch handoff checklist

Tech stack:
- React 18 + TypeScript
- Vite + PWA plugin

Development:
```bash
cd apps/tablet-ops
pnpm dev    # http://localhost:5175
pnpm build
pnpm typecheck
```

### 2. Mobile Ops (`apps/mobile-ops`)

Purpose:
- One field app for offshore and ice workflows
- Simplified modular UX for safety, operations, hazards, and training
- Offline-friendly queueing behavior for weak/no connectivity

Core modules:
- Safety gate / check-ins
- Risk scoring
- Hazard reporting + shared hazard feed
- Gear transitions (offshore mode)
- Training recommendations

Productivity features:
- Quick command launcher for high-frequency actions
- Offline queue manager with manual sync/export/clear controls
- Sync repair review showing accepted/rejected events, rejection reasons, reconciliation, and quarantine controls
- Shift notes and clipboard-ready handoff summary
- Pinned modules and recent activity timeline

Tech stack:
- React 18 + TypeScript
- Vite + PWA plugin

Development:
```bash
cd apps/mobile-ops
pnpm dev    # http://localhost:5174
pnpm build
pnpm typecheck
```

## Styling and UX Standards

The active apps now share these baseline UX goals:

- Consistent fluid typography via `clamp(...)`
- Stable spacing scale and component rhythm
- Explicit design tokens for colors, borders, and status states
- Responsive layouts optimized for both touch and desktop
- Clear module-based information architecture

## Verification Commands

From repo root:

```bash
pnpm typecheck
pnpm build
pnpm test
```

The repo also includes a deeper local browser loop at `.codex/qa/run_e2e_rounds.py`. It supports `NORTHLINE_WEB_URL`, `NORTHLINE_MOBILE_URL`, and `NORTHLINE_TABLET_URL` so QA can run on alternate ports when defaults are occupied.

## Notes

- If you need historical behavior from the old mobile apps, use `legacy-apps/*` only as implementation reference.
- New phone-first field work should be implemented in `apps/mobile-ops`.
- Vessel-mounted tablet work should be implemented in `apps/tablet-ops`.
