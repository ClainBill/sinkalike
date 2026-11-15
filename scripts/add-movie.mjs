#!/usr/bin/env node
// Adds a movie page from TMDB: downloads the poster and writes src/content/movies/<slug>.md
//
//   TMDB_API_KEY=… npm run add-movie -- "Speed Racer" 2008
//   TMDB_API_KEY=… npm run add-movie -- --id 7459
//
// Get a free key at https://www.themoviedb.org/settings/api (put it in .dev.vars or your shell).
// The generated file is yours to edit: write "Our take" in the body and fill in verdicts.

import { writeFile, access, readFile } from 'node:fs/promises';

const MOVIES = new URL('../src/content/movies/', import.meta.url);
const API = 'https://api.themoviedb.org/3';

async function apiKey() {
  if (process.env.TMDB_API_KEY) return process.env.TMDB_API_KEY;
  try {
    const vars = await readFile(new URL('../.dev.vars', import.meta.url), 'utf8');
    return vars.match(/^TMDB_API_KEY\s*=\s*"?([^"\n]+)"?/m)?.[1];
  } catch {
    return undefined;
  }
}

async function tmdb(path, key, params = {}) {
  const url = new URL(API + path);
  // v4 read tokens are long JWTs; v3 keys are 32 hex chars. Support both.
  const headers = key.length > 40 ? { Authorization: `Bearer ${key}` } : {};
  if (key.length <= 40) url.searchParams.set('api_key', key);
  for (const [name, value] of Object.entries(params)) if (value) url.searchParams.set(name, value);
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`TMDB ${response.status}: ${await response.text()}`);
  return response.json();
}

const slugify = (title) =>
  title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const yaml = (value) => JSON.stringify(value);

async function main() {
  const key = await apiKey();
  if (!key) throw new Error('Set TMDB_API_KEY (free at https://www.themoviedb.org/settings/api).');

  const args = process.argv.slice(2);
  let id;
  if (args[0] === '--id') {
    id = args[1];
  } else {
    const [query, year] = args;
    if (!query) throw new Error('Usage: npm run add-movie -- "Title" [year]   or   -- --id <tmdbId>');
    const { results } = await tmdb('/search/movie', key, { query, year });
    if (!results.length) throw new Error(`No TMDB results for "${query}"${year ? ` (${year})` : ''}`);
    id = results[0].id;
    if (results.length > 1) {
      console.log('Picked the top match. Others:');
      for (const r of results.slice(1, 5)) console.log(`  --id ${r.id}  ${r.title} (${r.release_date?.slice(0, 4)})`);
    }
  }

  const movie = await tmdb(`/movie/${id}`, key, { append_to_response: 'credits' });
  const year = Number(movie.release_date?.slice(0, 4)) || undefined;
  const slug = slugify(movie.title);
  const file = new URL(`${slug}.md`, MOVIES);
  if (await access(file).then(() => true, () => false)) throw new Error(`src/content/movies/${slug}.md already exists`);

  let poster = '';
  if (movie.poster_path) {
    const image = await fetch(`https://image.tmdb.org/t/p/w780${movie.poster_path}`);
    await writeFile(new URL(`posters/${slug}.jpg`, MOVIES), Buffer.from(await image.arrayBuffer()));
    poster = `./posters/${slug}.jpg`;
  }

  const directors = movie.credits?.crew?.filter((person) => person.job === 'Director').map((person) => person.name) ?? [];
  const lines = [
    '---',
    `title: ${yaml(movie.title)}`,
    year ? `year: ${year}` : null,
    directors.length ? `director: ${yaml(directors.join(' & '))}` : null,
    movie.runtime ? `runtime: ${movie.runtime}` : null,
    movie.genres?.length ? `genres: [${movie.genres.map((genre) => yaml(genre.name)).join(', ')}]` : null,
    poster ? `poster: ${poster}` : null,
    `tmdbId: ${movie.id}`,
    `synopsis: ${yaml(movie.overview ?? '')}`,
    '# Each host: rating out of 10 and a one-line take. Delete a host to hide them.',
    '# verdicts:',
    '#   adam: { rating: 8, take: "…" }',
    '#   william: { rating: 6, take: "…" }',
    '#   ty: { rating: 7, take: "…" }',
    '# Pull quotes: episode slug + the start time (seconds) of a transcript line. Add `end` to include following lines.',
    '# quotes:',
    '#   - { episode: 1-speed-racer, start: 612.4 }',
    '---',
    '',
    '<!-- Our take: write your bio of the movie here. Leave empty to show "coming soon". -->',
    '',
  ].filter((line) => line !== null);

  await writeFile(file, lines.join('\n'));
  console.log(`Created src/content/movies/${slug}.md${poster ? ` and posters/${slug}.jpg` : ''}`);
  console.log(`Add "${slug}" to the episode's movies: list.`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
