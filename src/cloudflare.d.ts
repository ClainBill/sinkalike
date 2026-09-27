// Types for server code that runs on Cloudflare Workers. Full runtime types aren't loaded
// globally because they clash with the browser DOM types the islands use.
// Env itself is generated into worker-configuration.d.ts by `npm run cf-types`.

type D1Database = import('@cloudflare/workers-types').D1Database;

declare module 'cloudflare:workers' {
  export const env: Env;
}
