import type { APIRoute } from 'astro';
import { db, fail, json, sameOrigin, viewer } from '../../../../lib/server/community';

export const prerender = false;

/** Toggle a like. */
export const POST: APIRoute = async (context) => {
  if (!sameOrigin(context)) return fail('Bad origin', 403);
  const me = await viewer(context);
  const id = context.params.id!;
  const exists = await db().prepare(`select 1 from comment where id = ? and status = 'visible'`).bind(id).first();
  if (!exists) return fail('Not found', 404);

  const removed = await db().prepare(`delete from commentLike where commentId = ? and voter = ?`).bind(id, me.voter).run();
  if (!removed.meta.changes) {
    await db().prepare(`insert into commentLike (commentId, voter, createdAt) values (?, ?, ?)`).bind(id, me.voter, Date.now()).run();
  }
  const count = await db().prepare(`select count(*) as n from commentLike where commentId = ?`).bind(id).first<{ n: number }>();
  return json({ liked: !removed.meta.changes, likes: count?.n ?? 0 });
};
