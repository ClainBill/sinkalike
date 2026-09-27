import { env } from 'cloudflare:workers';
import { betterAuth } from 'better-auth';
import { authOptions } from './auth-options';
import { senders } from './senders';

let instance: ReturnType<typeof create> | undefined;

function create() {
  return betterAuth(authOptions(env, env.DB, senders));
}

export function getAuth() {
  return (instance ??= create());
}

export type Session = NonNullable<Awaited<ReturnType<ReturnType<typeof getAuth>['api']['getSession']>>>;

/** Hosts/moderators, by sign-in email or phone (comma-separated ADMINS var). */
export function isAdmin(user: { email?: string | null; phoneNumber?: string | null } | undefined | null): boolean {
  if (!user) return false;
  const admins = (env.ADMINS ?? '')
    .split(',')
    .map((value: string) => value.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes((user.email ?? '').toLowerCase()) || (!!user.phoneNumber && admins.includes(user.phoneNumber));
}
