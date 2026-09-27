// Prints the SQL Better Auth needs, based on src/lib/server/auth-options.ts.
//   node scripts/auth-schema.ts > migrations/0001_auth.sql
import { DatabaseSync } from 'node:sqlite';
import { getMigrations } from 'better-auth/db/migration';
import { authOptions } from '../src/lib/server/auth-options.ts';

const noop = async () => {};
const options = authOptions(
  { BETTER_AUTH_SECRET: 'schema-only-secret-schema-only-secret', TURNSTILE_SECRET_KEY: 'x' },
  new DatabaseSync(':memory:'),
  { email: noop, sms: noop },
);
const { compileMigrations } = await getMigrations(options);
console.log((await compileMigrations()).trim());
