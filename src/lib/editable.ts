// Marks an element as editable from the site ("✎ Edit page" for hosts). Spread the result
// onto the element that shows the text:
//
//   <p {...editable('movie:interstellar:synopsis', data.synopsis, 'blocks')}>{data.synopsis}</p>
//
// Targets (saved by src/pages/api/edit/text.ts):
//   copy:<key>             page copy, overrides in src/data/copy.json (see Copy.astro)
//   site:<path>            show-wide wording in src/data/site.json, e.g. site:sponsor.pitch
//   movie:<slug>:<field>   title, year, director, runtime, synopsis, genres, body
//   episode:<slug>:<field> title, description (override Spotify's), body (show notes), poll.question, poll.options
//   person:<id>:<field>    name, short, role, favorites, body

import { htmlToText } from './markdown-lite';

/**
 * plain: one line of text. inline: one line with **bold**, *italic*, [links](url).
 * blocks: paragraphs. markdown: a full Markdown body. number. lines: a list, one per line.
 */
export type EditKind = 'plain' | 'inline' | 'blocks' | 'markdown' | 'number' | 'lines';

type Options = {
  /** What an empty value falls back to (page copy's default, Spotify's title). */
  fallback?: string;
  /** Shown in edit mode when the field is empty, e.g. "Add a director". The element is hidden otherwise. */
  placeholder?: string;
  /** For lists shown as text: how items are joined (default ", "). */
  join?: string;
  /** Text around a plain value, e.g. suffix " min" for a runtime. */
  prefix?: string;
  suffix?: string;
  /** Don't update the page in place after saving (e.g. poll options); it shows after the rebuild. */
  static?: boolean;
};

export function editable(target: string, source: string | number | string[] | null | undefined, kind: EditKind = 'plain', options: Options = {}) {
  const text = Array.isArray(source) ? source.join('\n') : source == null ? '' : String(source);
  return {
    'data-edit': target,
    'data-edit-kind': kind,
    'data-edit-src': text,
    ...(options.fallback !== undefined && { 'data-edit-default': options.fallback }),
    ...(options.placeholder && { 'data-edit-placeholder': options.placeholder }),
    ...(options.placeholder && !text.trim() && { 'data-edit-empty': '' }),
    ...(options.join && { 'data-edit-join': options.join }),
    ...(options.prefix && { 'data-edit-prefix': options.prefix }),
    ...(options.suffix && { 'data-edit-suffix': options.suffix }),
    ...(options.static && { 'data-edit-static': '' }),
  };
}

/** An episode's title (editable on the site; empty goes back to Spotify's). */
export const episodeTitle = (episode: { slug: string; title: string; spotifyTitle: string }) =>
  editable(`episode:${episode.slug}:title`, episode.title, 'plain', { fallback: episode.spotifyTitle });

/** An episode's description: the site's own wording if set, otherwise Spotify's (as text). */
export const episodeDescription = (episode: { slug: string; spotifyDescription: string; extras?: { data: { description?: string } } }) =>
  editable(`episode:${episode.slug}:description`, episode.extras?.data.description ?? htmlToText(episode.spotifyDescription), 'blocks', {
    fallback: htmlToText(episode.spotifyDescription),
  });
