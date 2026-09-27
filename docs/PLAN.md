# Sink Alike Website Plan

The site is the podcast's home: every episode, full transcripts, a movie archive, a quote search, host bios, comments and polls, and the Word Wizard sponsor spot. Audio stays on the existing podcast host. The site reads the host's RSS feed and plays the audio from there, so it never pays for audio bandwidth.

**Estimated cost: about £8–10 a year (just the domain).** Everything else fits in free tiers.

---

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Astro** (TypeScript) | Pages are static HTML by default and very fast. Content collections suit episodes, movies and people. JavaScript only loads for the interactive parts. |
| Interactive parts | **Preact** islands | Small (~4 KB). Used for the player, search, comments and polls. |
| Styling | Plain modern CSS with design tokens (custom properties) | A minimal design doesn't need a framework. |
| Hosting | **Cloudflare Pages / Workers** (free) | Unlimited bandwidth, and **commercial use is allowed**, which matters because you have a sponsor. |
| Database | **Cloudflare D1** (SQLite, free: 5M reads and 100k writes a day) | Stores comments, polls and accounts. Unlike Supabase's free tier, it never pauses when idle. |
| Auth | **Better Auth** on Workers + D1 | Supports Google and Discord login plus anonymous sessions. Free and self-contained. |
| Spam protection | **Cloudflare Turnstile** (free) | An invisible CAPTCHA on anonymous comments and votes. |
| Search | **MiniSearch** over a prebuilt transcript index | Returns results at the level of a single line, with a timestamp. No server needed. |
| Transcription | **WhisperX** (or mlx-whisper) run locally on a Mac | Free. Gives word-level timestamps and tells speakers apart. |
| Analytics | **Cloudflare Web Analytics** (free, no cookies) | No cookie banner needed. |
| Domain / email | **Cloudflare Registrar** + Email Routing | `sinkalike.com` was unregistered on 26 Sep 2026. Registrar charges cost price (~$10/yr), and addresses like `hello@sinkalike.com` forward to Gmail for free. |
| CI | GitHub + GitHub Actions (free) | Every push deploys automatically, and a daily job checks the RSS feed for new episodes. |

**Hosts ruled out:**
- **Vercel Hobby:** its terms forbid commercial use. A paid sponsor probably counts, which would mean Pro at $20/mo.
- **Netlify free:** the bandwidth and build-minute caps are tighter.
- **GitHub Pages:** it has no backend for comments or polls.

---

## 2. Design direction (independent of the placeholder logo)

- **Content first and typographic.** The look is closer to a small film magazine than a podcast template. It uses a serif display face for titles (e.g. *Instrument Serif* or *Fraunces*), a clean sans for body text (*Inter*), and generous whitespace.
- **Neutral base.** Off-white paper in light mode, near-black in dark mode, following the system setting with a toggle.
- **Color comes from two places.**
  1. **Movie posters**, which are the only large imagery.
  2. **One accent color per host** (e.g. Adam = warm, William = cool), used for speaker labels in transcripts, pull quotes, verdicts and poll bars. This carries the show's theme, "our opinions differ", into the design system. Guests get a neutral third color.
- **Persistent mini player.** It stays docked at the bottom while you browse, via Astro View Transitions `transition:persist`, so listeners can explore the movie pages mid-episode.
- The logo slots into the header as an image (an SVG wordmark in the meantime), so a new logo is a one-file swap.

---

## 3. Site map and features

| Route | What it contains | Feature from brief |
|---|---|---|
| `/` | Latest episode hero with a play button; the About tagline; "Listen on" buttons (Spotify, Apple, RSS…); recent episodes; a strip of movie posters; a random quote; the sponsor card | Homepage |
| `/episodes` | All episodes in date order (newest/oldest toggle), each with the participants' avatars, the movies covered, date and duration. Filters by host or guest. | Each episode chronologically with who participated |
| `/episodes/[slug]` | Player, show notes, participants, movies discussed, chapters, **full transcript** (click a line to seek; the current line highlights during playback), poll, comments, sponsor card | Full transcripts, comments, polls |
| `/movies` | A grid of posters for every movie discussed, sortable by title, year or episode. Each card has small badges for each host's verdict. | Thumbnails of every movie |
| `/movies/[slug]` | Poster and details; **"Our take" bio written by you**; each host's rating and one-line verdict side by side; **pull quotes** (transcript excerpts with ▶ play-from-here); episodes the movie appears in; an automatic "every other time we mentioned it" list; a listener poll ("Who's right?") | Movie bios and transcript pulls |
| `/quotes` | **Quote search**: type any phrase and get the matching lines with speaker, episode and timestamp, plus ▶ to play that moment. Filters by speaker and episode, with exact-phrase support. Result URLs are shareable (`/quotes?q=speed+racer`). | Dunkey-style quote searcher |
| `/about` | Group bio plus a card for each host (photo, bio, favorite films, hottest take, socials) | Bios |
| `/sponsor` (and a card on every page) | Word Wizard blurb, a **copy-to-clipboard discount code** button, a tracked link (UTM tags) | Sponsor |
| `/login`, `/account` | Sign in with Google or Discord; set a display name | Logged-in comments |

Deep links: `/episodes/002-speed-racer?t=1234` opens the episode and starts at that second. Quote search and pull quotes both use this.

---

## 4. Content model (files in the repo, validated with Zod)

```
src/content/
  episodes/001-speed-racer.md      # show notes in the body
  transcripts/001-speed-racer.json # [{ start, end, speaker, text }]
  movies/speed-racer.md            # "our take" bio in the body
  people/adam.md, william.md       # bios
```

