// Hosts' transcript editor: fix wording and speakers, delete lines, tag the movies said on a
// line, and turn lines into pull quotes. Loads the latest transcript from the repo, so it
// includes edits that aren't live yet. Text/speaker edits are saved together as one commit;
// tags and pull quotes save straight away.
import type { ComponentChildren } from 'preact';
import { memo } from 'preact/compat';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { clock, editApi, liveSoon, setupWarning, type EditSetup, type MovieOption } from '../../lib/edit-client';
import './editor.css';

type Segment = { s: number; e: number; sp: string | null; t: string };
type Edit = { t?: string; sp?: string | null; delete?: boolean };
type Mention = { tmdbId: number; s: number };
type Speaker = { id: string; name: string };
type SearchResult = { tmdbId: number; title: string; year?: number; thumb?: string };
type Panel = { s: number; kind: 'tag' | 'quote' } | null;
type Props = { episode: string; movies: MovieOption[]; about: string[]; onClose: () => void };

const PAGE = 250;
const key = (s: number) => String(s);

export default function TranscriptEditor({ episode, movies, about, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [setup, setSetup] = useState<EditSetup | null>(null);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [filter, setFilter] = useState('');
  const [changedOnly, setChangedOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [panel, setPanel] = useState<Panel>(null);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>({ text: 'Loading the latest transcript…' });
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [newTitles, setNewTitles] = useState<Record<number, string>>({});

  useEffect(() => {
    dialog.current?.showModal();
    Promise.all([
      editApi<{ segments: Segment[]; speakers: Speaker[]; mentions: Mention[] }>(`transcript?episode=${encodeURIComponent(episode)}`),
      editApi<EditSetup>('search'),
    ])
      .then(([data, setupInfo]) => {
        setSegments(data.segments);
        setSpeakers(data.speakers);
        setMentions(data.mentions);
        setSetup(setupInfo);
        setStatus(setupWarning(setupInfo) ? { text: setupWarning(setupInfo), error: true } : null);
      })
      .catch((error) => setStatus({ text: (error as Error).message, error: true }));
  }, [episode]);

  const byStart = useMemo(() => new Map((segments ?? []).map((line) => [key(line.s), line])), [segments]);
  const changeCount = Object.keys(edits).length;

  const change = useCallback(
    (s: number, patch: Edit) =>
      setEdits((previous) => {
        const line = byStart.get(key(s));
        if (!line) return previous;
        const next: Edit = { ...previous[key(s)], ...patch };
        if (next.t !== undefined && next.t.replace(/\s+/g, ' ').trim() === line.t) delete next.t;
        if (next.sp !== undefined && next.sp === line.sp) delete next.sp;
        if (!next.delete) delete next.delete;
        const all = { ...previous };
        if (Object.keys(next).length) all[key(s)] = next;
        else delete all[key(s)];
        return all;
      }),
    [byStart],
  );

  const togglePanel = useCallback((s: number, kind: 'tag' | 'quote') => setPanel((p) => (p?.s === s && p.kind === kind ? null : { s, kind })), []);

  const titleOf = useCallback(
    (tmdbId: number) => movies.find((m) => m.tmdbId === tmdbId)?.title ?? newTitles[tmdbId] ?? `TMDB #${tmdbId}`,
    [movies, newTitles],
  );

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setStatus({ text: 'Saving…' });
    try {
      setStatus({ text: await work() });
    } catch (error) {
      setStatus({ text: (error as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  const tag = (s: number, tmdbId: number, title: string) =>
    run(async () => {
      const result = await editApi<{ movie?: { title: string } }>('mention', { episode, s, tmdbId, add: true });
      const name = result.movie?.title ?? title;
      setNewTitles((t) => ({ ...t, [tmdbId]: name }));
      setMentions((list) => [...list.filter((m) => !(m.tmdbId === tmdbId && m.s === s)), { tmdbId, s }]);
      setPanel(null);
      return `Tagged ${name} at ${clock(s)}. ${liveSoon(setup)}`;
    });

  const untag = useCallback(
    (mention: Mention) =>
      run(async () => {
        await editApi('mention', { episode, s: mention.s, tmdbId: mention.tmdbId, add: false });
        setMentions((list) => list.filter((m) => !(m.tmdbId === mention.tmdbId && m.s === mention.s)));
        return `Removed ${titleOf(mention.tmdbId)} at ${clock(mention.s)}. ${liveSoon(setup)}`;
      }),
    [episode, setup, titleOf],
  );

  const quote = (slug: string, start: number, end?: number) =>
    run(async () => {
      await editApi('movie', { slug, addQuote: { episode, start, ...(end !== undefined && { end }) } });
      setPanel(null);
      return `Added a pull quote to ${movies.find((m) => m.slug === slug)?.title ?? slug}. ${liveSoon(setup)}`;
    });

  const save = () =>
    run(async () => {
      const changes = Object.entries(edits).map(([s, edit]) => ({ s: Number(s), ...edit }));
      const result = await editApi<{ changed: number }>('transcript', { episode, changes });
      setSegments((lines) =>
        (lines ?? []).flatMap((line) => {
          const edit = edits[key(line.s)];
          if (!edit) return [line];
          if (edit.delete) return [];
          return [{ ...line, ...(edit.t !== undefined && { t: edit.t.replace(/\s+/g, ' ').trim() }), ...(edit.sp !== undefined && { sp: edit.sp }) }];
        }),
      );
      showOnPage(changes);
      setEdits({});
      return `Saved ${result.changed} line${result.changed === 1 ? '' : 's'}. ${liveSoon(setup)}`;
    });

  const close = () => {
    if (changeCount && !confirmClose) return setConfirmClose(true);
    dialog.current?.close();
    onClose();
  };

  const query = filter.trim().toLowerCase();
  const visible = (segments ?? []).filter((line) => {
    const edit = edits[key(line.s)];
    if (changedOnly && !edit) return false;
    return !query || (edit?.t ?? line.t).toLowerCase().includes(query) || clock(line.s) === query;
  });
  const mentionsAt = useMemo(() => {
    const map = new Map<string, Mention[]>();
    for (const m of mentions) map.set(key(m.s), [...(map.get(key(m.s)) ?? []), m]);
    return map;
  }, [mentions]);
  const speakerList = useMemo(() => {
    const known = new Set(speakers.map((s) => s.id));
    const extra = [...new Set((segments ?? []).map((l) => l.sp).filter((sp): sp is string => !!sp && !known.has(sp)))];
    return [...speakers, ...extra.map((id) => ({ id, name: id }))];
  }, [speakers, segments]);

  return (
    <dialog
      ref={dialog}
      class="editor"
      aria-label="Edit transcript"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header class="editor-head">
        <div class="editor-title">
          <h2>Edit transcript</h2>
          <p class="meta">
            Click a time to hear it. Text and speaker changes save together; tags and pull quotes save straight away.
          </p>
        </div>
        <div class="editor-buttons">
          {confirmClose ? (
            <>
              <span class="meta">Discard {changeCount} unsaved change{changeCount === 1 ? '' : 's'}?</span>
              <button type="button" class="btn btn-small" onClick={close}>
                Discard
              </button>
              <button type="button" class="btn btn-small" onClick={() => setConfirmClose(false)}>
                Keep editing
              </button>
            </>
          ) : (
            <>
              <button type="button" class="btn btn-small btn-primary" disabled={!changeCount || busy || !setup?.editing} onClick={save}>
                {changeCount ? `Save ${changeCount} change${changeCount === 1 ? '' : 's'}` : 'No changes'}
              </button>
              <button type="button" class="btn btn-small" onClick={close}>
                Close
              </button>
            </>
          )}
        </div>
        <div class="editor-tools">
          <input
            class="input"
            type="search"
            placeholder="Find a line (words or 12:34)"
            value={filter}
            onInput={(e) => (setFilter(e.currentTarget.value), setLimit(PAGE))}
          />
          <label class="meta">
            <input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.currentTarget.checked)} /> Changed lines only
          </label>
          {segments && (
            <span class="meta">
              {visible.length} of {segments.length} lines
            </span>
          )}
        </div>
        {status && (
          <p class={status.error ? 'editor-status error' : 'editor-status'} role="status">
            {status.text}
          </p>
        )}
      </header>

      <ol class="editor-lines">
        {visible.slice(0, limit).map((line) => (
          <Row
            key={key(line.s)}
            line={line}
            edit={edits[key(line.s)]}
            speakers={speakerList}
            tags={mentionsAt.get(key(line.s))}
            panel={panel?.s === line.s ? panel.kind : null}
            busy={busy}
            onChange={change}
            onPanel={togglePanel}
            onUntag={untag}
            titleOf={titleOf}
          >
            {panel?.s !== line.s ? null : panel.kind === 'tag' ? (
              <TagPanel movies={movies} setup={setup} busy={busy} onPick={(id, title) => tag(line.s, id, title)} />
            ) : (
              <QuotePanel lines={following(segments!, line.s)} movies={movies} about={about} busy={busy} onPick={quote} />
            )}
          </Row>
        ))}
      </ol>
      {visible.length > limit && (
        <p class="editor-more">
          <button type="button" class="btn" onClick={() => setLimit((n) => n + PAGE)}>
            Show more lines
          </button>
        </p>
      )}
    </dialog>
  );
}

type RowProps = {
  line: Segment;
  edit?: Edit;
  speakers: Speaker[];
  tags?: Mention[];
  panel: 'tag' | 'quote' | null;
  busy: boolean;
  onChange: (s: number, patch: Edit) => void;
  onPanel: (s: number, kind: 'tag' | 'quote') => void;
  onUntag: (mention: Mention) => void;
  titleOf: (tmdbId: number) => string;
  children?: ComponentChildren;
};

const Row = memo(function Row({ line, edit, speakers, tags, panel, busy, onChange, onPanel, onUntag, titleOf, children }: RowProps) {
  const text = edit?.t ?? line.t;
  const sp = edit?.sp !== undefined ? edit.sp : line.sp;
  const deleted = !!edit?.delete;
  return (
    <li class={['editor-line', sp && `person person-${sp}`, edit && 'is-changed', deleted && 'is-deleted'].filter(Boolean).join(' ')}>
      <button type="button" class="editor-time" data-play={line.s} title="Play from here">
        {clock(line.s)}
      </button>
      <select
        class="editor-speaker"
        aria-label="Speaker"
        value={sp ?? ''}
        disabled={deleted}
        onChange={(e) => onChange(line.s, { sp: e.currentTarget.value || null })}
      >
        <option value="">No speaker</option>
        {speakers.map((person) => (
          <option value={person.id}>{person.name}</option>
        ))}
      </select>
      <textarea
        class="editor-text"
        aria-label={`Line at ${clock(line.s)}`}
        rows={Math.min(6, Math.max(1, Math.ceil(text.length / 70)))}
        value={text}
        disabled={deleted}
        onInput={(e) => onChange(line.s, { t: e.currentTarget.value })}
      />
      <div class="editor-actions">
        <button type="button" class={panel === 'tag' ? 'linkish is-on' : 'linkish'} disabled={deleted} onClick={() => onPanel(line.s, 'tag')}>
          Tag movie
        </button>
        <button type="button" class={panel === 'quote' ? 'linkish is-on' : 'linkish'} disabled={deleted} onClick={() => onPanel(line.s, 'quote')}>
          Pull quote
        </button>
        <button type="button" class="linkish" onClick={() => onChange(line.s, { delete: !deleted })}>
          {deleted ? 'Undo delete' : 'Delete'}
        </button>
      </div>
      {tags && tags.length > 0 && (
        <p class="editor-tags">
          {tags.map((mention) => (
            <span class="editor-chip">
              🎬 {titleOf(mention.tmdbId)}
              <button type="button" aria-label={`Remove ${titleOf(mention.tmdbId)} from this line`} disabled={busy} onClick={() => onUntag(mention)}>
                ×
              </button>
            </span>
          ))}
        </p>
      )}
      {children && <div class="editor-panel">{children}</div>}
    </li>
  );
});

function TagPanel({ movies, setup, busy, onPick }: { movies: MovieOption[]; setup: EditSetup | null; busy: boolean; onPick: (tmdbId: number, title: string) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const q = query.trim().toLowerCase();
  const local = q ? movies.filter((m) => m.tmdbId && m.title.toLowerCase().includes(q)).slice(0, 5) : [];

  useEffect(() => {
    if (!setup?.tmdb || q.length < 2) return setResults([]);
    const timer = setTimeout(async () => {
      setSearching(true);
      setError('');
      try {
        setResults((await editApi<{ results: SearchResult[] }>(`search?q=${encodeURIComponent(q)}`)).results);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q, setup?.tmdb]);

  const remote = results.filter((r) => !local.some((m) => m.tmdbId === r.tmdbId));
  return (
    <div class="tag-panel">
      <input class="input" type="search" placeholder="Which movie? e.g. Playtime" value={query} autoFocus onInput={(e) => setQuery(e.currentTarget.value)} />
      {!setup?.tmdb && <p class="meta">Only movies already on the site can be tagged until the TMDB_API_KEY secret is added.</p>}
      {error && <p class="error">{error}</p>}
      <ul class="tag-results">
        {local.map((movie) => (
          <li>
            <button type="button" disabled={busy} onClick={() => onPick(movie.tmdbId!, movie.title)}>
              <span class="tag-thumb" aria-hidden="true">🎬</span>
              {movie.title} {movie.year && <span class="meta">({movie.year})</span>} <span class="badge">On the site</span>
            </button>
          </li>
        ))}
        {remote.map((movie) => (
          <li>
            <button type="button" disabled={busy} onClick={() => onPick(movie.tmdbId, movie.title)}>
              {movie.thumb ? <img class="tag-thumb" src={movie.thumb} alt="" width={23} height={34} /> : <span class="tag-thumb" aria-hidden="true">🎬</span>}
              {movie.title} {movie.year && <span class="meta">({movie.year})</span>}
            </button>
          </li>
        ))}
      </ul>
      {searching && <p class="meta">Searching…</p>}
      {q.length >= 2 && !searching && !local.length && !remote.length && setup?.tmdb && <p class="meta">No matches.</p>}
    </div>
  );
}

function QuotePanel({
  lines,
  movies,
  about,
  busy,
  onPick,
}: {
  lines: Segment[];
  movies: MovieOption[];
  about: string[];
  busy: boolean;
  onPick: (slug: string, start: number, end?: number) => void;
}) {
  const options = [...movies].sort((a, b) => Number(about.includes(b.slug)) - Number(about.includes(a.slug)) || a.title.localeCompare(b.title));
  const [slug, setSlug] = useState(options[0]?.slug ?? '');
  const [count, setCount] = useState(1);
  const chosen = lines.slice(0, count);
  return (
    <div class="quote-panel">
      <label class="meta">
        Movie{' '}
        <select class="input" value={slug} onChange={(e) => setSlug(e.currentTarget.value)}>
          {options.map((movie) => (
            <option value={movie.slug}>
              {movie.title}
              {about.includes(movie.slug) ? ' (this episode)' : ''}
            </option>
          ))}
        </select>
      </label>
      <label class="meta">
        Lines{' '}
        <select class="input" value={count} onChange={(e) => setCount(Number(e.currentTarget.value))}>
          {lines.map((_, i) => (
            <option value={i + 1}>{i === 0 ? 'Just this one' : `This and the next ${i}`}</option>
          ))}
        </select>
      </label>
      <blockquote class="quote-preview">“{chosen.map((l) => l.t).join(' ')}”</blockquote>
      <button
        type="button"
        class="btn btn-small btn-primary"
        disabled={busy || !slug}
        onClick={() => onPick(slug, chosen[0].s, count > 1 ? chosen[count - 1].e : undefined)}
      >
        Add pull quote
      </button>
    </div>
  );
}

/** The line at `s` and the few after it, for multi-line pull quotes. */
function following(lines: Segment[], s: number): Segment[] {
  const index = lines.findIndex((line) => line.s === s);
  return lines.slice(index, index + 6);
}

/** Shows saved wording on the page straight away (speaker changes appear after the rebuild). */
function showOnPage(changes: { s: number; t?: string; delete?: boolean }[]) {
  for (const change of changes) {
    for (const element of document.querySelectorAll<HTMLElement>(`.transcript-body .line[data-s="${change.s}"]`)) {
      if (change.delete) element.remove();
      else if (change.t !== undefined) element.textContent = `${change.t.replace(/\s+/g, ' ').trim()} `;
    }
  }
}
