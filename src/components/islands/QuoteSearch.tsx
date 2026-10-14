import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import MiniSearch from 'minisearch';
import { play, type PlayableEpisode } from '../../lib/player';
import { timestamp } from '../../lib/format';
import { track } from '../../lib/analytics';

type Line = { id: number; e: number; s: number; sp: string | null; t: string };
type Index = { episodes: PlayableEpisode[]; speakers: Record<string, string>; lines: Line[] };

type Props = {
  people: { id: string; name: string }[];
  episodes: { slug: string; number: number; title: string }[];
};

const SUGGESTIONS = ['Speed Racer', 'favorite', 'best movie', 'racing', 'I disagree'];
const PAGE = 30;

function readParams() {
  const params = new URLSearchParams(location.search);
  return { q: params.get('q') ?? '', sp: params.get('sp') ?? '', ep: params.get('ep') ?? '' };
}

/** Quoted phrases must match exactly; everything else is fuzzy word search. */
function parseQuery(raw: string) {
  const phrases = [...raw.matchAll(/"([^"]+)"/g)].map((m) => m[1].toLowerCase());
  const words = raw.replace(/"[^"]*"/g, ' ').trim();
  return { phrases, words };
}

function highlight(text: string, terms: string[]) {
  if (!terms.length) return text;
  const escaped = terms
    .filter((t) => t.length > 1)
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!escaped.length) return text;
  const parts = text.split(new RegExp(`(${escaped.join('|')})`, 'gi'));
  return parts.map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

