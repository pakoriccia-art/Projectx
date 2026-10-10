import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// base: './' è OBBLIGATORIO per Capacitor WebView Android
// (i path assoluti non funzionano nel file system locale del device)
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'favicon.svg'],
      manifest: {
        id: '/',
        name: 'PizzaMatrix',
        short_name: 'PizzaMatrix',
        description: 'Gestione predittiva degli impasti della pizza',
        lang: 'it',
        dir: 'ltr',
        categories: ['food', 'utilities', 'productivity'],
        theme_color: '#0a0806',
        background_color: '#0a0806',
        display: 'standalone',
        orientation: 'portrait',
        // issue #28: i file DEVONO esistere in public/icons/, altrimenti Chrome
        // non mostra il prompt di installazione. Rigenerabili con
        // `node scripts/generate-icons.mjs`.
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // Variante dedicata: Android ritaglia fino a un cerchio dell'80%, quindi
          // il soggetto è più piccolo. Usare lo stesso file per 'any' e 'maskable'
          // (come prima) produce un'icona ritagliata sui bordi.
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Cache-first per engine e assets statici
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts-cache', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } }
          }
        ]
      }
    })
  ],
  resolve: {
    alias: { '@': '/src' }
  },
  build: {
    target: 'es2020',
    sourcemap: true,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // issue #32 — manualChunks ridotto a dexie soltanto.
        //
        // 'vendor-react' pesava 0.09 kB: non catturava nulla. Con il JSX transform
        // automatico React entra via 'react/jsx-runtime' e finiva comunque in
        // index-*.js. Un chunk vuoto e' solo rumore.
        //
        // 'vendor-recharts' era peggio che inutile: era ATTIVAMENTE DANNOSO.
        // Assegnare recharts a un chunk esplicito lo promuove nel grafo iniziale,
        // e Vite emette <link rel="modulepreload"> per quel chunk in index.html.
        // Risultato: 149 kB gzip scaricati alla home anche dopo aver reso lazy le
        // viste che lo usano — il lazy import veniva annullato dal preload.
        // Senza la forzatura, Rollup lo colloca da se' nel grafo dinamico di
        // DashboardV4/BakeView e arriva solo quando serve davvero.
        //
        // dexie resta esplicito: e' importato staticamente da db.ts -> AppContext,
        // quindi e' comunque nel primo caricamento, e separarlo aiuta la cache
        // fra deploy (cambia molto meno del codice applicativo).
        manualChunks: {
          'vendor-dexie': ['dexie'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // engine/engine-v2.4.0.test.js usa runner custom (node); escludi da Vitest
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['src/__tests__/setup.ts'],
  }
});
