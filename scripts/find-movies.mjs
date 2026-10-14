#!/usr/bin/env node
// Finds every movie mentioned in the transcripts and adds it to the movie list.
//
//   npm run find-movies              # list what it finds (changes nothing)
//   npm run find-movies -- --write   # also create src/content/movies/<slug>.md for new ones
//   npm run find-movies -- 2         # only look at episode 2
//
// Titles are matched against TMDB's free daily list of every movie (no API key needed).
// Titles that are ordinary words ("Up", "Cars", "Her") only count when spoken as a proper
// title, e.g. capitalised mid-sentence, so everyday phrases don't turn into movies. Anything
// it gets wrong can be removed from the site by a host (Remove button) or by setting
// `hidden: true` in the movie's file.
//
// Posters and details come from the TMDB API when TMDB_API_KEY is set (free:
// https://www.themoviedb.org/settings/api), otherwise from the movie's public TMDB page.

import { createReadStream, existsSync } from 'node:fs';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';

const ROOT = new URL('../', import.meta.url);
const CACHE = new URL('.cache/tmdb/', ROOT);
const TRANSCRIPTS = new URL('src/content/transcripts/', ROOT);
const MOVIES = new URL('src/content/movies/', ROOT);
const IGNORE_FILE = new URL('scripts/movie-ignore.txt', ROOT);
// Mentions hosts tagged or removed on the site (kept when mentions.json is rebuilt).
const EDITS_FILE = new URL('src/data/mention-edits.json', ROOT);

const MIN_POPULARITY = 1.5;
const NUMBER_WORDS = new Map(Object.entries({
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  // Sequels are written "Frozen II" on TMDB but said "Frozen 2". (Not "i"/"v": those are words.)
  ii: '2', iii: '3', iv: '4', vi: '6', vii: '7', viii: '8', ix: '9',
  versus: 'v', vs: 'v',
}));
// A title made of everyday words ("Monster House") counts in lowercase only near words like these.
const MOVIE_CONTEXT = /\b(movies?|films?|watch(ed|ing)?|seen|sequel|trilogy|franchise|cinema|pixar|disney|marvel|animated|rated)\b/i;
const SMALL_WORDS = new Set(['a', 'an', 'and', 'the', 'of', 'in', 'on', 'to', 'for', 'at', 'by', 'with', 'from', 'or', 'v']);
const EXTRA_COMMON = [
  // Everyday podcast speech that happens to be a film title somewhere.
  'yeah', 'okay', 'ok', 'um', 'uh', 'like', 'right', 'so', 'well', 'oh', 'wow', 'no', 'yes', 'hello', 'hi', 'bye', 'sorry', 'thanks',
  'movie', 'movies', 'film', 'films', 'episode', 'podcast', 'sink', 'alike', 'i', 'im', 'its', 'thats', 'dont', 'youre', 'hes', 'shes',
];

// ---------------------------------------------------------------- text helpers

const normalizeToken = (token) => {
  const t = token
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]/g, '');
  return NUMBER_WORDS.get(t) ?? t;
};

const tokenize = (text) =>
  text
    .replace(/[–—-]/g, ' ')
    .split(/\s+/)
    .map((raw) => ({ raw, norm: normalizeToken(raw) }))
    .filter((token) => token.norm);

const slugify = (title) =>
  title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

async function commonWords() {
  const words = new Set(EXTRA_COMMON);
  for (const path of ['/usr/share/dict/words', '/usr/share/dict/web2']) {
    if (!existsSync(path)) continue;
    for (const word of (await readFile(path, 'utf8')).split('\n')) {
      // Capitalised entries are proper nouns (names, places): not "common".
      if (word && word[0] === word[0].toLowerCase()) words.add(normalizeToken(word));
    }
    break;
  }
  // Plurals, verb forms and comparatives of dictionary words are common too.
  for (const word of [...words]) {
    for (const suffix of ['s', 'es', 'd', 'ed', 'ing', 'r', 'er', 'st', 'est', 'ly']) words.add(word + suffix);
    if (word.endsWith('y')) for (const suffix of ['ies', 'ied', 'ier', 'iest']) words.add(word.slice(0, -1) + suffix);
    if (word.endsWith('e')) words.add(word.slice(0, -1) + 'ing');
  }
  return words;
}

