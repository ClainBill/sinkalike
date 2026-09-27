import type { APIRoute } from 'astro';
import { db, fail, json, readJson, sameOrigin, viewer } from '../../../lib/server/community';
import { threadExists } from '../../../lib/server/registry';

export const prerender = false;

/** Slugs of movies hosts have removed from the list. Public, briefly cached. */
export const GET: APIRoute = async () => {
  const { results } = await db().prepare(`select slug from hiddenMovie`).all<{ slug: string }>();
  return json({ hidden: results.map((row) => row.slug) }, 200, { 'Cache-Control': 'public, max-age=15' });
};

/** Hosts only: { slug, hidden: true | false } */
export const POST: APIRoute = async (context) => {
  if (!sameOrigin(context)) return fail('Bad origin', 403);
  const me = await viewer(context);
  if (!me.admin) return fail('Only hosts can change the movie list.', 403);
  const input = await readJson<{ slug?: string; hidden?: boolean }>(context.request);
  const slug = String(input?.slug ?? '');
  if (!threadExists(`movie:${slug}`)) return fail('Unknown movie', 404);

  if (input?.hidden) {
    await db()
      .prepare(`insert into hiddenMovie (slug, hiddenBy, createdAt) values (?, ?, ?) on conflict (slug) do nothing`)
      .bind(slug, me.user?.id ?? null, Date.now())
      .run();
  } else {
    await db().prepare(`delete from hiddenMovie where slug = ?`).bind(slug).run();
  }
  return json({ ok: true });
};
