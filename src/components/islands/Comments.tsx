import { useEffect, useMemo, useState } from 'preact/hooks';
import { user, loadUser } from '../../lib/session';
import { useTurnstile } from '../../lib/turnstile';
import { initials, relative } from '../../lib/format';

type Comment = {
  id: string;
  parentId: string | null;
  body: string;
  status: 'visible' | 'pending' | 'hidden';
  createdAt: number;
  edited: boolean;
  likes: number;
  liked: boolean;
  mine: boolean;
  author: { name: string; image: string | null; host: boolean; anonymous: boolean };
};

const NAME_KEY = 'sa:comment-name';

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? 'Something went wrong. Please try again.');
  return data as T;
}

function Composer({
  thread,
  parentId,
  onPosted,
  onCancel,
  autoFocus,
}: {
  thread: string;
  parentId?: string;
  onPosted: (status: string) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const me = user.value;
  const [body, setBody] = useState('');
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(NAME_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const turnstile = useTurnstile(me === null && body.trim().length > 0);
  const next = typeof location !== 'undefined' ? encodeURIComponent(location.pathname + '#comments') : '';

  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<{ status: string }>('/api/comments', {
        method: 'POST',
        body: JSON.stringify({ thread, parentId, body, name, token: turnstile.token }),
      });
      try {
        if (name) localStorage.setItem(NAME_KEY, name);
      } catch {
        /* ignore */
      }
      setBody('');
      turnstile.reset();
      onPosted(result.status);
    } catch (e) {
      setError((e as Error).message);
      turnstile.reset();
    } finally {
      setBusy(false);
    }
  };

  const waitingForCheck = me === null && !turnstile.token;

  return (
    <form class="composer" onSubmit={submit}>
      <label class="sr-only" for={`c-${thread}-${parentId ?? 'root'}`}>
        {parentId ? 'Write a reply' : 'Write a comment'}
      </label>
      <textarea
        id={`c-${thread}-${parentId ?? 'root'}`}
        class="input"
        rows={parentId ? 2 : 3}
        maxLength={2000}
        placeholder={parentId ? 'Write a reply…' : 'What did you think?'}
        value={body}
        onInput={(e) => setBody(e.currentTarget.value)}
        autoFocus={autoFocus}
        required
      />
      {me === null && (
        <div class="composer-anon">
          <label class="sr-only" for={`n-${thread}-${parentId ?? 'root'}`}>
            Display name (optional)
          </label>
          <input
            id={`n-${thread}-${parentId ?? 'root'}`}
            class="input"
            maxLength={40}
            placeholder="Name (optional)"
            value={name}
            onInput={(e) => setName(e.currentTarget.value)}
            autocomplete="nickname"
          />
          <span class="meta">
            Posting anonymously, or <a href={`/login/?next=${next}`}>sign in</a>
          </span>
        </div>
      )}
      {me && <p class="meta">Commenting as <strong>{me.name || 'Listener'}</strong></p>}
      <div ref={turnstile.container} />
      <div class="composer-actions">
        <button class="btn btn-primary btn-small" type="submit" disabled={busy || !body.trim() || waitingForCheck}>
          {busy ? 'Posting…' : body.trim() && waitingForCheck ? 'Checking…' : parentId ? 'Reply' : 'Post comment'}
        </button>
        {onCancel && (
          <button class="btn btn-small" type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function CommentItem({
  comment,
  thread,
  canModerate,
  replies,
  onChange,
  isReply,
}: {
  comment: Comment;
  thread: string;
  canModerate: boolean;
  replies: Comment[];
  onChange: (notice?: string) => void;
  isReply?: boolean;
}) {
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [likes, setLikes] = useState({ count: comment.likes, liked: comment.liked });
  const [error, setError] = useState('');
  // Two-click delete instead of a blocking confirm() dialog.
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const act = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const like = async () => {
    try {
      const result = await api<{ liked: boolean; likes: number }>(`/api/comments/${comment.id}/like`, { method: 'POST' });
      setLikes({ count: result.likes, liked: result.liked });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <li class={`comment ${comment.status !== 'visible' ? 'is-' + comment.status : ''}`} id={`comment-${comment.id}`}>
      <div class="comment-avatar" aria-hidden="true">
        {comment.author.image ? <img src={comment.author.image} alt="" width={36} height={36} /> : initials(comment.author.name)}
      </div>
      <div class="comment-main">
        <p class="comment-head">
          <strong>{comment.author.name}</strong>
          {comment.author.host && <span class="badge">Host</span>}
          {comment.author.anonymous && <span class="meta">anonymous</span>}
          <span class="meta">
            · <time dateTime={new Date(comment.createdAt).toISOString()}>{relative(comment.createdAt)}</time>
            {comment.edited && ' · edited'}
          </span>
          {comment.status === 'pending' && <span class="badge badge-warn">Awaiting approval</span>}
          {comment.status === 'hidden' && <span class="badge badge-warn">Hidden</span>}
        </p>
        {editing ? (
          <form
            class="composer"
            onSubmit={(e) => {
              e.preventDefault();
              act(() => api(`/api/comments/${comment.id}`, { method: 'PATCH', body: JSON.stringify({ body: draft }) }));
              setEditing(false);
            }}
          >
            <textarea class="input" value={draft} maxLength={2000} onInput={(e) => setDraft(e.currentTarget.value)} />
            <div class="composer-actions">
              <button class="btn btn-primary btn-small" type="submit">
                Save
              </button>
              <button class="btn btn-small" type="button" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <p class="comment-body">{comment.body}</p>
        )}
        <div class="comment-actions">
          <button
            type="button"
            class={`linkish ${likes.liked ? 'is-liked' : ''}`}
            aria-pressed={likes.liked}
            onClick={like}
            disabled={comment.status !== 'visible'}
          >
            {likes.liked ? '♥' : '♡'} {likes.count > 0 ? likes.count : 'Like'}
          </button>
          {!isReply && comment.status === 'visible' && (
            <button type="button" class="linkish" onClick={() => setReplying(!replying)}>
              Reply
            </button>
          )}
          {comment.mine && !editing && (
            <button type="button" class="linkish" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          {(comment.mine || canModerate) && (
            <button
              type="button"
              class="linkish"
              onClick={() => (confirming ? act(() => api(`/api/comments/${comment.id}`, { method: 'DELETE' })) : setConfirming(true))}
            >
              {confirming ? 'Really delete?' : 'Delete'}
            </button>
          )}
          {canModerate && comment.status !== 'visible' && (
            <button
              type="button"
              class="linkish"
              onClick={() => act(() => api(`/api/comments/${comment.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'visible' }) }))}
            >
              Approve
            </button>
          )}
          {canModerate && comment.status === 'visible' && (
            <button
              type="button"
              class="linkish"
              onClick={() => act(() => api(`/api/comments/${comment.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'hidden' }) }))}
            >
              Hide
            </button>
          )}
        </div>
        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}
        {replying && (
          <Composer
            thread={thread}
            parentId={comment.id}
            autoFocus
            onCancel={() => setReplying(false)}
            onPosted={(status) => {
              setReplying(false);
              onChange(status === 'pending' ? 'Thanks! Your reply will appear once a host approves it.' : undefined);
            }}
          />
        )}
        {replies.length > 0 && (
          <ol class="comment-replies">
            {replies.map((reply) => (
              <CommentItem key={reply.id} comment={reply} thread={thread} canModerate={canModerate} replies={[]} onChange={onChange} isReply />
            ))}
          </ol>
        )}
      </div>
    </li>
  );
}

export default function Comments({ thread }: { thread: string }) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [canModerate, setCanModerate] = useState(false);
  const [sort, setSort] = useState<'newest' | 'top'>('newest');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = (message?: string) => {
    if (message !== undefined) setNotice(message);
    return api<{ comments: Comment[]; canModerate: boolean }>(`/api/comments?thread=${encodeURIComponent(thread)}`)
      .then((data) => {
        setComments(data.comments);
        setCanModerate(data.canModerate);
        setError('');
      })
      .catch(() => setError('Comments couldn’t load right now.'));
  };

  useEffect(() => {
    loadUser();
    refresh();
  }, [thread]);

  const { top, repliesOf } = useMemo(() => {
    const list = comments ?? [];
    const topLevel = list.filter((c) => !c.parentId);
    const sorted =
      sort === 'top' ? [...topLevel].sort((a, b) => b.likes - a.likes || b.createdAt - a.createdAt) : [...topLevel].sort((a, b) => b.createdAt - a.createdAt);
    const byParent = new Map<string, Comment[]>();
    for (const c of list) if (c.parentId) byParent.set(c.parentId, [...(byParent.get(c.parentId) ?? []), c]);
    return { top: sorted, repliesOf: (id: string) => byParent.get(id) ?? [] };
  }, [comments, sort]);

  const count = comments?.filter((c) => c.status === 'visible').length ?? 0;

  return (
    <section class="comments" id="comments" aria-labelledby={`comments-${thread}`}>
      <div class="comments-head">
        <h2 id={`comments-${thread}`}>
          Comments{comments && count > 0 && <span class="meta"> {count}</span>}
        </h2>
        {top.length > 1 && (
          <div class="comments-sort" role="group" aria-label="Sort comments">
            <button type="button" class="btn btn-small" aria-pressed={sort === 'newest'} onClick={() => setSort('newest')}>
              Newest
            </button>
            <button type="button" class="btn btn-small" aria-pressed={sort === 'top'} onClick={() => setSort('top')}>
              Top
            </button>
          </div>
        )}
      </div>

      {user.value !== undefined && (
        <Composer
          thread={thread}
          onPosted={(status) => refresh(status === 'pending' ? 'Thanks! Comments with links appear once a host approves them.' : '')}
        />
      )}
      {notice && (
        <p class="meta notice" role="status">
          {notice}
        </p>
      )}
      {error && <p class="error">{error}</p>}
      {comments === null && !error && <p class="meta">Loading comments…</p>}
      {comments && top.length === 0 && <p class="muted">No comments yet. Start the conversation.</p>}

      <ol class="comment-list">
        {top.map((comment) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            thread={thread}
            canModerate={canModerate}
            replies={repliesOf(comment.id).sort((a, b) => a.createdAt - b.createdAt)}
            onChange={(message) => refresh(message)}
          />
        ))}
      </ol>
    </section>
  );
}
