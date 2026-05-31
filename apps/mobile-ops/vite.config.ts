import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

function manualChunks(id: string) {
  const normalized = id.replace(/\\/g, "/");
  if (id.includes("@northline/ui")) return "ui";
  if (id.includes("@northline/shared")) return "shared";
  if (id.includes("/src/lib/")) return "api-client";
  if (id.includes("/src/FieldOpsApp")) return "field-ops";
  if (normalized.includes("/node_modules/")) {
    const pnpmPackage = normalized.match(/node_modules\/\.pnpm\/((?:@[^/+]+\+)?[^/@]+)@/);
    const nodePackage = normalized.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
    const packageName = (pnpmPackage?.[1] ?? nodePackage?.[1] ?? "misc").replace(/[@/+]/g, "-");
    return `vendor-${packageName}`;
  }
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.northline\.fishery\/.*/i,
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
        theme_color: "#0ea5e9",
        background_color: "#041320",
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
          { name: "Gear", short_name: "Gear", description: "Open gear module", url: "/?module=gear" }
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
});
