// "Edit" buttons that only hosts see. Visitors download just this small shell; the editors
// themselves load when a host opens one.
import { useEffect, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import { loadUser, user } from '../../lib/session';
import type { MovieOption } from '../../lib/edit-client';

type Props =
  | { kind: 'transcript'; episode: string; movies: MovieOption[]; about: string[] }
  | { kind: 'movie'; slug: string; title: string };

export default function HostEdit(props: Props) {
  const [Editor, setEditor] = useState<ComponentType<any> | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    loadUser();
  }, []);

  if (!user.value?.isAdmin) return null;

  const start = async () => {
    if (!Editor) {
      const module = props.kind === 'transcript' ? await import('./TranscriptEditor') : await import('./MovieEditor');
      setEditor(() => module.default);
    }
    setOpen(true);
  };

  return (
    <>
      <button type="button" class="btn btn-small host-edit-button" onClick={start}>
        ✎ {props.kind === 'transcript' ? 'Edit transcript' : 'Edit movie page'}
      </button>
      {Editor && open && <Editor {...props} onClose={() => setOpen(false)} />}
    </>
  );
}
