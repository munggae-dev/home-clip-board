import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { version } from './package.json'
import { VitePWA } from 'vite-plugin-pwa'

const versionJson = JSON.stringify({ version }) + '\n'
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    {
      name: 'board-version',
      transformIndexHtml(html) {
        return html.replace('__APP_VERSION__', version)
      },
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: versionJson })
      },
      configureServer(server) {
        server.middlewares.use('/version.json', (_req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          res.end(versionJson)
        })
      },
    },
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'pwa-192.png', 'pwa-512.png', 'pwa-maskable-512.png'],
      devOptions: {
        enabled: true,
        type: 'module',
      },
      manifest: {
        id: '/',
        lang: 'ko',
        name: 'Home Clip Board',
        short_name: 'ClipBoard',
        description: 'Tailscale 기기 간 텍스트·이미지 공유',
        theme_color: '#4f46e5',
        background_color: '#0f172a',
        display: 'standalone',
        display_override: ['standalone', 'fullscreen'],
        orientation: 'any',
        scope: '/',
        start_url: `/?launcher_version=${encodeURIComponent(version)}`,
        share_target: {
          action: '/share',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title', text: 'text', url: 'url',
            files: [{ name: 'images', accept: ['image/*'] }],
          },
        },
        prefer_related_applications: false,
        categories: ['utilities', 'productivity'],
        icons: [
          {
            src: 'pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        importScripts: ['/share-target.js'],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/version\.json(?:\?|$)/],
      },
      integration: {
        beforeBuildServiceWorker({ workbox, manifestFilename }) {
          // Let Chrome revalidate the manifest when updating installed share targets.
          workbox.additionalManifestEntries = workbox.additionalManifestEntries?.filter(
            (entry) => (typeof entry === 'string' ? entry : entry.url) !== manifestFilename,
          )
        },
      },
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: true,
    cors: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: false,
      },
    },
  },
})
