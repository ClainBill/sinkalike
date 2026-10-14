// Build-time helpers that join the RSS feed with your hand-written content.
import { getCollection, type CollectionEntry } from 'astro:content';
import mentionData from '../data/mentions.json';
import { renderBlocks } from './markdown-lite';

export type Person = CollectionEntry<'people'>;
export type Movie = CollectionEntry<'movies'>;
export type Segment = CollectionEntry<'transcripts'>['data']['segments'][number];

export type Episode = CollectionEntry<'feed'>['data'] & {
  /** What Spotify's feed says, before any override from the site. */
  spotifyTitle: string;
  spotifyDescription: string;
  extras?: CollectionEntry<'episodes'>;
  participants: Person[];
  guests: { name: string; url?: string }[];
  movies: Movie[];
  chapters: { start: number; title: string }[];
  poll?: { question: string; options: string[] };
  youtube?: string;
  transcript?: CollectionEntry<'transcripts'>['data'];
};

/** What the audio player needs; serialised into data-episode attributes. */
export type PlayableEpisode = {
  slug: string;
  number: number;
  title: string;
  src: string;
  duration: number;
};

export const playable = (episode: Episode): PlayableEpisode => ({
  slug: episode.slug,
  number: episode.number,
  title: episode.title,
  src: episode.audio.url,
  duration: episode.duration,
});

let cache: Promise<Episode[]> | undefined;

/** All episodes, newest first. */
export function getEpisodes(): Promise<Episode[]> {
  return (cache ??= load());
}

async function load(): Promise<Episode[]> {
  const [feed, extras, transcripts, people, movies] = await Promise.all([
    getCollection('feed'),
    getCollection('episodes'),
    getCollection('transcripts'),
    getCollection('people'),
    getCollection('movies'),
  ]);
  const extrasByGuid = new Map(extras.map((entry) => [entry.data.guid, entry]));
  const transcriptBySlug = new Map(transcripts.map((entry) => [entry.data.episode, entry.data]));
  const personById = new Map(people.map((person) => [person.id, person]));
  const movieById = new Map(movies.map((movie) => [movie.id, movie]));
  const defaultParticipants = people.sort((a, b) => a.data.order - b.data.order);

  return feed
    .map(({ data }) => {
      const extra = extrasByGuid.get(data.guid);
      const participants =
        extra?.data.participants?.map((ref) => personById.get(ref.id)).filter((p): p is Person => !!p) ?? defaultParticipants;
      return {
        ...data,
        // Hosts can override Spotify's wording on the site; the original stays in feed.json.
        title: extra?.data.title ?? data.title,
        description: extra?.data.description !== undefined ? renderBlocks(extra.data.description) : data.description,
        spotifyTitle: data.title,
        spotifyDescription: data.description,
        extras: extra,
        participants,
        guests: extra?.data.guests ?? [],
        movies: (extra?.data.movies ?? []).map((ref) => movieById.get(ref.id)).filter((m): m is Movie => !!m),
        chapters: extra?.data.chapters ?? [],
        poll: extra?.data.poll,
        youtube: extra?.data.youtube,
        transcript: transcriptBySlug.get(data.slug),
      };
    })
    .sort((a, b) => b.number - a.number);
}

export async function getPeople(): Promise<Person[]> {
  return (await getCollection('people')).sort((a, b) => a.data.order - b.data.order);
}

export type Mention = { episode: Episode; segment: Segment };
export type MovieListing = {
  movie: Movie;
  /** Episodes that are about this movie (listed in the episode's `movies:`). */
  episodes: Episode[];
  /** Every line where it was said, from src/data/mentions.json (`npm run find-movies`). */
  mentions: Mention[];
};

function mentionsFor(movie: Movie, episodes: Episode[]): Mention[] {
  const raw = (mentionData as Record<string, { episode: string; s: number }[]>)[String(movie.data.tmdbId)] ?? [];
  return raw
    .map(({ episode: slug, s }) => {
      const episode = episodes.find((e) => e.slug === slug);
      const segment = episode?.transcript?.segments.find((segment) => Math.abs(segment.s - s) < 0.01);
      return episode && segment ? { episode, segment } : null;
    })
    .filter((mention): mention is Mention => mention !== null);
}

