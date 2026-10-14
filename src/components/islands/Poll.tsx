import { useEffect, useState } from 'preact/hooks';
import { user, loadUser } from '../../lib/session';
import { useTurnstile } from '../../lib/turnstile';

/** `edit`: data-edit attributes (lib/editable.ts) for the question and options, when hosts can edit them. */
type Props = { pollKey: string; question: string; options: string[]; edit?: { question: Record<string, string>; options: Record<string, string> } };
type Results = { counts: number[]; total: number; mine: number | null };

export default function Poll({ pollKey, question, options, edit }: Props) {
  const [results, setResults] = useState<Results | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [changing, setChanging] = useState(false);
  const signedIn = !!user.value;
  const needsCheck = !signedIn && results?.mine == null;
  const turnstile = useTurnstile(needsCheck && choice !== null);

  useEffect(() => {
    loadUser();
    fetch(`/api/polls?key=${encodeURIComponent(pollKey)}`)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then(setResults)
      .catch(() => setError('Poll unavailable right now.'));
  }, [pollKey]);

  const vote = async (event: Event) => {
    event.preventDefault();
    if (choice === null) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/polls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: pollKey, option: choice, token: turnstile.token }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Vote failed');
      setResults(data);
      setChanging(false);
    } catch (e) {
      setError((e as Error).message);
      turnstile.reset();
    } finally {
      setBusy(false);
    }
  };

  const showResults = results && results.mine !== null && !changing;

  return (
    <section class="poll card" aria-labelledby={`poll-${pollKey}`}>
      <p class="kicker">Poll</p>
      <h3 id={`poll-${pollKey}`} {...edit?.question}>
        {question}
      </h3>
      {showResults ? (
        <>
          <ul class="poll-results" {...edit?.options}>
            {options.map((option, i) => {
              const pct = results.total ? Math.round((results.counts[i] / results.total) * 100) : 0;
              return (
                <li class={results.mine === i ? 'is-mine' : ''}>
                  <span class="poll-bar" style={{ width: `${pct}%` }} />
                  <span class="poll-label">
                    {option}
                    {results.mine === i && <span class="sr-only"> (your vote)</span>}
                  </span>
                  <span class="poll-pct">{pct}%</span>
                </li>
              );
            })}
          </ul>
          <p class="meta">
            {results.total} vote{results.total === 1 ? '' : 's'} ·{' '}
            <button type="button" class="linkish" onClick={() => (setChanging(true), setChoice(results.mine))}>
              Change my vote
            </button>
          </p>
        </>
      ) : (
        <form onSubmit={vote}>
          <fieldset {...edit?.options}>
            <legend class="sr-only">{question}</legend>
            {options.map((option, i) => (
              <label class="poll-option">
                <input type="radio" name={pollKey} checked={choice === i} onChange={() => setChoice(i)} />
                <span>{option}</span>
              </label>
            ))}
          </fieldset>
          <div ref={turnstile.container} />
          <button class="btn btn-primary" type="submit" disabled={choice === null || busy || !results || (needsCheck && !turnstile.token)}>
            {busy ? 'Voting…' : needsCheck && choice !== null && !turnstile.token ? 'Checking…' : 'Vote'}
          </button>
          {results && results.total > 0 && <span class="meta"> {results.total} voted so far</span>}
        </form>
      )}
      {error && <p class="error" role="alert">{error}</p>}
    </section>
  );
}
