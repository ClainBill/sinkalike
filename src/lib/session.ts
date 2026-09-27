// Client-side view of the signed-in user, shared by islands.
import { signal } from '@preact/signals';

export type SessionUser = { id: string; name: string; image?: string | null; isAdmin: boolean };

export const user = signal<SessionUser | null | undefined>(undefined);

let loading: Promise<SessionUser | null> | undefined;

export function loadUser(force = false): Promise<SessionUser | null> {
  if (loading && !force) return loading;
  loading = fetch('/api/me', { credentials: 'same-origin' })
    .then((response) => (response.ok ? response.json() : { user: null }))
    .then((data: { user: SessionUser | null }) => (user.value = data.user))
    .catch(() => (user.value = null));
  return loading;
}
