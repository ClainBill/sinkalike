import type { APIRoute } from 'astro';
import { setBody, setField, setJsonPath, SLUG, TAKE_PLACEHOLDER } from '../../../lib/edit/content';
import type { EditKind } from '../../../lib/editable';
import { fail, readJson } from '../../../lib/server/community';
import { handle, host, saved } from '../../../lib/server/edit-api';
import { commitEdit, EditError, type FileChange, type Snapshot } from '../../../lib/server/github';
import { personNames, threadExists } from '../../../lib/server/registry';

export const prerender = false;

type Field = { kind: EditKind; required?: boolean; placeholder?: string };

const MOVIE: Record<string, Field> = {
  title: { kind: 'plain', required: true },
  year: { kind: 'number' },
  director: { kind: 'plain' },
  runtime: { kind: 'number' },
  synopsis: { kind: 'blocks' },
  genres: { kind: 'lines' },
  body: { kind: 'markdown', placeholder: TAKE_PLACEHOLDER },
};
const EPISODE: Record<string, Field> = {
  // Override what Spotify's RSS feed says, on the site only. Empty = use Spotify's again.
  title: { kind: 'plain' },
  description: { kind: 'blocks' },
  body: { kind: 'markdown', placeholder: '<!-- Optional extra show notes. The RSS description is shown above this automatically. -->' },
  'poll.question': { kind: 'plain' },
  'poll.options': { kind: 'lines' },
};
const PERSON: Record<string, Field> = {
  name: { kind: 'plain', required: true },
  short: { kind: 'plain', required: true },
  role: { kind: 'plain' },
  favorites: { kind: 'lines' },
  body: { kind: 'markdown' },
};
// Plain text: these also go into page titles and descriptions.
const SITE: Record<string, Field> = {
  name: { kind: 'plain', required: true },
  tagline: { kind: 'plain' },
  summary: { kind: 'plain' },
  email: { kind: 'plain', required: true },
  'sponsor.name': { kind: 'plain', required: true },
  'sponsor.pitch': { kind: 'plain' },
  'sponsor.short': { kind: 'plain' },
  'sponsor.platforms': { kind: 'plain' },
  'sponsor.code': { kind: 'plain' },
  'sponsor.codeDetails': { kind: 'plain' },
};

/** The edited text, cleaned up for its kind. undefined means "remove it". */
function clean(field: Field, raw: string): string | number | string[] | undefined {
  const text = raw.replace(/\r\n/g, '\n');
  let value: string | number | string[] | undefined;
  if (field.kind === 'number') {
    value = text.trim() === '' ? undefined : Number(text);
    if (typeof value === 'number' && !Number.isFinite(value)) throw new EditError('That needs to be a number.');
  } else if (field.kind === 'lines') {
    const items = text.split('\n').map((line) => line.trim()).filter(Boolean);
    value = items.length ? items : undefined;
  } else if (field.kind === 'plain' || field.kind === 'inline') {
    value = text.replace(/\s+/g, ' ').trim() || undefined;
  } else {
    value = text.trim() || undefined;
  }
  if (field.required && value === undefined) throw new EditError('This one can’t be empty.');
  return value;
}

async function editFile(repo: Snapshot, path: string, change: (text: string) => string): Promise<FileChange> {
  const text = await repo.read(path);
  if (text === null) throw new EditError('That page no longer exists.', 404);
  return { path, content: change(text) };
}

async function editJson(repo: Snapshot, path: string, keys: string[], value: string | undefined): Promise<FileChange> {
  const text = await repo.read(path);
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  return { path, content: `${JSON.stringify(setJsonPath(data, keys, value), null, 2)}\n` };
}

/** Works out which file and field a target like "movie:interstellar:synopsis" means. */
function resolve(target: string, raw: string) {
  const [type, ...rest] = target.split(':');
  if (type === 'copy') {
    const key = rest.join(':');
    if (!/^[a-z0-9][a-z0-9._-]{0,80}$/.test(key)) throw new EditError('Bad text key.');
    const value = raw.replace(/\r\n/g, '\n').trim();
    return { label: `page text "${key}"`, file: (repo: Snapshot) => editJson(repo, 'src/data/copy.json', [key], value || undefined) };
  }
  if (type === 'site') {
    const field = SITE[rest[0] ?? ''];
    if (!field) throw new EditError('That setting can’t be edited here.');
    const value = clean(field, raw) as string | undefined;
    return { label: `site ${rest[0]}`, file: (repo: Snapshot) => editJson(repo, 'src/data/site.json', rest[0].split('.'), value ?? '') };
  }

  const [slug, name] = rest;
  const fields = type === 'movie' ? MOVIE : type === 'episode' ? EPISODE : type === 'person' ? PERSON : null;
  // A host's verdict on a movie: verdicts.<host>.take / .rating
  const verdict = type === 'movie' && name?.match(/^verdicts\.([a-z0-9-]+)\.(take|rating)$/);
  if (verdict && !(verdict[1] in personNames)) throw new EditError('Unknown host', 404);
  const field: Field | undefined = verdict ? { kind: verdict[2] === 'rating' ? 'number' : 'plain' } : fields?.[name ?? ''];
  if (!fields || !field || !SLUG.test(slug ?? '')) throw new EditError('That text can’t be edited here.');
  if (type === 'episode' && !threadExists(`episode:${slug}`)) throw new EditError('Unknown episode', 404);
  if (type === 'person' && !(slug in personNames)) throw new EditError('Unknown host', 404);

  const value = clean(field, raw);
  if (name === 'poll.options' && (!Array.isArray(value) || value.length < 2 || value.length > 8)) {
    throw new EditError('A poll needs 2 to 8 options, one per line.');
  }
  if (verdict && verdict[2] === 'rating' && value !== undefined && !((value as number) >= 0 && (value as number) <= 10)) {
    throw new EditError('Ratings go from 0 to 10.');
  }
  const folder = type === 'movie' ? 'movies' : type === 'episode' ? 'episodes' : 'people';
  const path = `src/content/${folder}/${slug}.md`;
  return {
    label: `${slug} ${name}`,
    file: (repo: Snapshot) =>
      editFile(repo, path, (text) => {
        if (name === 'body') return setBody(text, (value as string | undefined) ?? '', field.placeholder);
        return setField(text, name.split('.'), value);
      }),
  };
}

/** Hosts only: { target, value } saves one piece of text (see lib/editable.ts for targets). */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const author = await host(context);
    if (author instanceof Response) return author;
    const input = await readJson<{ target?: string; value?: string }>(context.request);
    const target = String(input?.target ?? '');
    const raw = String(input?.value ?? '');
    if (raw.length > 20000) return fail('That’s too long.');

    const { label, file } = resolve(target, raw);
    const { sha } = await commitEdit(author, async (repo) => {
      const change = await file(repo);
      const current = await repo.read(change.path);
      if (current === change.content) return null;
      return { message: `Edit text: ${label}`, files: [change] };
    });
    return saved(sha);
  });
