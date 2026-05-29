# Northline Device Strategy

## Executive Summary

Northline should stay on a Progressive Web App strategy. The active product is already split into the right surfaces: shore-side portal, phone-first field app, and vessel-mounted tablet app. The launch-critical work is production auth, deployment configuration, branded install polish, and repeated offline recovery validation, not native-app development.

## Device Targeting Strategy

### Tier 1: Primary Target

**iOS/Android smartphones and tablets**

- iPhone 12+ / iPad 2019+
- Android 10+ phones/tablets
- Screen sizes: 5 to 13 inches
- PWA installable to home screen

Why:
- Crews already own these devices
- Offline-first architecture supports poor or missing connectivity
- One codebase serves phone and tablet workflows

### Tier 2: Harsh Environment

**Rugged Android tablets for deck-weatherized use**

- Samsung Galaxy Tab Active series
- Zebra/Xplore rugged tablets
- Panasonic Toughpad legacy deployments

Why:
- Dedicated deck operations in extreme conditions
- Waterproof and drop-resistant hardware options
- Larger screen for complex vessel workflows

### Tier 3: Office/Onshore

**Windows/Mac desktop plus tablets**

- Modern browser support: Chrome, Edge, Safari, Firefox
- Touch plus keyboard/mouse support

Why:
- Fleet managers and compliance officers need large dashboards
- No app-store installation is required

## Technical Implementation

```text
Single React/Vite workspace
  - apps/web-portal for shore-side operations
  - apps/mobile-ops for phone-first field workflows
  - apps/tablet-ops for bridge/deck vessel workflows
  - PWA manifests and generated service workers for active apps
  - Offline queues and event sync for weak connectivity
```

## Current Status

| Area | Status | Notes |
| --- | --- | --- |
| Responsive UI | Ready for current QA scope | Browser evidence covers desktop, phone, and tablet viewports. |
| PWA plumbing | Ready for active apps | Vite PWA build output exists for web, mobile, and tablet apps. |
| Offline-first data model | Partially ready | Event sync and local queues exist; more interrupted-network drills are still needed. |
| Production auth | Launch blocker until integrated | Deployed builds must use runtime JWT/session tokens, not static `VITE_*` bearer tokens. |
| Production API CORS | Requires deploy config | Set `CORS_ORIGIN` per deployed environment. |
| Native device features | Future work | Camera, GPS, vibration, wake lock, and push notifications can be added through PWA APIs. |

## Recommended Device Matrix

| Use Case | Recommended Device | Form Factor | Why |
| --- | --- | --- | --- |
| Ice missions | iPhone 13+ or Samsung S21+ | Phone | Pocketable, good camera for scanning |
| Deck operations | Samsung Tab Active3 or iPad mini | 8 inch tablet | One-handable and case-friendly |
| Catch logging | Rugged 10 inch tablet | Tablet | Better data-entry ergonomics |
| Compliance station | iPad Pro or Surface Pro | 12-13 inch tablet | Desktop-class review surface |
| Office management | Laptop/desktop | Desktop | Best for portal dashboards and reports |

## Immediate Strategy

1. Add a real sign-in/token acquisition shell that writes a runtime token under `northline.apiToken`.
2. Configure `CORS_ORIGIN` for staging and production API deployments.
3. Validate install polish across all three active PWAs: icons, splash screens, standalone display mode, and service-worker update behavior.
4. Run offline recovery drills: API unavailable, partial sync failure, browser reload with queued work, and service-worker refresh.
5. Keep native wrappers out of scope unless distribution, device management, or push-notification requirements force them.

## Conclusion

Stick with PWA as the product strategy. It matches the operating environment and keeps the codebase focused. The serious remaining launch risks are security, auth, deployment configuration, and recovery validation, not the device strategy itself.
