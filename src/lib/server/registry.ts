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
