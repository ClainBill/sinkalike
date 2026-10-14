// Anonymous interaction events (see src/lib/server/analytics.ts). Fire-and-forget: nothing
// here may throw or slow the page down.

type Event = 'view' | 'play' | 'listen' | 'outbound' | 'search' | 'copy_code';

export function track(event: Event, fields: { label?: string; value?: number; ref?: string } = {}) {
  try {
    const body = JSON.stringify({ event, path: location.pathname, ...fields });
    if (!navigator.sendBeacon?.('/api/event', new Blob([body], { type: 'application/json' }))) {
      fetch('/api/event', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(
        () => {},
      );
    }
  } catch {
    /* analytics is best-effort */
  }
}

/** Page views (including client-side navigations) and clicks on links to other sites. Call once. */
export function installTracking() {
  let first = true;
  document.addEventListener('astro:page-load', () => {
    // document.referrer only describes how the visitor arrived, so send it with the first view.
    let ref = '';
    if (first && document.referrer) {
      try {
        const host = new URL(document.referrer).host;
        if (host !== location.host) ref = host.replace(/^www\./, '');
      } catch {}
    }
    first = false;
    track('view', { ref });
  });

  const onClick = (event: MouseEvent) => {
    if (event.type === 'auxclick' && event.button !== 1) return;
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]');
    if (!link || !/^https?:$/.test(link.protocol) || link.host === location.host) return;
    track('outbound', { label: `${link.host.replace(/^www\./, '')}${link.pathname.replace(/\/$/, '')}` });
  };
  document.addEventListener('click', onClick, { capture: true });
  document.addEventListener('auxclick', onClick, { capture: true });
}
