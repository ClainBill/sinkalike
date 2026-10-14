// Pure helpers for editing content files from the site (no network, no Worker APIs), so they
// can be tested on their own. The API routes in src/pages/api/edit/ read files from GitHub,
// change them with these, and commit the result.
import { parseDocument, type Document } from 'yaml';

export type Segment = { s: number; e: number; sp: string | null; t: string };
export type TranscriptDoc = { episode: string; source: string; model: string; generated: string; segments: Segment[] };
export type LineChange = { s: number; t?: string; sp?: string | null; delete?: boolean };
export type Verdict = { rating?: number; take?: string };
export type Quote = { episode: string; start: number; end?: number };
export type MentionRef = { tmdbId: number; episode: string; s: number };
export type MentionEdits = { added: MentionRef[]; removed: MentionRef[] };

export const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
const sameTime = (a: number, b: number) => Math.abs(a - b) < 0.005;

// ---------------------------------------------------------------- transcripts

/** Same layout the transcriber writes (indent 1, trailing newline), so diffs stay small. */
export const stringifyJson = (value: unknown) => `${JSON.stringify(value, null, 1)}\n`;

/** Transcripts keep the transcriber's float style ("s": 93.0), so edits don't touch other lines. */
export const stringifyTranscript = (doc: TranscriptDoc) => stringifyJson(doc).replace(/^(\s*"[se]": )(-?\d+)(,?)$/gm, '$1$2.0$3');

/** Applies line edits (matched by start time). Returns the new document and how many lines changed. */
export function applyLineChanges(doc: TranscriptDoc, changes: LineChange[], speakers: Set<string>) {
  let changed = 0;
  const segments: Segment[] = [];
  for (const segment of doc.segments) {
    const change = changes.find((c) => sameTime(c.s, segment.s));
    if (!change) {
      segments.push(segment);
      continue;
    }
    if (change.delete) {
      changed++;
      continue;
    }
    const next = { ...segment };
    if (typeof change.t === 'string') {
      const text = change.t.replace(/\s+/g, ' ').trim();
      if (!text) throw new Error(`Line at ${segment.s}s can't be empty. Delete it instead.`);
      next.t = text;
    }
    if (change.sp !== undefined) {
      if (change.sp !== null && !speakers.has(change.sp)) throw new Error(`Unknown speaker "${change.sp}".`);
      next.sp = change.sp;
    }
    if (next.t !== segment.t || next.sp !== segment.sp) changed++;
    segments.push(next);
  }
  const missing = changes.filter((c) => !doc.segments.some((segment) => sameTime(c.s, segment.s)));
  if (missing.length) throw new Error(`${missing.length} edited line(s) no longer exist. Reload the editor and try again.`);
  return { doc: { ...doc, segments }, changed };
}

/** WebVTT captions, matching scripts/transcribe.py's output. */
export function toVtt(segments: Segment[], names: Record<string, string>): string {
  const stamp = (seconds: number) => {
    const ms = Math.round(seconds * 1000);
    const pad = (n: number, width = 2) => String(n).padStart(width, '0');
    return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
  };
  const cues = ['WEBVTT', ''];
  for (const segment of segments) {
    const voice = segment.sp ? `<v ${names[segment.sp] ?? segment.sp}>` : '';
    cues.push(`${stamp(segment.s)} --> ${stamp(segment.e)}`, `${voice}${segment.t}`, '');
  }
  return cues.join('\n');
}

// ---------------------------------------------------------------- movie files

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
export const TAKE_PLACEHOLDER = '<!-- Our take: write your bio of the movie here. Leave empty to show "coming soon". -->';

export function splitMarkdown(text: string): { doc: Document; body: string } {
  const match = text.match(FRONTMATTER);
  if (!match) throw new Error('Movie file has no frontmatter.');
  return { doc: parseDocument(match[1]), body: match[2] };
}

export function joinMarkdown(doc: Document, body: string): string {
  // No line wrapping or list padding, so untouched lines come out exactly as they went in.
  // New strings get double quotes, like the rest of the files.
  const yaml = doc.toString({ lineWidth: 0, flowCollectionPadding: false, defaultStringType: 'QUOTE_DOUBLE', defaultKeyType: 'PLAIN' });
  return `---\n${yaml.trimEnd()}\n---\n${body}`;
}

/** Sets (or, with undefined, removes) one frontmatter field. Lists are written inline: ["a", "b"]. */
export function setField(text: string, path: string[], value: string | number | string[] | undefined): string {
  const { doc, body } = splitMarkdown(text);
  if (value === undefined) doc.deleteIn(path);
  else doc.setIn(path, Array.isArray(value) ? flow(doc, value) : value);
  return joinMarkdown(doc, body);
}

/** Replaces the Markdown body; an empty body becomes `placeholder` (e.g. a hint comment). */
export function setBody(text: string, body: string, placeholder = ''): string {
  const { doc } = splitMarkdown(text);
  const trimmed = body.trim();
  return joinMarkdown(doc, trimmed ? `\n${trimmed}\n` : placeholder ? `\n${placeholder}\n` : '');
}

