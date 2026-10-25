# October 2026 dependency refresh

The previous lockfile reported 67 advisories (27 high, 31 moderate, 9 low). Compatible dependency updates and two scoped transitive overrides produce zero reported vulnerabilities in the refreshed lockfile on 25 October 2026. The existing moderate audit gate remains unchanged.

Zod requires a major-version migration because the patched constrained-collection validation starts at 4.6.6; this update uses 4.6.7. Record schemas now explicitly supply `z.string()` as the key schema. Regression coverage checks arbitrary record keys, nested metadata, defaults, numeric value rejection, and rejection of oversized arrays before their elements are accessed. The established API and sync tests remain part of the release checks.

- Zod advisory: https://github.com/advisories/GHSA-mrhx-c7xc-m3w5
- Zod migration guide: https://zod.dev/v4/changelog
- Upstream early-size-check fix: https://github.com/colinhacks/zod/commit/a0ebf970f2d752e5f58527cd2942ff48be4f46bd

Firebase Firestore still pins an affected grpc-js version, and Miniflare still pins an affected Undici version. `pnpm-workspace.yaml` overrides only these parent-child paths to patched releases (grpc-js 1.13.6 and Undici 7.30.1). Remove the overrides when upstream releases resolve patched versions themselves, then rerun audit and regressions.

- grpc-js advisory: https://github.com/advisories/GHSA-m9gg-hp2v-232j
- Undici advisory: https://github.com/advisories/GHSA-xjj6-f33q-929c

Audit results are a point-in-time dependency check, not a claim that the application has no security defects.
