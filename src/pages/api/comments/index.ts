import type { APIRoute } from 'astro';
import { isAdmin } from '../../../lib/server/auth';
import { db, fail, json, readJson, sameOrigin, verifyTurnstile, viewer } from '../../../lib/server/community';
import { threadExists } from '../../../lib/server/registry';
import { record, refererPath } from '../../../lib/server/analytics';

export const prerender = false;

const MAX_BODY = 2000;
const MAX_NAME = 40;
const LINKISH = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|ru|xyz|info|biz)\b)/i;

type Row = {
  id: string;
  parentId: string | null;
  userId: string | null;
  anonName: string | null;
  voter: string;
  body: string;
  status: 'visible' | 'pending' | 'hidden';
  createdAt: number;
  editedAt: number | null;
  userName: string | null;
  userImage: string | null;
  userEmail: string | null;
  userPhone: string | null;
  likes: number;
  liked: number;
};

export const GET: APIRoute = async (context) => {
  const thread = context.url.searchParams.get('thread') ?? '';
  if (!threadExists(thread)) return fail('Unknown thread', 404);
  const me = await viewer(context);

  const { results } = await db()
    .prepare(
      `select c.id, c.parentId, c.userId, c.anonName, c.voter, c.body, c.status, c.createdAt, c.editedAt,
              u.name as userName, u.image as userImage, u.email as userEmail, u.phoneNumber as userPhone,
              (select count(*) from commentLike l where l.commentId = c.id) as likes,
              exists(select 1 from commentLike l where l.commentId = c.id and l.voter = ?2) as liked
         from comment c left join user u on u.id = c.userId
        where c.thread = ?1 and (c.status = 'visible' or c.voter = ?2 or ?3)
        order by c.createdAt asc
        limit 1000`,
    )
    .bind(thread, me.voter, me.admin ? 1 : 0)
    .all<Row>();

  const comments = results.map((row) => ({
    id: row.id,
    parentId: row.parentId,
    body: row.body,
    status: row.status,
    createdAt: row.createdAt,
    edited: !!row.editedAt,
    likes: row.likes,
    liked: !!row.liked,
    mine: row.voter === me.voter,
    author: row.userId
      ? {
          name: row.userName || 'Listener',
          image: row.userImage,
          host: isAdmin({ email: row.userEmail, phoneNumber: row.userPhone }),
          anonymous: false,
        }
      : { name: row.anonName || 'Anonymous', image: null, host: false, anonymous: true },
  }));

  return json({ comments, canModerate: me.admin });
};

export const POST: APIRoute = async (context) => {
  if (!sameOrigin(context)) return fail('Bad origin', 403);
  const input = await readJson<{ thread?: string; parentId?: string | null; body?: string; name?: string; token?: string }>(
    context.request,
  );
  if (!input) return fail('Invalid request');

  const thread = String(input.thread ?? '');
  const body = String(input.body ?? '').trim().replace(/\n{3,}/g, '\n\n');
  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
  if (!threadExists(thread)) return fail('Unknown thread', 404);
  if (!body) return fail('Write something first.');
  if (body.length > MAX_BODY) return fail(`Comments can be up to ${MAX_BODY} characters.`);

  const me = await viewer(context);
  if (!me.user && !(await verifyTurnstile(input.token, context.request))) {
    return fail('Please complete the spam check and try again.', 403);
  }

  // Rate limits: 5 per 10 minutes, and 30 per day for anonymous posters. Accounts are limited
  // per account; anonymous posters per network too, since clearing cookies is free.
  const now = Date.now();
  const recent = await db()
    .prepare(
      `select
         sum(case when createdAt > ?2 then 1 else 0 end) as tenMinutes,
         count(*) as day
       from comment where (voter = ?4 or (?5 and userId is null and ipHash = ?1)) and createdAt > ?3`,
    )
    .bind(me.ipHash, now - 10 * 60_000, now - 86_400_000, me.voter, me.user ? 0 : 1)
    .first<{ tenMinutes: number | null; day: number }>();
  if ((recent?.tenMinutes ?? 0) >= 5 || (!me.user && (recent?.day ?? 0) >= 30)) {
    return fail('You’re commenting a lot. Take a breather and try again in a few minutes.', 429);
  }

  // One level of replies: replying to a reply attaches to its parent.
  let parentId: string | null = null;
  if (input.parentId) {
    const parent = await db()
      .prepare(`select id, parentId from comment where id = ? and thread = ?`)
      .bind(input.parentId, thread)
      .first<{ id: string; parentId: string | null }>();
    if (!parent) return fail('The comment you replied to was removed.', 404);
    parentId = parent.parentId ?? parent.id;
  }

  const status = !me.user && LINKISH.test(body) ? 'pending' : 'visible';
  const id = crypto.randomUUID();
  await db()
    .prepare(
      `insert into comment (id, thread, parentId, userId, anonName, voter, body, status, ipHash, createdAt)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, thread, parentId, me.user?.id ?? null, me.user ? null : name || null, me.voter, body, status, me.ipHash, now)
    .run();

  record('comment', { path: refererPath(context.request), label: thread }, context.request);
  return json({ id, status }, 201);
};
