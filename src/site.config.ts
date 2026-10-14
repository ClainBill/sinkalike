// Show-wide settings. Most day-to-day content lives in src/content/ instead.
// The wording (tagline, summary, email, sponsor copy) is in src/data/site.json, so hosts can
// edit it on the site; links and technical settings stay here.
import settings from './data/site.json';

export const site = {
  name: settings.name,
  url: import.meta.env.SITE ?? 'https://sink-alike.wcgill.com',
  tagline: settings.tagline,
  summary: settings.summary,
  feedUrl: 'https://anchor.fm/s/117c72e60/podcast/rss',
  email: settings.email,
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

/** Wording in src/data/site.json. Set `code` once there's a discount code: it shows a copy button everywhere. */
export const sponsor = {
  ...settings.sponsor,
  url: 'https://wordwizard.wcgill.com/?utm_source=sinkalike&utm_medium=podcast_site&utm_campaign=sponsor',
};

/**
 * Cloudflare Turnstile site key (public). Production uses the real widget (valid on
 * sink-alike.wcgill.com and sinkalike.com); local dev uses Cloudflare's always-pass test key.
 */
export const turnstileSiteKey: string = import.meta.env.PROD ? '0x4AAAAAAFE9S56ZdAMPFZit' : '1x00000000000000000000AA';

/** Movie pages get an automatic "who got it right?" poll when 2+ hosts have a verdict. */
export function autoPollOptions(verdictNames: string[]): string[] | undefined {
  return verdictNames.length >= 2 ? [...verdictNames.map((name) => `Team ${name}`), 'Somewhere in between'] : undefined;
}