// ---------------------------------------------------------------- TMDB title index

async function latestExport() {
  await mkdir(CACHE, { recursive: true });
  const file = new URL('movie_ids.json.gz', CACHE);
  const stale = !existsSync(file) || Date.now() - (await import('node:fs')).statSync(file).mtimeMs > 30 * 86400_000;
  if (!stale) return file;
  for (let back = 1; back <= 4; back++) {
    const day = new Date(Date.now() - back * 86400_000);
    const stamp = `${String(day.getUTCMonth() + 1).padStart(2, '0')}_${String(day.getUTCDate()).padStart(2, '0')}_${day.getUTCFullYear()}`;
    const response = await fetch(`https://files.tmdb.org/p/exports/movie_ids_${stamp}.json.gz`);
    if (response.ok) {
      console.log(`Downloaded TMDB title list (${stamp})`);
      await writeFile(file, Buffer.from(await response.arrayBuffer()));
      return file;
    }
  }
  if (existsSync(file)) return file;
  throw new Error('Could not download the TMDB title list.');
}

/** normalized title (spaced, and with spaces removed) -> most popular movie with that title */
async function titleIndex() {
  const spaced = new Map();
  const joined = new Map();
  const lines = createInterface({ input: createReadStream(await latestExport()).pipe(createGunzip()) });
  for await (const line of lines) {
    const movie = JSON.parse(line);
    if (movie.adult || movie.video || movie.popularity < MIN_POPULARITY) continue;
    // Only titles written in the Latin alphabet can be matched against an English transcript.
    if (/[^\p{Script=Latin}\p{N}\p{P}\p{S}\s]/u.test(movie.original_title)) continue;
    const tokens = tokenize(movie.original_title).map((t) => t.norm);
    if (!tokens.length) continue;
    const variants = [tokens];
    if (tokens[0] === 'the' && tokens.length > 1) variants.push(tokens.slice(1));
    for (const variant of variants) {
      const key = variant.join(' ');
      if ((spaced.get(key)?.popularity ?? -1) < movie.popularity) spaced.set(key, movie);
      const squashed = variant.join('');
      if (squashed.length >= 6 && (joined.get(squashed)?.popularity ?? -1) < movie.popularity) joined.set(squashed, movie);
    }
  }
  return { spaced, joined };
}

// ---------------------------------------------------------------- matching

function isTitleCased(tokens) {
  return tokens.every((t, i) => {
    const first = t.raw.replace(/^[^A-Za-z0-9]+/, '')[0] ?? '';
    if (/[0-9]/.test(first)) return true;
    if (i > 0 && SMALL_WORDS.has(t.norm)) return true;
    return first === first.toUpperCase() && first !== first.toLowerCase();
  });
}

