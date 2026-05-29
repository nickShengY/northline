import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

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
        name: "Northline Command Portal",
        short_name: "Northline",
        description: "Fleet operations, safety, and compliance management for commercial fishing",
        theme_color: "#00d4ff",
        background_color: "#050811",
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
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
          ui: ["@northline/shared"]
        }
      }
    }
  }
});
