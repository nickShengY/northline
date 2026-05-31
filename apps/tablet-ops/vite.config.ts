import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

function manualChunks(id: string) {
  const normalized = id.replace(/\\/g, '/');
  if (id.includes('@northline/ui')) return 'ui';
  if (id.includes('@northline/shared')) return 'shared';
  if (id.includes('/src/lib/')) return 'api-client';
  if (id.includes('/src/VesselOpsApp')) return 'vessel-ops';
  if (normalized.includes('/node_modules/')) {
    const pnpmPackage = normalized.match(/node_modules\/\.pnpm\/((?:@[^/+]+\+)?[^/@]+)@/);
    const nodePackage = normalized.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
    const packageName = (pnpmPackage?.[1] ?? nodePackage?.[1] ?? 'misc').replace(/[@/+]/g, '-');
    return `vendor-${packageName}`;
  }
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt', 'apple-touch-icon.png'],
      manifest: {
        name: 'Northline Tablet Ops',
        short_name: 'TabletOps',
        description: 'Vessel-mounted tablet operations for offshore fishing',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
  server: {
    port: 5175,
    host: '127.0.0.1',
    strictPort: true
  },
  preview: {
    port: 4175
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
