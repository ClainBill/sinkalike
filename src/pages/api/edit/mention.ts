import type { APIRoute } from 'astro';
import { editMention, newMovieFile, readMovie, slugify, stringifyJson, type MentionEdits, type TranscriptDoc } from '../../../lib/edit/content';
import { fail, readJson } from '../../../lib/server/community';
import { clock, handle, host, paths, saved } from '../../../lib/server/edit-api';
import { commitEdit, EditError, type FileChange, type Snapshot } from '../../../lib/server/github';
import { movieSlugFor, threadExists } from '../../../lib/server/registry';
import { movieDetails, posterBytes } from '../../../lib/server/tmdb';

export const prerender = false;

/** The movie page for a TMDB id, creating it (with its poster) if it doesn't exist yet. */
async function ensureMovie(repo: Snapshot, tmdbId: number): Promise<{ slug: string; title: string; files: FileChange[] }> {
  const known = movieSlugFor(tmdbId);
  if (known) {
    const text = await repo.read(paths.movie(known));
    if (text) return { slug: known, title: readMovie(text).title, files: [] };
  }
  const details = await movieDetails(tmdbId);
  const base = slugify(details.title) || `movie-${tmdbId}`;
  // Added since the last deploy (so not in the registry), or a different film with the same name?
  for (const slug of [base, `${base}-${details.year ?? tmdbId}`, `${base}-${tmdbId}`]) {
    const existing = await repo.read(paths.movie(slug));
    if (existing && readMovie(existing).tmdbId === tmdbId) return { slug, title: details.title, files: [] };
    if (existing) continue;
    const poster = details.posterPath ? await posterBytes(details.posterPath) : null;
    const files: FileChange[] = [{ path: paths.movie(slug), content: newMovieFile(details, poster ? `./posters/${slug}.jpg` : null) }];
    if (poster) files.push({ path: paths.poster(slug), content: poster });
    return { slug, title: details.title, files };
  }
  throw new EditError(`Couldn't pick a page name for ${details.title}.`, 409);
}

/** Hosts only: { episode, s, tmdbId, add } tags (or untags) a movie on a transcript line. */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const author = await host(context);
    if (author instanceof Response) return author;
    const input = await readJson<{ episode?: string; s?: number; tmdbId?: number; add?: boolean }>(context.request);
    const episode = String(input?.episode ?? '');
    const tmdbId = Number(input?.tmdbId);
    const add = input?.add !== false;
    if (!threadExists(`episode:${episode}`)) return fail('Unknown episode', 404);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0 || !Number.isFinite(Number(input?.s))) return fail('Pick a line and a movie.');

    let movie: { slug: string; title: string } | undefined;
    const { sha } = await commitEdit(author, async (repo) => {
      const transcript = await repo.read(paths.transcript(episode));
      const line = transcript && (JSON.parse(transcript) as TranscriptDoc).segments.find((s) => Math.abs(s.s - Number(input!.s)) < 0.005);
      if (!line) throw new EditError('That line is no longer in the transcript. Reload the editor.', 409);

      const ensured = add ? await ensureMovie(repo, tmdbId) : { slug: movieSlugFor(tmdbId) ?? '', title: `TMDB ${tmdbId}`, files: [] };
      movie = { slug: ensured.slug, title: ensured.title };
      const [mentionsText, editsText] = await Promise.all([repo.read(paths.mentions), repo.read(paths.mentionEdits)]);
      const edits: MentionEdits = editsText ? JSON.parse(editsText) : { added: [], removed: [] };
      const next = editMention(JSON.parse(mentionsText ?? '{}'), edits, { tmdbId, episode, s: line.s }, add);
      return {
        message: `${add ? 'Tag' : 'Untag'} ${ensured.title} in ${episode} at ${clock(line.s)}`,
        files: [
          ...ensured.files,
          { path: paths.mentions, content: stringifyJson(next.mentions) },
          { path: paths.mentionEdits, content: stringifyJson(next.edits) },
        ],
      };
    });
    return saved(sha, { movie });
  });
