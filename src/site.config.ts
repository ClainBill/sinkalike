// Show-wide settings. Most day-to-day content lives in src/content/ instead.

export const site = {
  name: 'Sink Alike',
  url: import.meta.env.SITE ?? 'https://sink-alike.wcgill.com',
  tagline: 'We may not think alike, but we can always sink alike.',
  summary: 'A movie review and discussion podcast with Adam Estock and William Gill.',
  feedUrl: 'https://anchor.fm/s/117c72e60/podcast/rss',
  email: 'hello@sinkalike.com',
};

/** "Listen on" buttons. Leave a url empty to hide that button. */
export const listenOn: { label: string; url: string }[] = [
  { label: 'Spotify', url: 'https://creators.spotify.com/pod/profile/sink-alike3/' },
  { label: 'Apple Podcasts', url: '' },
  { label: 'YouTube', url: '' },
  { label: 'RSS', url: site.feedUrl },
];

/** Hosts' accent colors are defined in src/styles/global.css as --person-<id>. */
export const hosts = ['adam', 'william'] as const;

export const sponsor = {
  name: 'Word Wizard',
  url: 'https://wordwizard.wcgill.com/?utm_source=sinkalike&utm_medium=podcast_site&utm_campaign=sponsor',
  pitch: 'An offline, ad-free English dictionary of 740,000 entries, with a spaced-repetition trainer that asks about a word on exactly the day you were about to forget it.',
  short: 'The offline, ad-free dictionary that remembers the words you keep.',
  platforms: 'iOS & Android',
  /** Set once there's a discount code and it shows a copy button everywhere. */
  code: '' as string,
  codeDetails: '',
};

/**
 * Cloudflare Turnstile site key (public). Production uses the real widget (valid on
 * sink-alike.wcgill.com and sinkalike.com); local dev uses Cloudflare's always-pass test key.
 */
/**
 * Cloudflare Web Analytics token (public) for the "sink-alike.wcgill.com" site in the dashboard.
 * Visits and page views appear there; interaction events are on /admin/stats/. The token only
 * accepts beacons from that hostname, so moving to sinkalike.com needs a new site and token.
 */
export const webAnalyticsToken = 'b3c64e12105d4493a9495e8d43bd1940';

export const turnstileSiteKey: string = import.meta.env.PROD ? '0x4AAAAAAFE9S56ZdAMPFZit' : '1x00000000000000000000AA';

/** Movie pages get an automatic "who got it right?" poll when 2+ hosts have a verdict. */
export function autoPollOptions(verdictNames: string[]): string[] | undefined {
  return verdictNames.length >= 2 ? [...verdictNames.map((name) => `Team ${name}`), 'Somewhere in between'] : undefined;
}
