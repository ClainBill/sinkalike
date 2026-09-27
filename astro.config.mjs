// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  // The public address. Canonical links, the sitemap and share images use it.
  site: 'https://sink-alike.wcgill.com',
  // Pages are prerendered to static HTML; only /api/* and the account pages run on the Worker.
  output: 'static',
  adapter: cloudflare({
    // Posters are optimised once at build time instead of per request.
    imageService: 'compile',
  }),
  integrations: [
    preact(),
    sitemap({ filter: (page) => !/\/(account|admin|login)\//.test(page) }),
  ],
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  // Auth has its own sessions in D1; Astro sessions (a KV namespace) aren't needed.
  session: false,
  vite: {
    // Pre-bundle the browser deps up front. If Vite discovers one mid-request it reloads,
    // which can leave the dev server rendering blank pages until restarted.
    optimizeDeps: {
      include: ['preact', 'preact/hooks', 'preact/devtools', 'preact/jsx-runtime', '@preact/signals', 'minisearch'],
    },
  },
});