export default function QuoteSearch({ people, episodes }: Props) {
  const [index, setIndex] = useState<Index | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [speaker, setSpeaker] = useState('');
  const [episode, setEpisode] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const initial = readParams();
    setQuery(initial.q);
    setSpeaker(initial.sp);
    setEpisode(initial.ep);
    fetch('/quotes/index.json')
      .then((response) => response.json())
      .then((data: { episodes: PlayableEpisode[]; speakers: Record<string, string>; lines: [number, number, string | null, string][] }) =>
        setIndex({
          episodes: data.episodes,
          speakers: data.speakers,
          lines: data.lines.map(([e, s, sp, t], id) => ({ id, e, s, sp, t })),
        }),
      )
      .catch(() => setFailed(true));
    input.current?.focus();
  }, []);

  const search = useMemo(() => {
    if (!index) return null;
    const mini = new MiniSearch<Line>({
      fields: ['t'],
      storeFields: [],
      searchOptions: { prefix: true, fuzzy: 0.15, combineWith: 'AND' },
    });
    mini.addAll(index.lines);
    return mini;
  }, [index]);

  useEffect(() => {
    setLimit(PAGE);
    setExpanded(null);
  }, [query, speaker, episode]);

  // Keep the URL shareable, and count the search, once typing pauses. (Cloudflare Web
  // Analytics counts each URL change as a page view, so not on every keystroke.)
  const lastSearch = useRef('');
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (speaker) params.set('sp', speaker);
      if (episode) params.set('ep', episode);
      const next = `${location.pathname}${params.size ? `?${params}` : ''}`;
      if (next !== `${location.pathname}${location.search}`) history.replaceState(history.state, '', next);
      const text = query.trim().toLowerCase();
      if (text.length >= 2 && text !== lastSearch.current) track('search', { label: text.slice(0, 80) });
      lastSearch.current = text;
    }, 1000);
    return () => clearTimeout(timer);
  }, [query, speaker, episode]);

  const { results, terms } = useMemo(() => {
    const empty = { results: [] as Line[], terms: [] as string[] };
    if (!index || !search) return empty;
    const { phrases, words } = parseQuery(query);
    const episodeIndex = episode ? index.episodes.findIndex((e) => e.slug === episode) : -1;
    const keep = (line: Line) =>
      (!speaker || line.sp === speaker) &&
      (episodeIndex < 0 || line.e === episodeIndex) &&
      phrases.every((phrase) => line.t.toLowerCase().includes(phrase));

    if (!words && !phrases.length) return empty;
    if (!words) return { results: index.lines.filter(keep), terms: phrases };
    // Highlight the words that actually matched (fuzzy/prefix hits included), not just what was typed.
    const hits = search.search(words);
    const matched = new Set<string>(phrases);
    const lines = hits
      .map((hit) => {
        hit.terms.forEach((term) => matched.add(term));
        return index.lines[hit.id as number];
      })
      .filter(keep);
    return { results: lines, terms: [...matched] };
  }, [index, search, query, speaker, episode]);

  const linkFor = (line: Line) => `/episodes/${index!.episodes[line.e].slug}/?t=${Math.floor(line.s)}`;

  const copyLink = async (line: Line) => {
    try {
      await navigator.clipboard.writeText(new URL(linkFor(line), location.origin).toString());
      setCopied(line.id);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* clipboard blocked */
    }
  };

  const context = (line: Line) =>
    index!.lines.filter((other) => other.e === line.e && Math.abs(other.id - line.id) <= 3 && other.id !== line.id);

  return (
    <div class="quote-search">
      <form class="qs-bar" role="search" onSubmit={(e) => e.preventDefault()}>
        <label class="sr-only" for="qs-input">
          Search quotes
        </label>
        <input
          id="qs-input"
          ref={input}
          class="input qs-input"
          type="search"
          placeholder='Try a word, or "an exact phrase"'
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
          autocomplete="off"
          spellcheck={false}
        />
        <div class="qs-filters">
          <label>
            <span class="sr-only">Who said it</span>
            <select class="input" value={speaker} onChange={(e) => setSpeaker(e.currentTarget.value)}>
              <option value="">Anyone</option>
              {people.map((person) => (
                <option value={person.id}>{person.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span class="sr-only">Episode</span>
            <select class="input" value={episode} onChange={(e) => setEpisode(e.currentTarget.value)}>
              <option value="">All episodes</option>
              {episodes.map((ep) => (
                <option value={ep.slug}>
                  Ep {ep.number}: {ep.title}
                </option>
              ))}
            </select>
          </label>
        </div>
      </form>

      <p class="meta qs-status" aria-live="polite">
        {failed
          ? 'Couldn’t load the quote index. Refresh to try again.'
          : !index
            ? 'Loading every word we’ve ever said…'
            : query.trim()
              ? `${results.length.toLocaleString()} line${results.length === 1 ? '' : 's'}`
              : `${index.lines.length.toLocaleString()} lines across ${index.episodes.length} episode${index.episodes.length === 1 ? '' : 's'}`}
      </p>

      {!query.trim() && (
        <div class="qs-suggest">
          <span class="meta">Try:</span>
          {SUGGESTIONS.map((s) => (
            <button type="button" class="btn btn-small" onClick={() => setQuery(s.includes(' ') ? `"${s}"` : s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <ol class="qs-results">
        {index &&
          results.slice(0, limit).map((line) => {
            const ep = index.episodes[line.e];
            return (
              <li key={line.id} class={line.sp ? `person person-${line.sp}` : ''}>
                <blockquote>
                  {expanded === line.id &&
                    context(line)
                      .filter((c) => c.id < line.id)
                      .map((c) => <p class="qs-context">{c.t}</p>)}
                  <p>{highlight(line.t, terms)}</p>
                  {expanded === line.id &&
                    context(line)
                      .filter((c) => c.id > line.id)
                      .map((c) => <p class="qs-context">{c.t}</p>)}
                </blockquote>
                <div class="qs-meta">
                  {line.sp && <strong class="qs-speaker">{index.speakers[line.sp] ?? line.sp}</strong>}
                  <a href={linkFor(line)} class="meta">
                    Ep {ep.number}: {ep.title} · {timestamp(line.s)}
                  </a>
                </div>
                <div class="qs-actions">
                  <button
                    type="button"
                    class="btn btn-small"
                    onClick={() => play(ep, line.s)}
                  >
                    ▶ Play from here
                  </button>
                  <button type="button" class="btn btn-small" onClick={() => setExpanded(expanded === line.id ? null : line.id)}>
                    {expanded === line.id ? 'Less context' : 'More context'}
                  </button>
                  <button type="button" class="btn btn-small" onClick={() => copyLink(line)}>
                    {copied === line.id ? 'Link copied' : 'Copy link'}
                  </button>
                </div>
              </li>
            );
          })}
      </ol>

      {results.length > limit && (
        <button type="button" class="btn" onClick={() => setLimit(limit + PAGE)}>
          Show more ({results.length - limit} left)
        </button>
      )}
    </div>
  );
}
