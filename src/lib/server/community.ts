// Shared helpers for the comments and polls API.
import { env } from 'cloudflare:workers';
import type { APIContext } from 'astro';
import { getAuth, isAdmin } from './auth';

export const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

export const fail = (message: string, status = 400) => json({ error: message }, status);

export type Viewer = {
  user: { id: string; name: string; image?: string | null; email?: string | null; phoneNumber?: string | null } | null;
  admin: boolean;
  voter: string;
  ipHash: string;
};

const DEVICE_COOKIE = 'sa_vid';

/** Who is making this request: signed-in user and/or anonymous device id, plus a salted IP hash. */
export async function viewer(context: APIContext): Promise<Viewer> {
  const session = await getAuth().api.getSession({ headers: context.request.headers });
  const user = session?.user ?? null;

  let device = context.cookies.get(DEVICE_COOKIE)?.value;
  if (!device || !/^[a-f0-9-]{36}$/.test(device)) {
    device = crypto.randomUUID();
    context.cookies.set(DEVICE_COOKIE, device, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: context.url.protocol === 'https:',
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  const ip = context.request.headers.get('cf-connecting-ip') ?? context.clientAddress ?? 'unknown';
  return {
    user,
    admin: isAdmin(user as { email?: string; phoneNumber?: string } | null),
    voter: user ? `u:${user.id}` : `a:${device}`,
    ipHash: await sha256(`${env.IP_HASH_SALT ?? 'dev-salt'}:${ip}`),
  };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/** Reject cross-site writes. Browsers always send Origin on POST/PATCH/DELETE fetches. */
export function sameOrigin(context: APIContext): boolean {
  const origin = context.request.headers.get('origin');
  return !origin || origin === context.url.origin;
}

export async function verifyTurnstile(token: unknown, request: Request): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) return import.meta.env.DEV; // never skip in production
  if (typeof token !== 'string' || !token) return false;
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) body.append('remoteip', ip);
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  const result = (await response.json()) as { success: boolean };
  return result.success;
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export const db = () => env.DB as D1Database;
