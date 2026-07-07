import { defineConfig, loadEnv } from 'vite';
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react(),
      VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Northline Tablet Ops',
        short_name: 'TabletOps',
        description: 'Vessel-mounted tablet operations for offshore fishing',
        theme_color: '#08111f',
        background_color: '#08111f',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ],
        categories: ['business', 'productivity'],
        shortcuts: [
          {
            name: 'Trip Board',
            short_name: 'Trips',
            description: 'Open the active vessel trip board',
            url: '/?view=trips'
          },
          {
            name: 'Compliance',
            short_name: 'Compliance',
            description: 'Open vessel compliance workflows',
            url: '/?view=compliance'
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
      sourcemap: env.VITE_ENABLE_SOURCEMAPS === 'true',
      rollupOptions: {
        output: {
          manualChunks
        }
      }
    }
  };
});
