# Public search content

`generate.mjs` owns the homepage product overview, three workflow guides, shared guide CSS, sitemap, and robots file. Run `pnpm verify:seo` after changes and commit the generated files. The web build also regenerates them before typechecking and bundling.

Vite inserts the overview into the initial homepage response. The React landing reuses that same HTML after mounting, following the cinematic introduction. Guide pages are independent static documents; the service worker excludes `/guides/` from the app-shell fallback so each guide keeps its content and canonical URL.

Validation: `node seo/verify.mjs` checks generated source; `node seo/verify.mjs --dist` checks production output including the homepage. Validate actual hosting responses after deployment and submit `/sitemap.xml` in the site's search console.

Product content is grounded in `README.md`, `docs/SYNC_SPEC.md`, `docs/CERTIFICATE_SPEC.md`, and `docs/UI_SCREEN_MAP.md`. The pages describe workflows rather than asserting customer counts, regulatory certification, pricing, or geographical service coverage. English content is available at stable global URLs; add language alternates only when genuine localized pages exist.

Search guidance used:
- https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
- https://developers.google.com/search/docs/appearance/ai-features

These recommend useful visible content, internal links, crawlability, and structured data consistent with the page. No special AI file or markup is required.
