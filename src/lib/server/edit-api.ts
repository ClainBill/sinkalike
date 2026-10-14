// Shared plumbing for the hosts-only editing API (src/pages/api/edit/*).
import type { APIContext } from 'astro';
import { fail, json, viewer } from './community';
import { EditError, type Author } from './github';

export const paths = {
  transcript: (episode: string) => `src/content/transcripts/${episode}.json`,
  vtt: (episode: string) => `public/transcripts/${episode}.vtt`,
  movie: (slug: string) => `src/content/movies/${slug}.md`,
  poster: (slug: string) => `src/content/movies/posters/${slug}.jpg`,
  mentions: 'src/data/mentions.json',
  mentionEdits: 'src/data/mention-edits.json',
};

/** The signed-in host making this request, or an error response for anyone else. */
export async function host(context: APIContext): Promise<Author | Response> {
  // Writes must come from this site's own pages.
  if (context.request.method !== 'GET' && context.request.headers.get('origin') !== context.url.origin) {
    return fail('Bad origin', 403);
  }
  const me = await viewer(context);
  if (!me.admin || !me.user) return fail('Only hosts can edit the site.', 403);
  return { name: me.user.name || me.user.email || me.user.phoneNumber || 'A host', email: me.user.email || 'hosts@sink-alike.wcgill.com' };
}

/** Runs an edit handler, turning thrown errors into JSON error responses. */
export async function handle(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof EditError) return fail(error.message, error.status);
    if (error instanceof Error && !(error instanceof TypeError)) return fail(error.message, 400);
    console.error(error);
    return fail('Something went wrong saving that. Try again.', 500);
  }
}

export const saved = (sha: string | null, extra: Record<string, unknown> = {}) => json({ ok: true, sha, ...extra });

/** "12:34" for commit messages. */
export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
