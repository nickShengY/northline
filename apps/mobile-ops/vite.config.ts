import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

function manualChunks(id: string) {
  const normalized = id.replace(/\\/g, "/");
  if (normalized.includes("@northline/ui")) return "ui";
  if (normalized.includes("@northline/shared")) return "shared";
  if (normalized.includes("/src/lib/")) return "api-client";
  if (normalized.includes("/src/FieldOpsApp")) return "field-ops";
  if (normalized.includes("/node_modules/")) {
    const pnpmPackage = normalized.match(/node_modules\/\.pnpm\/((?:@[^/+]+\+)?[^/@]+)@/);
    const nodePackage = normalized.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
    const packageName = (pnpmPackage?.[1] ?? nodePackage?.[1] ?? "misc").replace(/[@/+]/g, "-");
    return `vendor-${packageName}`;
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Cache API calls for the configured backend origin; fall back to matching
  // any /v1/ API path so the runtime cache works across deploy environments.
  const apiBase = env.VITE_API_BASE_URL;
  let apiOrigin: string | null = null;
  try {
    apiOrigin = apiBase ? new URL(apiBase).origin : null;
  } catch {
    apiOrigin = null;
  }
  const apiUrlPattern = apiOrigin
    ? new RegExp(`^${apiOrigin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/v1/.*`, "i")
    : /^https?:\/\/[^/]+\/v1\/.*/i;

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
          runtimeCaching: [
            {
              urlPattern: apiUrlPattern,
              handler: "NetworkFirst",
              options: {
                cacheName: "api-cache",
                expiration: { maxEntries: 100, maxAgeSeconds: 86400 },
                cacheableResponse: { statuses: [0, 200] }
              }
            }
          ]
        },
        manifest: {
          name: "Northline Field Ops",
          short_name: "Field Ops",
          description: "Unified offshore and ice operations app with offline-first safety workflows.",
          theme_color: "#38bdf8",
          background_color: "#08111f",
          display: "standalone",
          orientation: "any",
          scope: "/",
          start_url: "/",
          icons: [
            { src: "/icons/icon.svg", sizes: "192x192", type: "image/svg+xml" },
            { src: "/icons/icon.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any maskable" }
          ],
          categories: ["business", "productivity"],
          shortcuts: [
            { name: "Safety", short_name: "Safety", description: "Open safety module", url: "/?module=safety" },
            { name: "Operations", short_name: "Ops", description: "Open operations module", url: "/?module=operations" }
          ]
        }
      })
    ],
    server: {
      port: 5174,
      host: "127.0.0.1",
      strictPort: true
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks
        }
      }
    }
  };
});