**Episode frontmatter**
```yaml
number: 1
title: "Speed Racer: The greatest movie you've never heard of"
date: 2026-09-26
duration: 2581             # seconds
audioUrl: …                # from RSS enclosure
links: { spotify: …, apple: …, youtube: … }
participants: [adam, william]
guests: []
movies: [speed-racer]
chapters: [{ start: 0, title: Intro }, …]
poll: { question: "Is Speed Racer underrated?", options: [Yes, No, "What's Speed Racer?"] }
```

**Movie frontmatter**
```yaml
title: Speed Racer
year: 2008
director: The Wachowskis
poster: ./posters/speed-racer.jpg
tmdbId: 7459
verdicts:
  adam:    { rating: 9, take: "…" }
  william: { rating: 6, take: "…" }
quotes:                    # hand-picked pull quotes, pointing into transcripts
  - { episode: 001-speed-racer, start: 612.4 }
```

Movie metadata and posters are fetched once from the **TMDB API** by a script and saved into the repo. The site credits TMDB as its terms require. TMDB's free API is for non-commercial use, so check their terms now that you have a sponsor, or keep it to posters and credit them.

---

## 5. Transcript pipeline

1. **Best case:** if you record separate tracks per person (Riverside, Zencastr, Zoom "separate audio" etc.), transcribe each track separately. Every line is then attributed to the right speaker with no guessing.
2. Otherwise, run **WhisperX** with pyannote diarization, which needs a free Hugging Face token. On Apple Silicon, `mlx-whisper` is much faster for the transcription step.
3. `npm run transcribe -- 001` downloads the audio from RSS, transcribes it, and writes `transcripts/001-….json` plus `.vtt`/`.srt` files. You can upload those to Spotify, Apple or YouTube for accessibility too.
4. A quick manual pass fixes speaker names and misheard film titles. A small custom-vocabulary list of names and titles cuts down this cleanup.
5. At build time, all transcripts are compiled into a sharded search index (one small file per episode plus a manifest). The quote page loads only what it needs, so it stays fast at 100+ episodes.

---

## 6. Comments, accounts and polls (Cloudflare Workers + D1)

- **Anonymous comments:** an optional display name. Turnstile checks each post, rate limits apply per IP hash, and anonymous posts that contain links are held for approval.
- **Logged-in comments:** via Google or Discord through Better Auth. These get a stable name and avatar, the ability to edit or delete, and a "Host" badge for Adam and William.
- **Threads:** one level of replies, likes, and sorting by newest or top.
- **Moderation:** hosts are admins with hide, delete and ban controls and a small `/admin` queue. Email notifications for new comments can go through Cloudflare Email Routing or Resend's free tier.
- **Polls:** defined in episode or movie frontmatter, so no admin UI is needed. Votes are stored in D1, limited to one per account, or one per device cookie plus IP hash for anonymous voters. Results appear after voting, as bars in the host colors.
- **Show-themed options:** "Team Adam / Team William" on every movie page, and listener star ratings shown next to the hosts' ratings.

**D1 tables:** `users`, `sessions`, `comments(id, thread_key, parent_id, user_id, anon_name, body, status, created_at)`, `comment_likes`, `poll_votes(poll_key, option, voter_key)`.

Everything else is prerendered. Only `/api/*` and the account pages run as Workers.

---

## 7. Automation and your per-episode workflow

1. Publish the episode on your podcast host as usual.
2. A **GitHub Action** runs daily (or on demand), reads the RSS feed, and opens a PR with a new episode stub containing the title, date, duration, audio URL and description.
3. Locally: `npm run transcribe -- <n>`, then fix speakers, add the movie (`npm run add-movie -- "Speed Racer"` pulls from TMDB), and write "Our take", verdicts and pull quotes.
4. Merge the PR. Cloudflare rebuilds and deploys in about a minute.

---

## 8. Phased build

| Phase | Scope | Result |
|---|---|---|
| **0. Setup** | Register the domain; create GitHub and Cloudflare accounts; find the RSS URL; set up the Astro project, design tokens and layout; deploy a skeleton | Live placeholder at sinkalike.com |
| **1. MVP** | Home, episodes list and detail pages (built from RSS), About, sponsor card, "Listen on" links, SEO (Open Graph images, podcast JSON-LD, sitemap), analytics | Real homepage for the show |
| **2. Transcripts** | Transcription script, transcript view, persistent player, `?t=` deep links, chapters | Full transcripts |
| **3. Movies** | TMDB script, poster grid, movie pages, verdicts, pull quotes, automatic mentions | Movie archive |
| **4. Quote search** | Search index build and the `/quotes` UI with filters and shareable URLs | Quote searcher |
| **5. Community** | D1, Better Auth, Turnstile, comments, polls, moderation queue | Comments and polls |
| **6. Polish** | Accessibility pass (keyboard, contrast, transcript semantics), performance budget, 404 page, newsletter or "notify me" (optional, Buttondown free tier) | Launch-ready |

Phases 1–4 are all static and cost nothing to run. Phase 5 is the only part with a backend.

---

## 9. Needed from you before building

1. **Podcast host and RSS URL.** Is it Spotify for Creators? Its RSS link is under Settings → Availability.
2. Do you record **separate audio tracks** per person? This decides the transcript approach.
3. **Domain:** `sinkalike.com` (was available on 26 Sep 2026) or something else?
4. **Word Wizard** details: link, discount code, blurb, and any logo or brand rules.
5. **Login providers:** Google + Discord, or others?
6. Host photos, bios, and a first "Our take" for Speed Racer.
