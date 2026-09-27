/** 75 -> "1:15", 3725 -> "1:02:05" */
export function timestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** 2581 -> "43 min", 4000 -> "1 hr 7 min" */
export function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

export function date(value: Date | string, style: 'long' | 'short' = 'long'): string {
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: style === 'long' ? 'long' : 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function relative(epochMs: number, now = Date.now()): string {
  const diff = Math.round((now - epochMs) / 1000);
  if (diff < 60) return 'just now';
  const units: [number, string][] = [
    [60, 'minute'],
    [3600, 'hour'],
    [86400, 'day'],
    [604800, 'week'],
  ];
  if (diff < 2592000) {
    const [size, unit] = [...units].reverse().find(([size]) => diff >= size)!;
    const value = Math.floor(diff / size);
    return `${value} ${unit}${value === 1 ? '' : 's'} ago`;
  }
  return date(new Date(epochMs), 'short');
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, '’')
    .replace(/\s+/g, ' ')
    .trim();
}
