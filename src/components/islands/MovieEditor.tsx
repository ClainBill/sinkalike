// Hosts' movie page editor: Our take, each host's verdict, and the pull quotes.
// Loads the movie file from the repo and saves it back as one commit.
import { useEffect, useRef, useState } from 'preact/hooks';
import { clock, editApi, liveSoon, setupWarning, type EditSetup } from '../../lib/edit-client';
import './editor.css';

type Verdict = { rating?: number; take?: string };
type Quote = { episode: string; start: number; end?: number };
type MovieData = { title: string; take: string; verdicts: Record<string, Verdict>; quotes: Quote[]; hosts: { id: string; name: string }[] };
type Draft = { take: string; verdicts: Record<string, { rating: string; take: string }>; removed: number[] };
type Props = { slug: string; title: string; onClose: () => void };

const toDraft = (movie: MovieData): Draft => ({
  take: movie.take,
  verdicts: Object.fromEntries(
    movie.hosts.map((host) => [host.id, { rating: movie.verdicts[host.id]?.rating?.toString() ?? '', take: movie.verdicts[host.id]?.take ?? '' }]),
  ),
  removed: [],
});

export default function MovieEditor({ slug, title, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [movie, setMovie] = useState<MovieData | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [setup, setSetup] = useState<EditSetup | null>(null);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>({ text: 'Loading…' });
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
    Promise.all([editApi<MovieData>(`movie?slug=${encodeURIComponent(slug)}`), editApi<EditSetup>('search')])
      .then(([data, setupInfo]) => {
        setMovie(data);
        setDraft(toDraft(data));
        setSetup(setupInfo);
        setStatus(setupWarning(setupInfo) ? { text: setupWarning(setupInfo), error: true } : null);
      })
      .catch((error) => setStatus({ text: (error as Error).message, error: true }));
  }, [slug]);

  const dirty = !!movie && !!draft && JSON.stringify(draft) !== JSON.stringify(toDraft(movie));

  const save = async () => {
    if (!movie || !draft) return;
    setBusy(true);
    setStatus({ text: 'Saving…' });
    try {
      const verdicts = Object.fromEntries(
        Object.entries(draft.verdicts).map(([id, v]) => [id, { rating: v.rating.trim() === '' ? undefined : Number(v.rating), take: v.take }]),
      );
      const quotes = movie.quotes.filter((_, i) => !draft.removed.includes(i));
      await editApi('movie', { slug, take: draft.take, verdicts, quotes });
      const saved: MovieData = {
        ...movie,
        take: draft.take.trim(),
        quotes,
        verdicts: Object.fromEntries(
          Object.entries(verdicts).map(([id, v]) => [id, { ...(v.rating !== undefined && { rating: v.rating }), ...(v.take.trim() && { take: v.take.trim() }) }]),
        ),
      };
      setMovie(saved);
      setDraft(toDraft(saved));
      setStatus({ text: liveSoon(setup) });
    } catch (error) {
      setStatus({ text: (error as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (dirty && !confirmClose) return setConfirmClose(true);
    dialog.current?.close();
    onClose();
  };

  const setVerdict = (id: string, field: 'rating' | 'take', value: string) =>
    setDraft((d) => d && { ...d, verdicts: { ...d.verdicts, [id]: { ...d.verdicts[id], [field]: value } } });

  return (
    <dialog
      ref={dialog}
      class="editor editor-narrow"
      aria-label={`Edit ${title}`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header class="editor-head">
        <div class="editor-title">
          <h2>Edit {title}</h2>
        </div>
        <div class="editor-buttons">
          {confirmClose ? (
            <>
              <span class="meta">Discard your changes?</span>
              <button type="button" class="btn btn-small" onClick={close}>
                Discard
              </button>
              <button type="button" class="btn btn-small" onClick={() => setConfirmClose(false)}>
                Keep editing
              </button>
            </>
          ) : (
            <>
              <button type="button" class="btn btn-small btn-primary" disabled={!dirty || busy || !setup?.editing} onClick={save}>
                {dirty ? 'Save' : 'No changes'}
              </button>
              <button type="button" class="btn btn-small" onClick={close}>
                Close
              </button>
            </>
          )}
        </div>
        {status && (
          <p class={status.error ? 'editor-status error' : 'editor-status'} role="status">
            {status.text}
          </p>
        )}
      </header>

      {movie && draft && (
        <div class="movie-form">
          <section>
            <h3>Verdicts</h3>
            <p class="meta">A rating out of 10 and a one-line take. Leave both empty to hide that host’s verdict.</p>
            {movie.hosts.map((host) => (
              <div class={`verdict-row person person-${host.id}`}>
                <span class="verdict-name">{host.name}</span>
                <input
                  class="input verdict-rating"
                  type="number"
                  min={0}
                  max={10}
                  step={0.5}
                  placeholder="–"
                  aria-label={`${host.name}'s rating out of 10`}
                  value={draft.verdicts[host.id]?.rating ?? ''}
                  onInput={(e) => setVerdict(host.id, 'rating', e.currentTarget.value)}
                />
                <span class="meta">/10</span>
                <input
                  class="input verdict-take"
                  type="text"
                  maxLength={300}
                  placeholder="One-line take"
                  aria-label={`${host.name}'s take`}
                  value={draft.verdicts[host.id]?.take ?? ''}
                  onInput={(e) => setVerdict(host.id, 'take', e.currentTarget.value)}
                />
              </div>
            ))}
          </section>

          <section>
            <h3>Our take</h3>
            <p class="meta">Markdown: **bold**, *italic*, a blank line starts a new paragraph. Leave empty to show “coming soon”.</p>
            <textarea
              class="input take-text"
              rows={12}
              value={draft.take}
              onInput={(e) => setDraft((d) => d && { ...d, take: e.currentTarget.value })}
            />
          </section>

          <section>
            <h3>Pull quotes</h3>
            {movie.quotes.length === 0 ? (
              <p class="meta">None yet. Add one from an episode’s transcript editor (Pull quote on a line).</p>
            ) : (
              <ul class="quote-list">
                {movie.quotes.map((quote, index) => {
                  const removed = draft.removed.includes(index);
                  return (
                    <li class={removed ? 'is-deleted' : ''}>
                      <a href={`/episodes/${quote.episode}/?t=${Math.floor(quote.start)}`}>
                        {quote.episode} · {clock(quote.start)}
                        {quote.end !== undefined && `–${clock(quote.end)}`}
                      </a>
                      <button
                        type="button"
                        class="linkish"
                        onClick={() =>
                          setDraft((d) => d && { ...d, removed: removed ? d.removed.filter((i) => i !== index) : [...d.removed, index] })
                        }
                      >
                        {removed ? 'Undo remove' : 'Remove'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </dialog>
  );
}
