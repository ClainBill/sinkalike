import type { APIRoute } from 'astro';
import { db, fail, json, readJson, sameOrigin, viewer } from '../../../../lib/server/community';

export const prerender = false;

async function load(id: string) {
  return db().prepare(`select id, voter from comment where id = ?`).bind(id).first<{ id: string; voter: string }>();
}

/** Authors can delete their own comments; hosts can delete any. */
export const DELETE: APIRoute = async (context) => {
  if (!sameOrigin(context)) return fail('Bad origin', 403);
  const me = await viewer(context);
  const comment = await load(context.params.id!);
  if (!comment) return fail('Not found', 404);
  if (comment.voter !== me.voter && !me.admin) return fail('Not allowed', 403);
  await db().prepare(`delete from comment where id = ?`).bind(comment.id).run();
  return json({ ok: true });
};

/** Authors edit their text; hosts change moderation status. */
export const PATCH: APIRoute = async (context) => {
  if (!sameOrigin(context)) return fail('Bad origin', 403);
  const me = await viewer(context);
  const comment = await load(context.params.id!);
  if (!comment) return fail('Not found', 404);
  const input = await readJson<{ status?: string; body?: string }>(context.request);
  if (!input) return fail('Invalid request');

  if (input.status !== undefined) {
    if (!me.admin) return fail('Not allowed', 403);
    if (!['visible', 'pending', 'hidden'].includes(input.status)) return fail('Bad status');
    await db().prepare(`update comment set status = ? where id = ?`).bind(input.status, comment.id).run();
  }

  if (input.body !== undefined) {
    if (comment.voter !== me.voter) return fail('Not allowed', 403);
    const body = String(input.body).trim();
    if (!body || body.length > 2000) return fail('Comments must be 1–2000 characters.');
    await db().prepare(`update comment set body = ?, editedAt = ? where id = ?`).bind(body, Date.now(), comment.id).run();
  }

  return json({ ok: true });
};
