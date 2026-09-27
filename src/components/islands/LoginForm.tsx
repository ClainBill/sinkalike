import { useState } from 'preact/hooks';
import { auth, safeNext } from '../../lib/auth-client';
import { useTurnstile } from '../../lib/turnstile';

type Methods = { google: boolean; email: boolean; phone: boolean };
type Mode = 'email' | 'phone';

/** "+44 7700 900123" / "07700900123" → E.164 (assumes UK when there's no country code). */
function normalisePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('0')) return `+44${digits.slice(1)}`;
  return `+${digits}`;
}

export default function LoginForm({ methods, next: nextRaw, dev }: { methods: Methods; next: string | null; dev: boolean }) {
  const next = safeNext(nextRaw);
  const [mode, setMode] = useState<Mode>(methods.email ? 'email' : 'phone');
  const [identifier, setIdentifier] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const turnstile = useTurnstile(!sentTo && identifier.length > 3);

  const target = mode === 'phone' ? normalisePhone(identifier) : identifier.trim().toLowerCase();

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

  const sendCode = (event: Event) => {
    event.preventDefault();
    run(async () => {
      const headers = { 'x-captcha-response': turnstile.token };
      try {
        if (mode === 'email') await auth('/email-otp/send-verification-otp', { email: target, type: 'sign-in' }, headers);
        else await auth('/phone-number/send-otp', { phoneNumber: target }, headers);
        setSentTo(target);
      } finally {
        turnstile.reset();
      }
    });
  };

  const verify = (event: Event) => {
    event.preventDefault();
    run(async () => {
      if (mode === 'email') await auth('/sign-in/email-otp', { email: sentTo, otp: code.trim() });
      else await auth('/phone-number/verify', { phoneNumber: sentTo, code: code.trim() });
      location.href = next;
    });
  };

  const google = () =>
    run(async () => {
      const result = await auth<{ url?: string }>('/sign-in/social', { provider: 'google', callbackURL: next });
      if (result.url) location.href = result.url;
    });

  if (sentTo) {
    return (
      <form class="login card" onSubmit={verify}>
        <h2>Check your {mode === 'email' ? 'inbox' : 'messages'}</h2>
        <p class="muted">
          We sent a 6-digit code to <strong>{sentTo}</strong>.
          {dev && ' (Local dev: the code is printed in the terminal running the dev server.)'}
        </p>
        <div class="field">
          <label for="code">Code</label>
          <input
            id="code"
            class="input code-input"
            inputMode="numeric"
            autocomplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onInput={(e) => setCode(e.currentTarget.value.replace(/\D/g, ''))}
            autoFocus
            required
          />
        </div>
        <button class="btn btn-primary" type="submit" disabled={busy || code.length !== 6}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>
        <button type="button" class="linkish meta" onClick={() => (setSentTo(''), setCode(''), setError(''))}>
          Use a different {mode === 'email' ? 'email' : 'number'}
        </button>
        {error && <p class="error" role="alert">{error}</p>}
      </form>
    );
  }

  return (
    <div class="login card">
      {methods.google && (
        <>
          <button type="button" class="btn google" onClick={google} disabled={busy}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.6 12.3c0-.8-.1-1.5-.2-2.3H12v4.3h5.9a5 5 0 0 1-2.2 3.3v2.8h3.6c2.1-1.9 3.3-4.8 3.3-8.1Z" />
              <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.9A11 11 0 0 0 12 23Z" />
              <path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7H2.1a11 11 0 0 0 0 10l3.7-2.9Z" />
              <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7l3.7 2.9C6.7 7.3 9.1 5.4 12 5.4Z" />
            </svg>
            Continue with Google
          </button>
          {(methods.email || methods.phone) && <p class="or meta">or get a code</p>}
        </>
      )}

      {methods.email && methods.phone && (
        <div class="tabs" role="tablist" aria-label="Sign in with">
          {(['email', 'phone'] as const).map((value) => (
            <button
              type="button"
              role="tab"
              aria-selected={mode === value}
              class="btn btn-small"
              onClick={() => (setMode(value), setIdentifier(''), setError(''))}
            >
              {value === 'email' ? 'Email' : 'Phone'}
            </button>
          ))}
        </div>
      )}

      {(methods.email || methods.phone) && (
        <form onSubmit={sendCode}>
          <div class="field">
            <label for="identifier">{mode === 'email' ? 'Email address' : 'Mobile number'}</label>
            <input
              id="identifier"
              class="input"
              type={mode === 'email' ? 'email' : 'tel'}
              autocomplete={mode === 'email' ? 'email' : 'tel'}
              placeholder={mode === 'email' ? 'you@example.com' : '+44 7700 900123'}
              value={identifier}
              onInput={(e) => setIdentifier(e.currentTarget.value)}
              required
            />
          </div>
          <div ref={turnstile.container} />
          <button class="btn btn-primary" type="submit" disabled={busy || !identifier || !turnstile.token}>
            {busy ? 'Sending…' : identifier && !turnstile.token ? 'Checking…' : `${mode === 'email' ? 'Email' : 'Text'} me a code`}
          </button>
        </form>
      )}

      {!methods.google && !methods.email && !methods.phone && <p class="muted">Sign-in isn’t set up yet.</p>}
      {error && <p class="error" role="alert">{error}</p>}
      <p class="meta fine-print">
        No password needed. You can still comment and vote without an account. <a href="/privacy/">Privacy</a>
      </p>
    </div>
  );
}
