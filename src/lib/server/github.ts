// Edits made on the site are saved as commits to the GitHub repo, which redeploys the site.
// The repo stays the single source of truth, so the scripts (find-movies, transcribe) and
// the build always see the same content. Needs the GITHUB_TOKEN secret: a fine-grained token
// with "Contents: read and write" on this repo only.
import { env } from 'cloudflare:workers';

// GITHUB_API_URL is only for testing against a stand-in API locally.
const API = (env as { GITHUB_API_URL?: string }).GITHUB_API_URL || 'https://api.github.com';

export class EditError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export type FileChange = { path: string; content: string | Uint8Array };
export type Author = { name: string; email: string };
/** The repo at one commit: read files as they are right now. */
export type Snapshot = { read: (path: string) => Promise<string | null> };

function settings() {
  if (!env.GITHUB_TOKEN) {
    throw new EditError('Saving from the site isn’t switched on yet: the GITHUB_TOKEN secret is missing (see docs/site-editing.md).', 503);
  }
  return { token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO || 'ClainBill/sinkalike', branch: env.GITHUB_BRANCH || 'main' };
}

export const editingEnabled = () => !!env.GITHUB_TOKEN;
export const editBranch = () => env.GITHUB_BRANCH || 'main';

async function github(path: string, init: RequestInit & { accept?: string } = {}) {
  const { token, repo } = settings();
  const response = await fetch(`${API}/repos/${repo}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: init.accept ?? 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'sinkalike-site-editor',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (response.status === 401 || response.status === 403) {
    throw new EditError('GitHub rejected the GITHUB_TOKEN secret (expired, or missing write access to the repo).', 502);
  }
  return response;
}

async function githubJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await github(path, init);
  if (!response.ok) throw new EditError(`GitHub ${response.status}: ${(await response.text()).slice(0, 200)}`, 502);
  return response.json() as Promise<T>;
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function headSha(branch: string): Promise<string> {
  const ref = await githubJson<{ object: { sha: string } }>(`/git/ref/heads/${encodeURIComponent(branch)}`);
  return ref.object.sha;
}

function snapshotAt(sha: string): Snapshot {
  return {
    async read(path) {
      const response = await github(`/contents/${encodePath(path)}?ref=${sha}`, { accept: 'application/vnd.github.raw+json' });
      if (response.status === 404) return null;
      if (!response.ok) throw new EditError(`GitHub ${response.status} reading ${path}`, 502);
      return response.text();
    },
  };
}

/** Reads one file at the tip of the edit branch. */
export async function readFile(path: string): Promise<string | null> {
  return snapshotAt(await headSha(settings().branch)).read(path);
}

/**
 * Reads the current files, lets `change` work out the new ones, and commits them in one
 * commit. If someone else pushed in between (the daily RSS sync, another host), it starts
 * again from their commit, so nothing is overwritten. `change` returns null for "no change".
 */
export async function commitEdit(
  author: Author,
  change: (repo: Snapshot) => Promise<{ files: FileChange[]; message: string } | null>,
): Promise<{ sha: string | null }> {
  const { branch } = settings();
  for (let attempt = 0; attempt < 3; attempt++) {
    const parent = await headSha(branch);
    const result = await change(snapshotAt(parent));
    if (!result || !result.files.length) return { sha: null };

    const tree = await Promise.all(
      result.files.map(async (file) => {
        if (typeof file.content === 'string') return { path: file.path, mode: '100644', type: 'blob', content: file.content };
        const blob = await githubJson<{ sha: string }>('/git/blobs', {
          method: 'POST',
          body: JSON.stringify({ content: base64(file.content), encoding: 'base64' }),
        });
        return { path: file.path, mode: '100644', type: 'blob', sha: blob.sha };
      }),
    );
    const parentCommit = await githubJson<{ tree: { sha: string } }>(`/git/commits/${parent}`);
    const newTree = await githubJson<{ sha: string }>('/git/trees', {
      method: 'POST',
      body: JSON.stringify({ base_tree: parentCommit.tree.sha, tree }),
    });
    const commit = await githubJson<{ sha: string }>('/git/commits', {
      method: 'POST',
      body: JSON.stringify({
        message: `${result.message}\n\nEdited on the site by ${author.name}.`,
        tree: newTree.sha,
        parents: [parent],
        author: { ...author, date: new Date().toISOString() },
      }),
    });
    const update = await github(`/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });
    if (update.ok) return { sha: commit.sha };
    if (update.status !== 422 && update.status !== 409) {
      throw new EditError(`GitHub ${update.status} updating ${branch}: ${(await update.text()).slice(0, 200)}`, 502);
    }
    // Someone pushed first: try again on top of their commit.
  }
  throw new EditError('The repo kept changing while saving. Try again in a moment.', 409);
}
