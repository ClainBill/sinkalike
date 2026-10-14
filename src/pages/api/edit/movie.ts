import type { APIRoute } from 'astro';
import { addQuote, editMovie, readMovie, SLUG, type Quote, type Verdict } from '../../../lib/edit/content';
import { fail, json, readJson } from '../../../lib/server/community';
import { clock, handle, host, paths, saved } from '../../../lib/server/edit-api';
import { commitEdit, EditError, readFile } from '../../../lib/server/github';
import { personNames, threadExists } from '../../../lib/server/registry';

export const prerender = false;

const movieParam = (value: unknown) => {
  const slug = String(value ?? '');
  if (!SLUG.test(slug)) throw new EditError('Unknown movie', 404);
  return slug;
};

function cleanVerdicts(input: unknown): Record<string, Verdict> {
  const verdicts: Record<string, Verdict> = {};
  for (const [id, raw] of Object.entries((input ?? {}) as Record<string, { rating?: unknown; take?: unknown }>)) {
    if (!(id in personNames)) throw new EditError(`Unknown host "${id}".`);
    const rating = raw?.rating === '' || raw?.rating == null ? undefined : Number(raw.rating);
    if (rating !== undefined && !(rating >= 0 && rating <= 10)) throw new EditError('Ratings go from 0 to 10.');
    const take = typeof raw?.take === 'string' ? raw.take.replace(/\s+/g, ' ').trim().slice(0, 300) : undefined;
    verdicts[id] = { ...(rating !== undefined && { rating: Math.round(rating * 10) / 10 }), ...(take && { take }) };
  }
  return verdicts;
}

function cleanQuote(raw: { episode?: unknown; start?: unknown; end?: unknown }): Quote {
  const episode = String(raw?.episode ?? '');
  const start = Number(raw?.start);
  const end = raw?.end === undefined || raw?.end === null ? undefined : Number(raw.end);
  if (!threadExists(`episode:${episode}`) || !Number.isFinite(start)) throw new EditError('Bad pull quote.');
  if (end !== undefined && !(end > start)) throw new EditError('A pull quote has to end after it starts.');
  return { episode, start, ...(end !== undefined && { end }) };
}

/** Hosts only: the movie's take, verdicts and pull quotes as they are in the repo now. */
export const GET: APIRoute = (context) =>
  handle(async () => {
    const author = await host(context);
    if (author instanceof Response) return author;
    const slug = movieParam(context.url.searchParams.get('slug'));
    const text = await readFile(paths.movie(slug));
    if (!text) return fail('Unknown movie', 404);
    const movie = readMovie(text);
    return json({ ...movie, hosts: Object.entries(personNames).map(([id, name]) => ({ id, name })) });
  });

/**
 * Hosts only. Either { slug, take?, verdicts?, quotes? } to save the movie editor, or
 * { slug, addQuote: { episode, start, end? } } to add one pull quote from the transcript.
 */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const author = await host(context);
    if (author instanceof Response) return author;
    const input = await readJson<{ slug?: string; take?: unknown; verdicts?: unknown; quotes?: unknown[]; addQuote?: Quote }>(context.request);
    const slug = movieParam(input?.slug);
    const take = typeof input?.take === 'string' ? input.take.slice(0, 20000) : undefined;
    const verdicts = input?.verdicts === undefined ? undefined : cleanVerdicts(input.verdicts);
    const quotes = Array.isArray(input?.quotes) ? input.quotes.slice(0, 50).map((q) => cleanQuote(q as Quote)) : undefined;
    const quote = input?.addQuote ? cleanQuote(input.addQuote) : undefined;

    const { sha } = await commitEdit(author, async (repo) => {
      const text = await repo.read(paths.movie(slug));
      if (!text) throw new EditError('Unknown movie', 404);
      const next = quote ? addQuote(text, quote) : editMovie(text, { take, verdicts, quotes });
      if (next === text) return null;
      const title = readMovie(text).title;
      return {
        message: quote ? `Pull quote for ${title}: ${quote.episode} at ${clock(quote.start)}` : `Edit movie page: ${title}`,
        files: [{ path: paths.movie(slug), content: next }],
      };
    });
    return saved(sha);
  });
