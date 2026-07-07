import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

function manualChunks(id: string) {
  const normalized = id.replace(/\\/g, "/");
  if (id.includes("@northline/ui")) return "ui";
  if (id.includes("@northline/shared")) return "shared";
  if (id.includes("/src/components/charts") || id.includes("/src/components/RealTimeFleetAI")) return "visualizations";
  if (id.includes("/src/lib/")) return "api-client";
  if (normalized.includes("/node_modules/")) {
    const pnpmPackage = normalized.match(/node_modules\/\.pnpm\/((?:@[^/+]+\+)?[^/@]+)@/);
    const nodePackage = normalized.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
    const packageName = (pnpmPackage?.[1] ?? nodePackage?.[1] ?? "misc").replace(/[@/+]/g, "-");
    return `vendor-${packageName}`;
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
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
        name: "Northline Command Portal",
        short_name: "Northline",
        description: "Fleet operations, safety, and compliance management for commercial fishing",
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
          { name: "Dashboard", short_name: "Dashboard", description: "View fleet dashboard", url: "/" },
          { name: "Trips", short_name: "Trips", description: "Manage trips", url: "/trips" }
        ]
      }
      })
    ],
    server: {
      port: 5173,
      host: "127.0.0.1",
      strictPort: true
    },
    build: {
      sourcemap: env.VITE_ENABLE_SOURCEMAPS === "true",
      rollupOptions: {
        output: {
          manualChunks
        }
      }
    }
  };
});