function startsSentence(tokens, index) {
  if (index === 0) return true;
  return /[.?!]["”']?$/.test(tokens[index - 1].raw);
}

const isNumber = (word) => /^\d+$/.test(word);

/** Is this n-gram really someone naming a movie, rather than an everyday phrase? */
function looksLikeTitle(slice, tokens, i, movie, line, common, ownWords) {
  const n = slice.length;
  const words = slice.map((t) => t.norm).filter((w) => !SMALL_WORDS.has(w));
  if (!words.length || words.every(isNumber)) return false;
  const plain = words.filter((w) => !isNumber(w));
  const hasNumber = plain.length < words.length;
  const allCommon = plain.every((w) => common.has(w));
  const titleCased = isTitleCased(slice);
  const sentenceStart = startsSentence(tokens, i);
  const popularity = movie.popularity;

  if (n === 1) {
    // One word ("Interstellar", "Boxtrolls"): capitalised mid-sentence, and either an unusual
    // word or a very well-known film. Words from the episode's own movie ("Speed") never count.
    if (ownWords.has(words[0]) || words[0].length < 4 || !titleCased || sentenceStart) return false;
    return allCommon ? popularity >= 25 : popularity >= 8;
  }
  if (allCommon && hasNumber) return titleCased && popularity >= 3; // "Frozen 2", "Cars 3"
  if (allCommon) {
    // Everyday words ("The Matrix", "Monster House"): capitalised like a title, or (two or more
    // real words) said in a sentence that's clearly about movies. "the greatest" never counts.
    // At the start of a sentence only the first word is capitalised normally, so every word
    // capitalised ("Tron Legacy is…") still reads as a title, if it's a well-known film.
    if (titleCased && (!sentenceStart || n >= 3 || popularity >= 10)) {
      return plain.length >= 2 || !sentenceStart; // "the Greatest" at a sentence start is just English
    }
    const phrase = slice.map((t) => t.raw).join(' ');
    return plain.length >= 2 && popularity >= 10 && MOVIE_CONTEXT.test(line.t.replace(phrase, ''));
  }
  return popularity >= 2; // contains a name ("Ford v Ferrari", "Tron Legacy", "Box Trolls")
}

function findInLine(line, index, common, ownWords) {
  const tokens = tokenize(line.t);
  const hits = [];
  let i = 0;
  while (i < tokens.length) {
    let matched = null;
    for (let n = Math.min(7, tokens.length - i); n >= 1 && !matched; n--) {
      const slice = tokens.slice(i, i + n);
      if (SMALL_WORDS.has(slice[0].norm) && n > 1 && slice[0].norm !== 'the') continue;
      if (SMALL_WORDS.has(slice[n - 1].norm)) continue;
      const key = slice.map((t) => t.norm).join(' ');
      const squashed = slice.map((t) => t.norm).join('');
      const movie = index.spaced.get(key) ?? (n >= 2 && n <= 3 ? index.joined.get(squashed) : undefined);
      if (movie && looksLikeTitle(slice, tokens, i, movie, line, common, ownWords)) {
        matched = { movie, n, phrase: slice.map((t) => t.raw).join(' ').replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '') };
      }
    }
    if (matched) {
      hits.push(matched);
      i += matched.n;
    } else i++;
  }
  return hits;
}

/** Words in the titles of the movies an episode is about, e.g. {speed, racer}. */
async function episodeOwnWords(episode) {
  const file = new URL(`src/content/episodes/${episode}.md`, ROOT);
  if (!existsSync(file)) return new Set();
  const slugs = (await readFile(file, 'utf8')).match(/^movies:\s*\[([^\]]*)\]/m)?.[1].split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  const words = new Set();
  for (const slug of slugs) {
    const movie = new URL(`${slug}.md`, MOVIES);
    if (!existsSync(movie)) continue;
    const title = (await readFile(movie, 'utf8')).match(/^title:\s*"?([^"\n]+)"?/m)?.[1] ?? '';
    for (const token of tokenize(title)) words.add(token.norm);
  }
  return words;
}

// ---------------------------------------------------------------- movie files

const yaml = (value) => JSON.stringify(value);

async function details(id) {
  const key = process.env.TMDB_API_KEY ?? (await readFile(new URL('.dev.vars', ROOT), 'utf8').catch(() => '')).match(/^TMDB_API_KEY\s*=\s*"?([^"\n]+)"?/m)?.[1];
  if (key) {
    const url = new URL(`https://api.themoviedb.org/3/movie/${id}`);
    const headers = key.length > 40 ? { Authorization: `Bearer ${key}` } : {};
    if (key.length <= 40) url.searchParams.set('api_key', key);
    url.searchParams.set('append_to_response', 'credits');
    const movie = await (await fetch(url, { headers })).json();
    return {
      title: movie.title,
      year: Number(movie.release_date?.slice(0, 4)) || undefined,
      director: movie.credits?.crew?.filter((p) => p.job === 'Director').map((p) => p.name).join(' & ') || undefined,
      runtime: movie.runtime || undefined,
      genres: movie.genres?.map((g) => g.name) ?? [],
      synopsis: movie.overview ?? '',
      poster: movie.poster_path ? `https://image.tmdb.org/t/p/w780${movie.poster_path}` : undefined,
    };
  }
  // No API key: read the public page's metadata.
  const html = await (await fetch(`https://www.themoviedb.org/movie/${id}`, { headers: { 'User-Agent': 'Mozilla/5.0 sinkalike' } })).text();
  const meta = (property) => html.match(new RegExp(`<meta property="og:${property}" content="([^"]*)"`))?.[1];
  const decode = (text) => text?.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
  const year = Number(html.match(/class="tag release_date">\((\d{4})\)/)?.[1]) || undefined;
  const poster = meta('image')?.replace(/\/t\/p\/[^/]+\//, '/t/p/w780/');
  return { title: decode(meta('title')), year, genres: [], synopsis: decode(meta('description')) ?? '', poster };
}

