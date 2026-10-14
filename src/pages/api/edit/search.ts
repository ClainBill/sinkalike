import type { APIRoute } from 'astro';
import { fail, json } from '../../../lib/server/community';
import { handle, host } from '../../../lib/server/edit-api';
import { editBranch, editingEnabled } from '../../../lib/server/github';
import { searchMovies, tmdbEnabled } from '../../../lib/server/tmdb';

export const prerender = false;

/**
 * Hosts only. ?q=playtime searches TMDB for movies to tag. Without q, says what's set up:
 * { editing, tmdb, branch }.
 */
export const GET: APIRoute = (context) =>
  handle(async () => {
    const author = await host(context);
    if (author instanceof Response) return author;
    const query = context.url.searchParams.get('q')?.trim() ?? '';
    if (!query) return json({ editing: editingEnabled(), tmdb: tmdbEnabled(), branch: editBranch() });
    if (query.length > 100) return fail('Search is too long.');
    return json({ results: await searchMovies(query) });
  });
