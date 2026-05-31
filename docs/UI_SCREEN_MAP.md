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
2. Role command center
3. Trip state inspector
4. Risk and incident monitor
5. Guided trace/compliance closeout
6. Trace and certificate verification
7. Integrations, trusted devices, and rulesets
8. Audit console and sync health
9. Visualization surface

## Tablet Ops (`/apps/tablet-ops`)

1. Vessel status and emergency command
2. Bridge decision-support playbook
3. Watch handoff checklist
4. Gear status and transition board
5. Connected devices
6. Bridge log and activity timeline

## UX State Model

Each active app should expose:

- `Synced`
- `Syncing`
- `PendingLocalChanges`
- `Error`

## Responsive Principles

- Mobile Ops: touch-first, single-column first, scales up to tablet
- Web Portal: dashboard density with readable typography and stable panel scaling
- Tablet Ops: bridge-safe action density, large emergency controls, and reviewable handoff state
