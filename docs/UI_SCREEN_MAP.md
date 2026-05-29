# UI Screen Map

## Mobile Ops (`/apps/mobile-ops`)

1. Safety
2. Operations
3. Hazards
4. Training

Mode switching:
- Offshore mode: haul safety checks and gear transitions
- Ice mode: check-in flow, return plan, and heater reminders

## Web Portal (`/apps/web-portal`)

1. Fleet dashboard
2. Trip state inspector
3. Risk and incident monitor
4. Trace and certificate verification
5. Integrations and devices
6. Rulesets and sync health
7. Visualization surface

## UX State Model

Each active app should expose:

- `Synced`
- `Syncing`
- `PendingLocalChanges`
- `Error`

## Responsive Principles

- Mobile Ops: touch-first, single-column first, scales up to tablet
- Web Portal: dashboard density with readable typography and stable panel scaling
