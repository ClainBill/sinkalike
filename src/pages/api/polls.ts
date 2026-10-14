import type { APIRoute } from 'astro';
import { db, fail, json, readJson, sameOrigin, verifyTurnstile, viewer } from '../../lib/server/community';
import { pollOptionCount } from '../../lib/server/registry';
import { record, refererPath } from '../../lib/server/analytics';

export const prerender = false;

const MAX_VOTES_PER_IP = 6; // households share an IP; this just stops cookie-clearing ballot stuffing

async function results(poll: string, voter: string) {
  const [{ results: rows }, mine] = await Promise.all([
    db().prepare(`select option, count(*) as n from pollVote where poll = ? group by option`).bind(poll).all<{ option: number; n: number }>(),
    db().prepare(`select option from pollVote where poll = ? and voter = ?`).bind(poll, voter).first<{ option: number }>(),
  ]);
  const counts = Array.from({ length: pollOptionCount(poll) }, (_, i) => rows.find((row) => row.option === i)?.n ?? 0);
  return { counts, total: counts.reduce((a, b) => a + b, 0), mine: mine?.option ?? null };
}

export const GET: APIRoute = async (context) => {
  const poll = context.url.searchParams.get('key') ?? '';
  if (!pollOptionCount(poll)) return fail('Unknown poll', 404);
  const me = await viewer(context);
  return json(await results(poll, me.voter));
};

export const POST: APIRoute = async (context) => {
  if (!sameOrigin(context)) return fail('Bad origin', 403);
  const input = await readJson<{ key?: string; option?: number; token?: string }>(context.request);
  const poll = String(input?.key ?? '');
  const option = Number(input?.option);
  const options = pollOptionCount(poll);
  if (!options) return fail('Unknown poll', 404);
  if (!Number.isInteger(option) || option < 0 || option >= options) return fail('Unknown option');

  const me = await viewer(context);
  const existing = await db().prepare(`select 1 from pollVote where poll = ? and voter = ?`).bind(poll, me.voter).first();
  if (!me.user && !existing) {
    if (!(await verifyTurnstile(input?.token, context.request))) return fail('Please complete the spam check and try again.', 403);
    const fromIp = await db()
      .prepare(`select count(*) as n from pollVote where poll = ? and ipHash = ?`)
      .bind(poll, me.ipHash)
      .first<{ n: number }>();
    if ((fromIp?.n ?? 0) >= MAX_VOTES_PER_IP) return fail('Too many votes from your network on this poll.', 429);
  }

  // Voting again changes your answer.
  await db()
    .prepare(
      `insert into pollVote (poll, voter, option, ipHash, createdAt) values (?, ?, ?, ?, ?)
       on conflict (poll, voter) do update set option = excluded.option, createdAt = excluded.createdAt`,
    )
    .bind(poll, me.voter, option, me.ipHash, Date.now())
    .run();
  if (!existing) record('vote', { path: refererPath(context.request), label: poll }, context.request);

  return json(await results(poll, me.voter));
};