async function writeMovie(found) {
  const info = await details(found.movie.id);
  const title = info.title ?? found.movie.original_title;
  const slug = slugify(title);
  const file = new URL(`${slug}.md`, MOVIES);
  if (existsSync(file)) return null;
  let poster;
  if (info.poster) {
    const image = await fetch(info.poster);
    if (image.ok) {
      await mkdir(new URL('posters/', MOVIES), { recursive: true });
      await writeFile(new URL(`posters/${slug}.jpg`, MOVIES), Buffer.from(await image.arrayBuffer()));
      poster = `./posters/${slug}.jpg`;
    }
  }
  const aliases = [...found.phrases].filter((p) => normalizeToken(p) !== normalizeToken(title));
  const lines = [
    '---',
    `title: ${yaml(title)}`,
    info.year ? `year: ${info.year}` : null,
    info.director ? `director: ${yaml(info.director)}` : null,
    info.runtime ? `runtime: ${info.runtime}` : null,
    info.genres?.length ? `genres: [${info.genres.map(yaml).join(', ')}]` : null,
    poster ? `poster: ${poster}` : null,
    `tmdbId: ${found.movie.id}`,
    `synopsis: ${yaml(info.synopsis ?? '')}`,
    '# Added automatically because it was mentioned on the show.',
    'auto: true',
    aliases.length ? `# Other ways it's written in transcripts:\naliases: [${aliases.map(yaml).join(', ')}]` : null,
    '# hidden: true   # take it off the movie list',
    '---',
    '',
  ].filter((line) => line !== null);
  await writeFile(file, lines.join('\n'));
  return slug;
}

// ---------------------------------------------------------------- main

/**
 * Once a title is confirmed in an episode, catch the other times it was said there too, even
 * in lowercase ("i love interstellar"). Skipped for everyday words said all the time ("cars").
 */
