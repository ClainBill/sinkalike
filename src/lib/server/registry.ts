// Which comment threads and polls exist, read from content frontmatter at build time.
// (Only frontmatter is bundled into the Worker, not transcripts.)
import { autoPollOptions } from '../../site.config';

type Frontmatter = {
  poll?: { question: string; options: string[] };
  verdicts?: Record<string, { rating?: number; take?: string }>;
};

const episodes = import.meta.glob<Frontmatter>('/src/content/episodes/*.md', { eager: true, import: 'frontmatter' });
const movies = import.meta.glob<Frontmatter>('/src/content/movies/*.md', { eager: true, import: 'frontmatter' });

const slugOf = (path: string) => path.split('/').pop()!.replace(/\.md$/, '');

const polls = new Map<string, number>();
const threads = new Set<string>();

for (const [path, data] of Object.entries(episodes)) {
  const key = `episode:${slugOf(path)}`;
  threads.add(key);
  if (data?.poll) polls.set(key, data.poll.options.length);
}
for (const [path, data] of Object.entries(movies)) {
  const key = `movie:${slugOf(path)}`;
  threads.add(key);
  const verdicts = Object.entries(data?.verdicts ?? {}).filter(([, v]) => v.rating !== undefined || v.take);
  const options = data?.poll?.options ?? autoPollOptions(verdicts.map(([id]) => id));
  if (options) polls.set(key, options.length);
}

export const threadExists = (key: string) => threads.has(key);
export const pollOptionCount = (key: string) => polls.get(key) ?? 0;

// ---- For editing on the site.
const people = import.meta.glob<{ name?: string }>('/src/content/people/*.md', { eager: true, import: 'frontmatter' });

/** person id → full name, e.g. { adam: 'Adam Estock' }. */
export const personNames: Record<string, string> = Object.fromEntries(
  Object.entries(people).map(([path, data]) => [slugOf(path), data?.name ?? slugOf(path)]),
);

/** Who can be picked as a transcript line's speaker: every host, plus the episode's guests. */
export function speakerChoices(episode: string): { id: string; name: string }[] {
  const data = Object.entries(episodes).find(([path]) => slugOf(path) === episode)?.[1] as { guests?: { name: string }[] } | undefined;
  const guests = (data?.guests ?? []).map((guest) => ({
    id: guest.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    name: guest.name,
  }));
  return [...Object.entries(personNames).map(([id, name]) => ({ id, name })), ...guests];
}

/** Movie slug for a TMDB id, among movies that existed at the last deploy. */
export function movieSlugFor(tmdbId: number): string | undefined {
  const entry = Object.entries(movies).find(([, data]) => (data as { tmdbId?: number } | undefined)?.tmdbId === tmdbId);
  return entry && slugOf(entry[0]);
}
