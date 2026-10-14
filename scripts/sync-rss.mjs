#!/usr/bin/env node
// Pulls the podcast RSS feed into src/data/feed.json and creates a stub
// src/content/episodes/<slug>.md for any episode that doesn't have one yet.
//
// feed.json is fully owned by this script (safe to regenerate). The episode .md
// files are yours: this script never edits one after creating it, except to fill in
// `guid: pending` on a file made before the episode was on RSS (see below).
//
//   node scripts/sync-rss.mjs            # sync
//   node scripts/sync-rss.mjs --check    # exit 1 if feed.json would change (CI)

import { readFile, writeFile, access, readdir } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';

const FEED_URL = process.env.FEED_URL ?? 'https://anchor.fm/s/117c72e60/podcast/rss';
const FEED_JSON = new URL('../src/data/feed.json', import.meta.url);
const EPISODES_DIR = new URL('../src/content/episodes/', import.meta.url);
const DEFAULT_PARTICIPANTS = ['adam', 'william'];

const exists = (url) => access(url).then(() => true, () => false);

function slugify(title, number) {
  // "Speed Racer: The greatest movie…" -> "1-speed-racer"
  const head = title.split(/[:|–—-]\s/)[0];
  const words = head
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 6);
  return [number, ...words].join('-');
}

function parseDuration(value) {
  if (value == null) return 0;
  const parts = String(value).split(':').map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

const text = (node) => (typeof node === 'object' && node !== null ? node['#text'] ?? '' : node ?? '');

async function main() {
  const check = process.argv.includes('--check');
  const response = await fetch(FEED_URL);
  if (!response.ok) throw new Error(`Feed request failed: ${response.status} ${FEED_URL}`);
  const xml = await response.text();

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', cdataPropName: false });
  const channel = parser.parse(xml).rss.channel;
  const items = [channel.item ?? []].flat();

  const previous = (await exists(FEED_JSON)) ? JSON.parse(await readFile(FEED_JSON, 'utf8')) : { episodes: [] };
  const known = new Map(previous.episodes.map((episode) => [episode.guid, episode]));
  let nextNumber = Math.max(0, ...previous.episodes.map((episode) => episode.number)) + 1;

  // Episode files written ahead of publishing (<number>-<slug>.md with `guid: pending`) claim
  // the new episode with that number, so its transcript and extras keep their slug.
  const pending = new Map();
  for (const name of await readdir(EPISODES_DIR)) {
    const number = Number(name.match(/^(\d+)-.+\.md$/)?.[1]);
    if (number && /^guid:\s*pending\b.*$/m.test(await readFile(new URL(name, EPISODES_DIR), 'utf8'))) {
      pending.set(number, name.slice(0, -3));
    }
  }

  // Oldest first so new episodes get increasing numbers.
  const sorted = items
    .map((item) => ({ item, date: new Date(item.pubDate) }))
    .sort((a, b) => a.date - b.date);

  const episodes = sorted.map(({ item, date }) => {
    const guid = text(item.guid);
    const title = text(item.title).trim();
    const prior = known.get(guid);
    const number = Number(item['itunes:episode']) || prior?.number || nextNumber++;
    return {
      guid,
      number,
      slug: prior?.slug ?? pending.get(number) ?? slugify(title, number),
      title,
      description: text(item.description).trim(),
      published: date.toISOString(),
      duration: parseDuration(item['itunes:duration']),
      audio: {
        url: item.enclosure.url,
        type: item.enclosure.type,
        bytes: Number(item.enclosure.length) || 0,
      },
      link: text(item.link),
      image: item['itunes:image']?.href ?? channel['itunes:image']?.href ?? null,
      explicit: String(item['itunes:explicit']) === 'true',
    };
  });

  const feed = {
    title: text(channel.title),
    description: text(channel.description),
    author: text(channel['itunes:author']),
    image: channel['itunes:image']?.href ?? null,
    link: text(channel.link),
    feedUrl: FEED_URL,
    episodes,
  };

  const output = `${JSON.stringify(feed, null, 2)}\n`;
  const current = (await exists(FEED_JSON)) ? await readFile(FEED_JSON, 'utf8') : '';
  if (check) {
    if (current !== output) {
      console.log('feed.json is out of date');
      process.exit(1);
    }
    console.log('feed.json is up to date');
    return;
  }

  if (current !== output) await writeFile(FEED_JSON, output);

  const created = [];
  const claimed = [];
  for (const episode of episodes) {
    const file = new URL(`${episode.slug}.md`, EPISODES_DIR);
    if (pending.get(episode.number) === episode.slug) {
      const text = await readFile(file, 'utf8');
      await writeFile(file, text.replace(/^guid:\s*pending\b.*$/m, `guid: ${episode.guid}`));
      claimed.push(episode.slug);
      continue;
    }
    if (await exists(file)) continue;
    await writeFile(
      file,
      [
        '---',
        `guid: ${episode.guid}`,
        `participants: [${DEFAULT_PARTICIPANTS.join(', ')}]`,
        'guests: []',
        '# Movie slugs from src/content/movies (add with: npm run add-movie -- "Title" 2008)',
        'movies: []',
        '# chapters:',
        '#   - { start: 0, title: Intro }',
        '# poll:',
        '#   question: "…"',
        '#   options: ["…", "…"]',
        '---',
        '',
        '<!-- Optional extra show notes. The RSS description is shown above this automatically. -->',
        '',
      ].join('\n'),
    );
    created.push(episode.slug);
  }

  console.log(`Synced ${episodes.length} episode(s) from ${FEED_URL}`);
  if (current !== output) console.log('Updated src/data/feed.json');
  for (const slug of created) console.log(`Created src/content/episodes/${slug}.md`);
  for (const slug of claimed) console.log(`Filled in the guid in src/content/episodes/${slug}.md`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
