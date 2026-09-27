import { useEffect, useRef, useState } from 'preact/hooks';
import { effect } from '@preact/signals';
import {
  current,
  time,
  playing,
  registerPlayer,
  registerToggle,
  installPlayDelegation,
  savedProgress,
  saveProgress,
} from '../../lib/player';
import { timestamp } from '../../lib/format';

const RATES = [1, 1.25, 1.5, 1.75, 2, 0.75];

export default function Player() {
  const audio = useRef<HTMLAudioElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState('');
  const episode = current.value;

  useEffect(() => {
    const el = audio.current!;

    registerToggle(() => (el.paused ? el.play().catch(() => {}) : el.pause()));

    registerPlayer(({ episode: next, at, autoplay }) => {
      setError('');
      if (current.value?.slug !== next.slug) {
        if (current.value) saveProgress(current.value.slug, el.currentTime);
        current.value = next;
        setDuration(next.duration);
        el.src = next.src;
        el.currentTime = at ?? savedProgress(next.slug);
      } else if (at !== undefined) {
        el.currentTime = at;
      }
      time.value = el.currentTime;
      if (autoplay) el.play().catch(() => {});
    });

    installPlayDelegation();

    // Keep every visible play button in sync with what's playing.
    const syncButtons = () => {
      document.querySelectorAll<HTMLElement>('[data-play=""]').forEach((button) => {
        const host = button.closest<HTMLElement>('[data-episode]');
        const slug = host?.dataset.episode ? JSON.parse(host.dataset.episode).slug : null;
        const active = playing.value && slug === current.value?.slug;
        button.setAttribute('aria-pressed', String(active));
        const label = button.querySelector('.label');
        if (label && button.dataset.labelPlay) {
          label.textContent = active ? 'Pause' : button.dataset.labelPlay;
        }
      });
    };
    const stop = effect(syncButtons);
    document.addEventListener('astro:page-load', syncButtons);

    const onKey = (event: KeyboardEvent) => {
      if (!current.value || event.defaultPrevented) return;
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable], button, a')) return;
      if (event.code === 'Space') {
        event.preventDefault();
        el.paused ? el.play().catch(() => {}) : el.pause();
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      stop();
      document.removeEventListener('astro:page-load', syncButtons);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // Reserve space at the bottom of the page while the player is visible.
  useEffect(() => {
    const height = episode ? bar.current?.offsetHeight ?? 0 : 0;
    document.documentElement.style.setProperty('--player-h', `${height}px`);
  }, [episode]);

  // Lock-screen / headphone controls.
  useEffect(() => {
    if (!episode || !('mediaSession' in navigator)) return;
    const el = audio.current!;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: episode.title,
      artist: 'Sink Alike',
      album: `Episode ${episode.number}`,
      artwork: [{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
    navigator.mediaSession.setActionHandler('seekbackward', () => (el.currentTime -= 15));
    navigator.mediaSession.setActionHandler('seekforward', () => (el.currentTime += 30));
    navigator.mediaSession.setActionHandler('play', () => el.play());
    navigator.mediaSession.setActionHandler('pause', () => el.pause());
  }, [episode]);

  const el = audio.current;
  const position = time.value;
  const total = duration || episode?.duration || 0;

  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(next);
    if (el) el.playbackRate = next;
  };

  const close = () => {
    if (!el || !episode) return;
    saveProgress(episode.slug, el.currentTime);
    el.pause();
    el.removeAttribute('src');
    el.load();
    current.value = null;
  };

  return (
    <div class="player" ref={bar} hidden={!episode} role="region" aria-label="Audio player">
      <audio
        ref={audio}
        preload="metadata"
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          time.value = t;
          if (episode && Math.floor(t) % 5 === 0) saveProgress(episode.slug, t);
        }}
        onPlay={() => (playing.value = true)}
        onPause={() => (playing.value = false)}
        onEnded={() => {
          playing.value = false;
          if (episode) saveProgress(episode.slug, 0);
        }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onError={() => episode && setError('Couldn’t load the audio. Try again or listen on Spotify.')}
      />
      {episode && (
        <div class="player-inner wrap">
          <button
            class="player-toggle"
            onClick={() => (el?.paused ? el.play().catch(() => {}) : el?.pause())}
            aria-label={playing.value ? 'Pause' : 'Play'}
          >
            {playing.value ? (
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z" /></svg>
            )}
          </button>
          <div class="player-main">
            <a class="player-title" href={`/episodes/${episode.slug}/`}>
              <span class="player-num">Ep {episode.number}</span> {episode.title}
            </a>
            <div class="player-scrub">
              <span class="player-time">{timestamp(position)}</span>
              <input
                type="range"
                min={0}
                max={Math.max(1, Math.floor(total))}
                step={1}
                value={Math.floor(position)}
                aria-label="Seek"
                aria-valuetext={`${timestamp(position)} of ${timestamp(total)}`}
                style={{ '--pct': `${total ? (position / total) * 100 : 0}%` }}
                onInput={(e) => {
                  if (el) el.currentTime = Number(e.currentTarget.value);
                }}
              />
              <span class="player-time">{buffering ? '…' : `-${timestamp(Math.max(0, total - position))}`}</span>
            </div>
            {error && <p class="player-error" role="alert">{error}</p>}
          </div>
          <div class="player-actions">
            <button class="icon-btn" onClick={() => el && (el.currentTime -= 15)} aria-label="Back 15 seconds">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4" /><text x="12" y="15.5" font-size="7.5" text-anchor="middle" fill="currentColor" font-family="system-ui" font-weight="600">15</text></svg>
            </button>
            <button class="icon-btn" onClick={() => el && (el.currentTime += 30)} aria-label="Forward 30 seconds">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M20 12a8 8 0 1 1-2.5-5.8M20 4v4h-4" /><text x="12" y="15.5" font-size="7.5" text-anchor="middle" fill="currentColor" font-family="system-ui" font-weight="600">30</text></svg>
            </button>
            <button class="player-rate" onClick={cycleRate} aria-label={`Playback speed ${rate}×`}>
              {rate}×
            </button>
            <button class="icon-btn" onClick={close} aria-label="Close player">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