function expandMentions(entry, transcript, common) {
  const titleTokens = tokenize(entry.movie.original_title).map((t) => t.norm);
  const variants = [titleTokens, titleTokens[0] === 'the' ? titleTokens.slice(1) : null].filter((v) => v?.length);
  const content = titleTokens.filter((w) => !SMALL_WORDS.has(w));
  const lines = transcript.segments.map((line) => ({ line, norms: tokenize(line.t).map((t) => t.norm) }));
  const contains = (norms, variant) => norms.some((_, i) => variant.every((w, k) => norms[i + k] === w));
  const hits = lines.filter(({ norms }) => variants.some((v) => contains(norms, v)));
  const everyday = content.length === 1 && common.has(content[0]) && (content[0].length < 6 || hits.length > 4);
  if (everyday) return;
  const seen = new Set(entry.mentions.map((m) => `${m.episode}:${m.s}`));
  for (const { line } of hits) {
    if (seen.has(`${transcript.episode}:${line.s}`)) continue;
    entry.mentions.push({ episode: transcript.episode, s: line.s, t: line.t });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const only = args.find((arg) => !arg.startsWith('--'));

  const ignored = existsSync(IGNORE_FILE)
    ? new Set((await readFile(IGNORE_FILE, 'utf8')).split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean).map(Number))
    : new Set();
  const existing = new Map();
  for (const name of await readdir(MOVIES)) {
    if (!name.endsWith('.md')) continue;
    const text = await readFile(new URL(name, MOVIES), 'utf8');
    const id = Number(text.match(/^tmdbId:\s*(\d+)/m)?.[1]);
    if (id) existing.set(id, name.replace(/\.md$/, ''));
  }

  console.log('Loading movie titles…');
  const [index, common] = await Promise.all([titleIndex(), commonWords()]);

  // Always scan every transcript, so mentions.json is complete; `only` just filters the report.
  const found = new Map();
  for (const name of (await readdir(TRANSCRIPTS)).filter((n) => n.endsWith('.json'))) {
    const transcript = JSON.parse(await readFile(new URL(name, TRANSCRIPTS), 'utf8'));
    const ownWords = await episodeOwnWords(transcript.episode);
    const inEpisode = new Set();
    for (const line of transcript.segments) {
      for (const hit of findInLine(line, index, common, ownWords)) {
        if (ignored.has(hit.movie.id)) continue;
        const entry = found.get(hit.movie.id) ?? { movie: hit.movie, phrases: new Set(), mentions: [] };
        entry.phrases.add(hit.phrase);
        if (!entry.mentions.some((m) => m.episode === transcript.episode && m.s === line.s)) {
          entry.mentions.push({ episode: transcript.episode, s: line.s, t: line.t });
        }
        found.set(hit.movie.id, entry);
        inEpisode.add(hit.movie.id);
      }
    }
    for (const id of inEpisode) expandMentions(found.get(id), transcript, common);
  }

  const shown = [...found.values()]
    .filter((entry) => !only || entry.mentions.some((m) => m.episode === only || m.episode.startsWith(`${only}-`)))
    .sort((a, b) => b.mentions.length - a.mentions.length);
  console.log(`\nFound ${shown.length} movie(s):\n`);
  for (const entry of shown) {
    const status = existing.has(entry.movie.id) ? `already in list (${existing.get(entry.movie.id)})` : 'new';
    const first = entry.mentions[0];
    console.log(`  ${entry.movie.original_title}  [tmdb ${entry.movie.id}, ×${entry.mentions.length}, ${status}]`);
    console.log(`      “${first.t.slice(0, 100)}” (${first.episode} @ ${Math.floor(first.s / 60)}:${String(Math.floor(first.s % 60)).padStart(2, '0')})`);
  }

  if (!write) {
    console.log('\nRun with --write to add the new ones. Wrong matches: add the tmdb id to scripts/movie-ignore.txt.');
    return;
  }
  for (const entry of shown) {
    if (existing.has(entry.movie.id)) continue;
    const slug = await writeMovie(entry);
    if (slug) console.log(`Added src/content/movies/${slug}.md`);
  }
  // Exact lines per movie, read by the site (keyed by TMDB id, sorted by time).
  const lists = new Map([...found.values()].map((entry) => [entry.movie.id, entry.mentions.map(({ episode, s }) => ({ episode, s }))]));
  // Hosts' tags and removals from the site win over what was found here.
  const edits = existsSync(EDITS_FILE) ? JSON.parse(await readFile(EDITS_FILE, 'utf8')) : { added: [], removed: [] };
  const same = (a, b) => a.episode === b.episode && Math.abs(a.s - b.s) < 0.005;
  for (const ref of edits.removed) lists.set(ref.tmdbId, (lists.get(ref.tmdbId) ?? []).filter((m) => !same(m, ref)));
  for (const ref of edits.added) {
    const list = lists.get(ref.tmdbId) ?? [];
    if (!list.some((m) => same(m, ref))) list.push({ episode: ref.episode, s: ref.s });
    lists.set(ref.tmdbId, list);
  }
  const mentions = {};
  for (const [id, list] of [...lists].sort(([a], [b]) => a - b)) {
    if (list.length) mentions[id] = list.sort((a, b) => a.episode.localeCompare(b.episode, 'en', { numeric: true }) || a.s - b.s);
  }
  await writeFile(new URL('src/data/mentions.json', ROOT), `${JSON.stringify(mentions, null, 1)}\n`);
  console.log('Updated src/data/mentions.json');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
