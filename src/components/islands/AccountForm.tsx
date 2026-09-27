import { useState } from 'preact/hooks';
import { auth } from '../../lib/auth-client';
import { loadUser } from '../../lib/session';

type Props = { name: string; signInWith: string; isAdmin: boolean };

export default function AccountForm({ name: initialName, signInWith, isAdmin }: Props) {
  const [name, setName] = useState(initialName);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = (event: Event) => {
    event.preventDefault();
    run(async () => {
      await auth('/update-user', { name: name.trim().replace(/\s+/g, ' ').slice(0, 40) });
      await loadUser(true);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  return (
    <div class="account">
      <form class="card account-card" onSubmit={save}>
        <h2>Your name</h2>
        <p class="muted">This is shown next to your comments.</p>
        <div class="field">
          <label for="display-name">Display name</label>
          <input
            id="display-name"
            class="input"
            maxLength={40}
            value={name}
            onInput={(e) => setName(e.currentTarget.value)}
            placeholder="e.g. Racer X"
            required
          />
        </div>
        <button class="btn btn-primary" type="submit" disabled={busy || !name.trim()}>
          {saved ? 'Saved ✓' : 'Save'}
        </button>
      </form>

      <section class="card account-card">
        <h2>Account</h2>
        <p class="muted">Signed in with {signInWith}.</p>
        {isAdmin && (
          <p>
            You’re a host. <a href="/admin/">Moderate comments →</a>
          </p>
        )}
        <div class="account-actions">
          <button class="btn" type="button" disabled={busy} onClick={() =>
              run(async () => {
                await auth('/sign-out');
                location.href = '/';
              })
            }>
            Sign out
          </button>
          <button
            class="btn danger"
            type="button"
            disabled={busy}
            onClick={() =>
              confirmDelete
                ? run(async () => {
                    await auth('/delete-user', {});
                    location.href = '/';
                  })
                : setConfirmDelete(true)
            }
          >
            {confirmDelete ? 'Yes, delete my account and comments' : 'Delete account'}
          </button>
        </div>
      </section>
      {error && <p class="error" role="alert">{error}</p>}
    </div>
  );
}
