import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
let commit = process.env.COMMIT_SHA ?? '';
try {
  commit ||= execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch {
  commit = 'dev';
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __COMMIT__: JSON.stringify(commit.slice(0, 7) || 'dev'),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'ping.txt'],
      manifest: {
        name: 'Offline',
        short_name: 'Offline',
        description: 'Capture spoken prompts privately, even with no signal, and run them with AI when you choose.',
        start_url: '/app',
        scope: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Record a thought', short_name: 'Record', url: '/app?do=record', icons: [{ src: '/icons/shortcut-record.png', sizes: '96x96', type: 'image/png' }] },
          { name: 'New note', short_name: 'Note', url: '/app?do=note', icons: [{ src: '/icons/shortcut-note.png', sizes: '96x96', type: 'image/png' }] },
        ],
      },
      workbox: {
        // Precache the whole app (code, fonts, artwork) so it opens with no network at all.
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2,webmanifest}'],
        // The social image is for link previews, not for using the app offline.
        globIgnores: ['og.png'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/__\//, /^\/ping\.txt/],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        // A new version takes over at once instead of waiting for every tab to close; open windows
        // are then handed over by public/sw-update.js (reload if idle, ask if busy).
        skipWaiting: true,
        clientsClaim: true,
        importScripts: ['/sw-update.js'],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
  server: { port: 5180, strictPort: true },
  preview: { port: 5181, strictPort: true },
});
