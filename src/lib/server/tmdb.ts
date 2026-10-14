// Movie search, details and posters for adding movies from the site. Needs the TMDB_API_KEY
// secret (free at https://www.themoviedb.org/settings/api; a v3 key or a v4 read token).
import { env } from 'cloudflare:workers';
import type { MovieDetails } from '../edit/content';
import { EditError } from './github';

const API = 'https://api.themoviedb.org/3';

export const tmdbEnabled = () => !!env.TMDB_API_KEY;

async function tmdb<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const key = env.TMDB_API_KEY;
  if (!key) throw new EditError('Adding new movies needs the TMDB_API_KEY secret (see docs/site-editing.md).', 503);
  const url = new URL(API + path);
  // v4 read tokens are long JWTs; v3 keys are 32 hex characters.
  const headers: Record<string, string> = key.length > 40 ? { Authorization: `Bearer ${key}` } : {};
  if (key.length <= 40) url.searchParams.set('api_key', key);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const response = await fetch(url, { headers });
  if (!response.ok) throw new EditError(`TMDB ${response.status}`, 502);
  return response.json() as Promise<T>;
}

export type SearchResult = { tmdbId: number; title: string; year?: number; thumb?: string };

export async function searchMovies(query: string): Promise<SearchResult[]> {
  const { results } = await tmdb<{ results: { id: number; title: string; release_date?: string; poster_path?: string | null }[] }>(
    '/search/movie',
    { query, include_adult: 'false' },
  );
  return results.slice(0, 8).map((movie) => ({
    tmdbId: movie.id,
    title: movie.title,
    year: Number(movie.release_date?.slice(0, 4)) || undefined,
    thumb: movie.poster_path ? `https://image.tmdb.org/t/p/w92${movie.poster_path}` : undefined,
  }));
}

export async function movieDetails(id: number): Promise<MovieDetails & { posterPath: string | null }> {
  const movie = await tmdb<{
    id: number;
    title: string;
    release_date?: string;
    runtime?: number;
    overview?: string;
    poster_path?: string | null;
    genres?: { name: string }[];
    credits?: { crew?: { job: string; name: string }[] };
  }>(`/movie/${id}`, { append_to_response: 'credits' });
  return {
    id: movie.id,
    title: movie.title,
    year: Number(movie.release_date?.slice(0, 4)) || undefined,
    director: movie.credits?.crew?.filter((person) => person.job === 'Director').map((person) => person.name).join(' & ') || undefined,
    runtime: movie.runtime || undefined,
    genres: movie.genres?.map((genre) => genre.name) ?? [],
    synopsis: movie.overview ?? '',
    posterPath: movie.poster_path ?? null,
  };
}

/** The poster as JPEG bytes (same size the scripts download), or null if it can't be fetched. */
export async function posterBytes(posterPath: string): Promise<Uint8Array | null> {
  const response = await fetch(`https://image.tmdb.org/t/p/w780${posterPath}`);
  if (!response.ok) return null;
  return new Uint8Array(await response.arrayBuffer());
}
