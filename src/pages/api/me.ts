import type { APIRoute } from 'astro';
import { getAuth, isAdmin } from '../../lib/server/auth';
import { json } from '../../lib/server/community';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return json({ user: null });
  const { id, name, image } = session.user;
  return json({ user: { id, name, image, isAdmin: isAdmin(session.user as { email?: string; phoneNumber?: string }) } });
};