/** Sets or removes a dotted key in a JSON settings object (copy.json, site.json). */
export function setJsonPath(data: Record<string, unknown>, path: string[], value: string | undefined): Record<string, unknown> {
  const copy = structuredClone(data);
  let node = copy as Record<string, unknown>;
  for (const key of path.slice(0, -1)) {
    if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  const last = path[path.length - 1];
  if (value === undefined) delete node[last];
  else node[last] = value;
  return copy;
}

/** The written take, without the placeholder comment. */
export const takeText = (body: string) => body.replace(/<!--[\s\S]*?-->/g, '').trim();

export function readMovie(text: string) {
  const { doc, body } = splitMarkdown(text);
  const data = (doc.toJS() ?? {}) as { title?: string; year?: number; tmdbId?: number; verdicts?: Record<string, Verdict>; quotes?: Quote[] };
  return { title: data.title ?? '', year: data.year, tmdbId: data.tmdbId, take: takeText(body), verdicts: data.verdicts ?? {}, quotes: data.quotes ?? [] };
}

function flow(doc: Document, value: unknown) {
  const node = doc.createNode(value);
  (node as { flow?: boolean }).flow = true;
  return node;
}

function setQuotes(doc: Document, quotes: Quote[]) {
  if (!quotes.length) return void doc.delete('quotes');
  const seq = doc.createNode([]) as unknown as { items: unknown[] };
  seq.items = quotes.map((quote) => flow(doc, quote.end === undefined ? { episode: quote.episode, start: quote.start } : quote));
  doc.set('quotes', seq);
}

/** Rewrites take, verdicts and/or quotes, keeping everything else (comments included). */
export function editMovie(text: string, edit: { take?: string; verdicts?: Record<string, Verdict>; quotes?: Quote[] }): string {
  const { doc, body } = splitMarkdown(text);
  if (edit.verdicts) {
    const entries = Object.entries(edit.verdicts)
      .map(([id, v]) => [id, { ...(v.rating !== undefined && { rating: v.rating }), ...(v.take && { take: v.take }) }] as const)
      .filter(([, v]) => Object.keys(v).length);
    if (!entries.length) doc.delete('verdicts');
    else {
      const map = doc.createNode({}) as unknown as { items: unknown[] };
      map.items = entries.map(([id, v]) => doc.createPair(id, flow(doc, v)));
      doc.set('verdicts', map);
    }
  }
  if (edit.quotes) setQuotes(doc, edit.quotes);
  const nextBody = edit.take === undefined ? body : edit.take.trim() ? `\n${edit.take.trim()}\n` : `\n${TAKE_PLACEHOLDER}\n`;
  return joinMarkdown(doc, nextBody);
}

export function addQuote(text: string, quote: Quote): string {
  const movie = readMovie(text);
  if (movie.quotes.some((q) => q.episode === quote.episode && sameTime(q.start, quote.start))) return text;
  const quotes = [...movie.quotes, quote].sort((a, b) => a.episode.localeCompare(b.episode, 'en', { numeric: true }) || a.start - b.start);
  const { doc, body } = splitMarkdown(text);
  setQuotes(doc, quotes);
  return joinMarkdown(doc, body);
}

export const slugify = (title: string) =>
  title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export type MovieDetails = {
  id: number;
  title: string;
  year?: number;
  director?: string;
  runtime?: number;
  genres: string[];
  synopsis: string;
};

/** A new movie page, in the same shape find-movies writes. */
export function newMovieFile(movie: MovieDetails, poster: string | null): string {
  const yaml = (value: unknown) => JSON.stringify(value);
  return [
    '---',
    `title: ${yaml(movie.title)}`,
    movie.year ? `year: ${movie.year}` : null,
    movie.director ? `director: ${yaml(movie.director)}` : null,
    movie.runtime ? `runtime: ${movie.runtime}` : null,
    movie.genres.length ? `genres: [${movie.genres.map(yaml).join(', ')}]` : null,
    poster ? `poster: ${poster}` : null,
    `tmdbId: ${movie.id}`,
    `synopsis: ${yaml(movie.synopsis)}`,
    '# Added from the site because it was mentioned on the show.',
    'auto: true',
    '# hidden: true   # take it off the movie list',
    '---',
    '',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

// ---------------------------------------------------------------- mentions

type MentionsFile = Record<string, { episode: string; s: number }[]>;
const sortMentions = (list: { episode: string; s: number }[]) =>
  list.sort((a, b) => a.episode.localeCompare(b.episode, 'en', { numeric: true }) || a.s - b.s);
const sameRef = (a: MentionRef, b: MentionRef) => a.tmdbId === b.tmdbId && a.episode === b.episode && sameTime(a.s, b.s);

/**
 * Adds or removes one mention in mentions.json, and records it in mention-edits.json so
 * `npm run find-movies -- --write` (which rebuilds mentions.json) keeps the change.
 */
export function editMention(mentions: MentionsFile, edits: MentionEdits, ref: MentionRef, add: boolean) {
  const key = String(ref.tmdbId);
  const list = (mentions[key] ?? []).filter((m) => !(m.episode === ref.episode && sameTime(m.s, ref.s)));
  if (add) list.push({ episode: ref.episode, s: ref.s });
  const nextMentions: MentionsFile = { ...mentions };
  if (list.length) nextMentions[key] = sortMentions(list);
  else delete nextMentions[key];
  const ordered = Object.fromEntries(Object.entries(nextMentions).sort(([a], [b]) => Number(a) - Number(b)));

  const added = edits.added.filter((r) => !sameRef(r, ref));
  const removed = edits.removed.filter((r) => !sameRef(r, ref));
  (add ? added : removed).push(ref);
  return { mentions: ordered, edits: { added, removed } };
}
