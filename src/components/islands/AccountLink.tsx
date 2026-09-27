import { useEffect } from 'preact/hooks';
import { user, loadUser } from '../../lib/session';
import { initials } from '../../lib/format';

export default function AccountLink() {
  useEffect(() => {
    loadUser();
  }, []);

  const me = user.value;
  if (!me) {
    return (
      <a class="btn btn-small" href="/login/">
        Sign in
      </a>
    );
  }
  return (
    <a class="account-link" href="/account/" aria-label={`Your account (${me.name || 'Listener'})`}>
      {me.image ? <img src={me.image} alt="" width={32} height={32} /> : <span>{initials(me.name || 'L')}</span>}
    </a>
  );
}
