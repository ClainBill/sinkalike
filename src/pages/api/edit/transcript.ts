import type { APIRoute } from 'astro';
import { applyLineChanges, stringifyTranscript, toVtt, type LineChange, type TranscriptDoc } from '../../../lib/edit/content';
import { fail, json, readJson } from '../../../lib/server/community';
import { handle, host, paths, saved } from '../../../lib/server/edit-api';
import { commitEdit, EditError, readFile } from '../../../lib/server/github';
import { personNames, speakerChoices, threadExists } from '../../../lib/server/registry';

export const prerender = false;

const episodeParam = (value: unknown) => {
  const slug = String(value ?? '');
  if (!threadExists(`episode:${slug}`)) throw new EditError('Unknown episode', 404);
  return slug;
};

/** Hosts only: the latest transcript (including edits not deployed yet) and its mentions. */
export const GET: APIRoute = (context) =>
  handle(async () => {
    const author = await host(context);
    if (author instanceof Response) return author;
    const episode = episodeParam(context.url.searchParams.get('episode'));
    const [transcript, mentions] = await Promise.all([readFile(paths.transcript(episode)), readFile(paths.mentions)]);
    if (!transcript) return fail('This episode has no transcript yet.', 404);
    const lines = Object.entries(JSON.parse(mentions ?? '{}') as Record<string, { episode: string; s: number }[]>).flatMap(([id, list]) =>
      list.filter((m) => m.episode === episode).map((m) => ({ tmdbId: Number(id), s: m.s })),
    );
    return json({ segments: (JSON.parse(transcript) as TranscriptDoc).segments, mentions: lines, speakers: speakerChoices(episode) });
  });

/** Hosts only: { episode, changes: [{ s, t?, sp?, delete? }] }. Commits the transcript and its captions. */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const author = await host(context);
    if (author instanceof Response) return author;
    const input = await readJson<{ episode?: string; changes?: LineChange[] }>(context.request);
    const episode = episodeParam(input?.episode);
    const changes = (Array.isArray(input?.changes) ? input.changes : [])
      .filter((c) => Number.isFinite(c?.s))
      .map((c) => ({
        s: Number(c.s),
        ...(typeof c.t === 'string' && { t: c.t.slice(0, 2000) }),
        ...(c.sp !== undefined && { sp: c.sp === null ? null : String(c.sp) }),
        ...(c.delete === true && { delete: true }),
      }));
    if (!changes.length) return fail('Nothing to save.');
    if (changes.length > 3000) return fail('Too many changes at once.');

    let changed = 0;
    const { sha } = await commitEdit(author, async (repo) => {
      const text = await repo.read(paths.transcript(episode));
      if (!text) throw new EditError('This episode has no transcript yet.', 404);
      const doc = JSON.parse(text) as TranscriptDoc;
      const allowed = new Set([...speakerChoices(episode).map((s) => s.id), ...doc.segments.map((s) => s.sp).filter((sp): sp is string => !!sp)]);
      const result = applyLineChanges(doc, changes, allowed);
      changed = result.changed;
      if (!changed) return null;
      const names = Object.fromEntries(speakerChoices(episode).map((s) => [s.id, s.name]));
      return {
        message: `Edit transcript: ${episode} (${changed} line${changed === 1 ? '' : 's'})`,
        files: [
          { path: paths.transcript(episode), content: stringifyTranscript(result.doc) },
          { path: paths.vtt(episode), content: toVtt(result.doc.segments, { ...personNames, ...names }) },
        ],
      };
    });
    return saved(sha, { changed });
  });