/**
 * Every movie on the list (discussed or just mentioned), minus ones marked `hidden: true`.
 * Discussed movies first, newest episode first; then mentioned ones, most recent first.
 */
export async function getMovies(): Promise<MovieListing[]> {
  const [episodes, movies] = await Promise.all([getEpisodes(), getCollection('movies')]);
  return movies
    .filter((movie) => !movie.data.hidden)
    .map((movie) => ({
      movie,
      episodes: episodes.filter((episode) => episode.movies.some((m) => m.id === movie.id)),
      mentions: mentionsFor(movie, episodes),
    }))
    .filter((listing) => listing.episodes.length > 0 || listing.mentions.length > 0 || !listing.movie.data.auto)
    .sort((a, b) => {
      const discussed = (l: MovieListing) => l.episodes[0]?.number ?? 0;
      const mentioned = (l: MovieListing) => Math.max(0, ...l.mentions.map((m) => m.episode.number));
      return discussed(b) - discussed(a) || mentioned(b) - mentioned(a) || b.mentions.length - a.mentions.length;
    });
}

const SAID_AS: Record<string, string> = { ii: '2', iii: '3', iv: '4', one: '1', two: '2', three: '3', four: '4', versus: 'v', vs: 'v' };
const normWord = (word: string) => {
  const w = word.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  return SAID_AS[w] ?? w;
};

/**
 * The words around where a movie is named in a transcript line, split so the title can be
 * highlighted. Matches the title or its aliases loosely ("Frozen II" said "Frozen 2",
 * "The Boxtrolls" said "box trolls").
 */
export function mentionSnippet(movie: Movie, text: string, radius = 12) {
  const words = text.split(/\s+/).filter(Boolean);
  const norms = words.map(normWord);
  let found: [number, number] | null = null;
  const bare = (word: string) => word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
  // First look for the title as written (capitalised: "love Cars"), then loosely ("cars three").
  for (const exact of [true, false]) {
    for (const candidate of [movie.data.title, ...movie.data.aliases]) {
      const target = candidate.split(/[\s:–—-]+/).map(normWord).filter(Boolean);
      const targets = [target.join(''), target[0] === 'the' ? target.slice(1).join('') : ''].filter(Boolean);
      const wanted = candidate.replace(/^the\s+/i, '').split(/[\s:–—-]+/).map(bare).filter(Boolean);
      for (let i = 0; i < words.length && !found; i++) {
        for (let len = 1; len <= 6 && i + len <= words.length; len++) {
          if (!targets.includes(norms.slice(i, i + len).join(''))) continue;
          const asWritten = words.slice(i, i + len).map(bare).filter((w) => w.toLowerCase() !== 'the');
          if (exact && asWritten.join(' ') !== wanted.join(' ')) continue;
          found = [i, i + len];
          break;
        }
      }
      if (found) break;
    }
    if (found) break;
  }
  if (!found) {
    const short = words.length > radius * 2 ? `${words.slice(0, radius * 2).join(' ')}…` : text;
    return { before: short, match: '', after: '' };
  }
  const [from, to] = found;
  const match = words.slice(from, to).join(' ');
  const trimmed = match.replace(/[.,?!;:]+$/, '');
  return {
    before: (from > radius ? '…' : '') + words.slice(Math.max(0, from - radius), from).join(' ') + (from ? ' ' : ''),
    match: trimmed,
    after: match.slice(trimmed.length) + (to < words.length ? ' ' : '') + words.slice(to, to + radius).join(' ') + (to + radius < words.length ? '…' : ''),
  };
}

/** Speaker display info for a transcript segment. */
export function speakerName(id: string | null, people: Person[]): string {
  if (!id) return '';
  return people.find((person) => person.id === id)?.data.short ?? id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Lines from `start` (inclusive) up to `end`, or just the line that contains `start`. */
export function linesAt(segments: Segment[], start: number, end?: number): Segment[] {
  const first = segments.findIndex((segment) => segment.e > start - 0.05);
  if (first === -1) return [];
  if (end === undefined) return [segments[first]];
  return segments.slice(first).filter((segment) => segment.s < end);
}
