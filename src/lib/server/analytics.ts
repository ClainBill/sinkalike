// Anonymous interaction events, stored in Workers Analytics Engine (no cookies, IPs or user ids).
// Page views and visitors also show up in Cloudflare Web Analytics; these add what that can't
// see: plays, listening depth, outbound clicks, searches, comments and votes.
import { env } from 'cloudflare:workers';

/** Events the browser may send to /api/event. */
export const CLIENT_EVENTS = ['view', 'play', 'listen', 'outbound', 'search', 'copy_code'] as const;
/** Events recorded by the server itself. */
export type ServerEvent = 'comment' | 'vote';
export type EventName = (typeof CLIENT_EVENTS)[number] | ServerEvent;

export type EventFields = {
  /** Page the event happened on. */
  path?: string;
  /** What it was about: episode slug, link destination, search text, thread… */
  label?: string;
  /** Referring site (page views only). */
  ref?: string;
  /** Listening milestone (25/50/75/100). */
  value?: number;
};

const BOT = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit/i;
const clip = (value: unknown, max: number) => String(value ?? '').slice(0, max);

// Column layout in the dataset; the stats queries below rely on it.
//   blob1 event · blob2 path · blob3 label · blob4 referrer · blob5 country · blob6 device · double1 value
export function record(event: EventName, fields: EventFields, request: Request) {
  const agent = request.headers.get('user-agent') ?? '';
  if (BOT.test(agent)) return;
  try {
    env.EVENTS?.writeDataPoint({
      indexes: [event],
      blobs: [
        event,
        clip(fields.path, 200),
        clip(fields.label, 200),
        clip(fields.ref, 100),
        request.headers.get('cf-ipcountry') ?? '',
        /Mobi|Android|iPhone|iPad/.test(agent) ? 'mobile' : 'desktop',
      ],
      doubles: [Number.isFinite(fields.value) ? Number(fields.value) : 0],
    });
  } catch {
    /* analytics must never break the request */
  }
}

/** Path of the page that made this request, for events recorded server-side. */
export function refererPath(request: Request): string {
  try {
    return new URL(request.headers.get('referer') ?? '').pathname;
  } catch {
    return '';
  }
}

type Row = { event: string; path: string; label: string; value: number; n: number };
type ViewRow = { ref: string; country: string; device: string; n: number };

export type Stats = {
  totals: Record<string, number>;
  pages: [string, number][];
  plays: { slug: string; plays: number; milestones: Record<number, number> }[];
  outbound: [string, number][];
  searches: [string, number][];
  referrers: [string, number][];
  countries: [string, number][];
  devices: [string, number][];
};

const DATASET = 'events.analyticsEngine.sinkalike_events';

const ranked = (map: Map<string, number>, limit = 25): [string, number][] =>
  [...map].sort((a, b) => b[1] - a[1]).slice(0, limit);

const bump = (map: Map<string, number>, key: string, n: number) => map.set(key, (map.get(key) ?? 0) + n);

/** Everything /admin/stats/ shows, for the last `days` days. Counts are sample-weighted. */
export async function loadStats(days: number): Promise<Stats> {
  const start = new Date(Date.now() - days * 86_400_000).toISOString();
  const [events, views] = await Promise.all([
    env.ANALYTICS_SQL.query<Row>({
      query: `SELECT blob1 AS event, blob2 AS path, blob3 AS label, double1 AS value, COUNT(*) AS n
                FROM ${DATASET}
               WHERE timestamp >= $start
               GROUP BY blob1, blob2, blob3, double1
               ORDER BY n DESC
               LIMIT 5000`,
      params: { start },
    }),
    env.ANALYTICS_SQL.query<ViewRow>({
      query: `SELECT blob4 AS ref, blob5 AS country, blob6 AS device, COUNT(*) AS n
                FROM ${DATASET}
               WHERE timestamp >= $start AND blob1 = 'view'
               GROUP BY blob4, blob5, blob6
               ORDER BY n DESC
               LIMIT 5000`,
      params: { start },
    }),
  ]);

  const totals: Record<string, number> = {};
  const pages = new Map<string, number>();
  const outbound = new Map<string, number>();
  const searches = new Map<string, number>();
  const plays = new Map<string, { slug: string; plays: number; milestones: Record<number, number> }>();
  const episode = (slug: string) => {
    if (!plays.has(slug)) plays.set(slug, { slug, plays: 0, milestones: {} });
    return plays.get(slug)!;
  };

  for (const row of events.data) {
    const n = Math.round(Number(row.n));
    totals[row.event] = (totals[row.event] ?? 0) + n;
    if (row.event === 'view') bump(pages, row.path, n);
    else if (row.event === 'outbound') bump(outbound, row.label, n);
    else if (row.event === 'search') bump(searches, row.label, n);
    else if (row.event === 'play') episode(row.label).plays += n;
    else if (row.event === 'listen') {
      const entry = episode(row.label);
      entry.milestones[row.value] = (entry.milestones[row.value] ?? 0) + n;
    }
  }

  const referrers = new Map<string, number>();
  const countries = new Map<string, number>();
  const devices = new Map<string, number>();
  for (const row of views.data) {
    const n = Math.round(Number(row.n));
    if (row.ref) bump(referrers, row.ref, n);
    bump(countries, row.country || 'Unknown', n);
    bump(devices, row.device, n);
  }

  return {
    totals,
    pages: ranked(pages, 40),
    plays: [...plays.values()].sort((a, b) => b.plays - a.plays),
    outbound: ranked(outbound),
    searches: ranked(searches),
    referrers: ranked(referrers),
    countries: ranked(countries, 15),
    devices: ranked(devices),
  };
}
