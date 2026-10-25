# Public search content

`generate.mjs` owns the homepage product overview, four workflow guides and an editable CSV closeout worksheet, shared guide CSS, sitemap, and robots file. Run `pnpm verify:seo` after changes and commit the generated files. The web build also regenerates them before typechecking and bundling.

Vite inserts the overview into the initial homepage response. The React landing reuses that same HTML after mounting, following the cinematic introduction. Guide pages are independent static documents; the service worker excludes `/guides/` from the app-shell fallback so each guide keeps its content and canonical URL.

Validation: `node seo/verify.mjs` checks generated source; `node seo/verify.mjs --dist` checks production output including the homepage. Validate actual hosting responses after deployment and submit `/sitemap.xml` in the site's search console.

Product content is grounded in `README.md`, `docs/SYNC_SPEC.md`, `docs/CERTIFICATE_SPEC.md`, and `docs/UI_SCREEN_MAP.md`. The pages describe workflows rather than asserting customer counts, regulatory certification, pricing, or geographical service coverage. English content is available at stable global URLs; add language alternates only when genuine localized pages exist.

Search guidance used:
- https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
- https://developers.google.com/search/docs/appearance/ai-features

These recommend useful visible content, internal links, crawlability, and structured data consistent with the page. No special AI file or markup is required.

## Discovery evidence (25 October 2026)

Searches for commercial fishing fleet management, offline catch traceability, and fishing safety management surfaced product pages addressing vessel-to-office data gaps, landing reconciliation, and offline collection. This is evidence of language and workflows in the market, not keyword volume or customer interviews.

- https://deckhandlogbook.com/ — field-to-office logbook and processor handoff positioning.
- https://www.emydex.com/za/industries/fish-seafood-processing-software/ — offline haul capture, landing and intake workflows.
- https://www.catchlog.com/products/fisherymanager — company fleet versus authority use cases.
- https://www.fishsafebc.com/downloadable-tools — operational value of practical safety checklists.
- https://www.dfo-mpo.gc.ca/fisheries-peches/sdc-cps/nir-nei/elog-index-jbe-eng.html — qualified electronic reporting is a distinct buying requirement; do not imply Northline qualification.
- https://inspection.canada.ca/en/food-safety-industry/toolkit-food-businesses/traceability — source/destination traceability extends beyond trip provenance.

Implemented a trip closeout evaluation guide and downloadable worksheet, linked from the homepage and existing guides. Target users are fleet coordinators and processor reviewers reconciling one landing. The worksheet names owners, checks, evidence, and follow-up fields. It does not claim regulatory certification, integrations, customer outcomes, or search rankings. Existing sign-in is the available product action; no invented sales email or demo form.

Measure discovery separately from success: monitor impressions and qualified landing visits for the new guide, worksheet downloads if analytics is configured, and whether users reach the portal. Confirm intent in customer conversations before expanding into broader ERP, settlement, or ELOG terms.

The worksheet is included in the service worker precache. Both `/guides/` and `/resources/` bypass the navigation fallback so installed clients receive the document or file rather than the portal shell. `node seo/verify.mjs --dist` checks the built precache entry.
