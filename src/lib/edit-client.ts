// Browser side of the hosts-only editing API.

export async function editApi<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/edit/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${response.status})`);
  return data as T;
}

export type EditSetup = { editing: boolean; tmdb: boolean; branch: string };

export const setupWarning = (setup: EditSetup | null) =>
  setup && !setup.editing ? 'Saving isn’t switched on yet: the site needs its GITHUB_TOKEN secret (see docs/site-editing.md).' : '';

/** What hosts see after a save: edits go live when the site rebuilds from the new commit. */
export const liveSoon = (setup: EditSetup | null) =>
  setup && setup.branch !== 'main' ? `Saved to the ${setup.branch} branch (test mode).` : 'Saved. It’s live in about 2 minutes, once the site rebuilds.';

export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export type MovieOption = { slug: string; title: string; year?: number; tmdbId?: number };
