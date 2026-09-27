// Cloudflare Turnstile (invisible spam check) for anonymous comments, votes and login codes.
import { useEffect, useRef, useState } from 'preact/hooks';
import { turnstileSiteKey } from '../site.config';

type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loader: Promise<TurnstileApi> | undefined;

function load(): Promise<TurnstileApi> {
  return (loader ??= new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => resolve(window.turnstile!);
    script.onerror = () => {
      loader = undefined;
      reject(new Error('Spam check failed to load'));
    };
    document.head.append(script);
  }));
}

/**
 * Renders a Turnstile widget into the returned ref when `enabled`.
 * Tokens are single-use: call reset() after each submit.
 */
export function useTurnstile(enabled: boolean) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string>();
  const [token, setToken] = useState('');

  useEffect(() => {
    if (!enabled || !container.current) return;
    let cancelled = false;
    load()
      .then((api) => {
        if (cancelled || !container.current) return;
        widget.current = api.render(container.current, {
          sitekey: turnstileSiteKey,
          appearance: 'interaction-only',
          callback: (value: string) => setToken(value),
          'expired-callback': () => setToken(''),
          'error-callback': () => setToken(''),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = undefined;
    };
  }, [enabled]);

  const reset = () => {
    setToken('');
    if (widget.current) window.turnstile?.reset(widget.current);
  };

  return { container, token, reset };
}
