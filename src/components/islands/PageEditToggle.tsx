// "✎ Edit page" in the header, for hosts only. Turns on click-to-edit for every editable
// piece of text (lib/page-editor.ts, loaded on first use). Stays on across pages until Done.
import { useEffect, useState } from 'preact/hooks';
import { loadUser, user } from '../../lib/session';

const KEY = 'sa:editing';

async function apply(on: boolean) {
  const { setEditing } = await import('../../lib/page-editor');
  setEditing(on);
}

export default function PageEditToggle() {
  const [on, setOn] = useState(false);
  const admin = !!user.value?.isAdmin;

  useEffect(() => {
    loadUser();
    const stop = () => toggle(false);
    document.addEventListener('sa:stop-editing', stop);
    return () => document.removeEventListener('sa:stop-editing', stop);
  }, []);

  useEffect(() => {
    if (!admin) return;
    let saved = false;
    try {
      saved = sessionStorage.getItem(KEY) === '1';
    } catch {}
    if (saved) toggle(true);
  }, [admin]);

  function toggle(next: boolean) {
    setOn(next);
    try {
      if (next) sessionStorage.setItem(KEY, '1');
      else sessionStorage.removeItem(KEY);
    } catch {}
    apply(next);
  }

  if (!admin) return null;
  return (
    <button type="button" class={on ? 'btn btn-small btn-primary' : 'btn btn-small'} aria-pressed={on} onClick={() => toggle(!on)}>
      {on ? 'Done editing' : '✎ Edit page'}
    </button>
  );
}
