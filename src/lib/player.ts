// Shared audio player state. The <Player> island owns the <audio> element; everything
// else (transcripts, quote search, play buttons) talks to it through this module.
import { signal } from '@preact/signals';
import type { PlayableEpisode } from './content';

export type { PlayableEpisode };

export const current = signal<PlayableEpisode | null>(null);
export const time = signal(0);
export const playing = signal(false);

type Command = { episode: PlayableEpisode; at?: number; autoplay: boolean };
let handler: ((command: Command) => void) | null = null;
let pending: Command | null = null;

/** Called once by the Player island. Commands issued before it mounts are replayed. */
export function registerPlayer(fn: (command: Command) => void) {
  handler = fn;
  if (pending) fn(pending);
  pending = null;
}

function send(command: Command) {
  if (handler) handler(command);
  else pending = command;
}

/** Start (or resume, or jump within) an episode. */
export function play(episode: PlayableEpisode, at?: number) {
  send({ episode, at, autoplay: true });
}

/** Load an episode at a position without starting playback (e.g. ?t= links). */
export function cue(episode: PlayableEpisode, at: number) {
  send({ episode, at, autoplay: false });
}

export let toggle: () => void = () => {};
export function registerToggle(fn: () => void) {
  toggle = fn;
}

const PROGRESS_KEY = 'sa:progress';

export function savedProgress(slug: string): number {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}')[slug] ?? 0;
  } catch {
    return 0;
  }
}

export function saveProgress(slug: string, seconds: number) {
  try {
    const all = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}');
    all[slug] = Math.floor(seconds);
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: resume just won't work */
  }
}

/**
 * Markup-driven play buttons, so static Astro pages need no island per button:
 *   <div data-episode='{"slug":…}'> … <button data-play>…</button> <button data-play="612.4">…</button> </div>
 * A button's own data-episode wins over an ancestor's.
 */
export function installPlayDelegation() {
  document.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest<HTMLElement>('[data-play]');
    if (!button) return;
    const host = button.closest<HTMLElement>('[data-episode]');
    if (!host?.dataset.episode) return;
    event.preventDefault();
    const episode = JSON.parse(host.dataset.episode) as PlayableEpisode;
    const at = button.dataset.play ? Number(button.dataset.play) : undefined;
    const isCurrent = current.value?.slug === episode.slug;
    if (isCurrent && at === undefined) toggle();
    else play(episode, at);
  });
}
