# Editing the site from the site

Hosts can change any text on sink-alike.wcgill.com from the site itself: page copy, movie details, episode titles, host bios, transcripts, tags and pull quotes. Sign in, and you'll see **✎ Edit** buttons that nobody else sees.

Every save becomes a commit to the GitHub repo, under your name. Cloudflare rebuilds the site from that commit, and the change is live in about 2 minutes. The repo stays the one copy of everything, so the scripts (`find-movies`, `transcribe`) and quote search always see your edits, and any edit can be undone with git.

## Setup (once, about 15 minutes)

Do these in order. Run the `wrangler` commands from the project folder (`/Volumes/WillemsWork/dev/Projects/SinkAlike`). If wrangler asks you to log in, run `npx wrangler login` first.

### 1. Connect auto-deploy (Cloudflare)

Without this, saves land in GitHub but the site doesn't change until someone runs `npm run deploy`.

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **sinkalike** → **Settings** → **Build**.
2. Under **Git repository**, click **Connect**. Pick **GitHub**, and let Cloudflare's GitHub app access `ClainBill/sinkalike` (just that repo is enough).
3. Fill in:
   - **Branch:** `main`
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy`
4. Save. Then open the **Deployments** tab: pushing anything to `main` (merging the editing pull request counts) should start a build there, and it goes live about a minute later.

The build needs no secrets: they stay on the Worker. From now on, every commit to `main` goes live, including the daily RSS sync and edits made on the site.

### 2. Switch on sign-in with Google

1. Open the [Google Cloud console](https://console.cloud.google.com/) and create a project called **Sink Alike** (top bar → project picker → **New project**).
2. Go to **APIs & Services → OAuth consent screen** (Google may call it **Google Auth Platform**) and click **Get started**:
   - App name **Sink Alike**, support email: yours.
   - Audience: **External**.
   - Finish, then under **Audience** click **Publish app**, so anyone can sign in (not just test users). Sign-in only asks for name and email, so Google doesn't need to review it.
3. Go to **Clients** (or **Credentials → Create credentials → OAuth client ID**):
   - Application type: **Web application**, name: **Sink Alike site**.
   - **Authorized JavaScript origins:** `https://sink-alike.wcgill.com`
   - **Authorized redirect URIs:**
     - `https://sink-alike.wcgill.com/api/auth/callback/google`
     - `http://localhost:4321/api/auth/callback/google` (for local development)
   - Create. Keep the window with the **Client ID** and **Client secret** open.
4. In Terminal, in the project folder:
   ```sh
   npx wrangler secret put GOOGLE_CLIENT_ID       # paste the Client ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET   # paste the Client secret
   ```
5. **Check:** open https://sink-alike.wcgill.com/login/. There's now a **Continue with Google** button. Sign in with willcharlesgill@gmail.com. Your account page should say **You’re a host**.

**Adam as a host:** add his sign-in email to `ADMINS` in `wrangler.jsonc` (comma-separated: `"willcharlesgill@gmail.com,adam@example.com"`) and deploy.

**Moving to sinkalike.com later:** add the same two lines with `https://sinkalike.com` to the Google client.

### 3. Let the site save to GitHub

1. On GitHub: your avatar → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Fill in:
   - **Token name:** Sink Alike site editor
   - **Expiration:** the longest offered. Put a reminder in your calendar a week before it runs out. When it does, saving shows an error until you repeat this step.
   - **Resource owner:** ClainBill
   - **Repository access:** **Only select repositories** → `ClainBill/sinkalike`
   - **Permissions → Repository permissions → Contents:** **Read and write**. Leave everything else as it is.
3. **Generate token** and copy it (GitHub only shows it once).
4. In Terminal, in the project folder:
   ```sh
   npx wrangler secret put GITHUB_TOKEN   # paste the token
   ```
5. **Check:** sign in on the site, open an episode, click **✎ Edit transcript**. The red “Saving isn’t switched on yet” message should be gone, and the Save button works.

The token can only touch this one repo, and only its files. It lives on Cloudflare as a secret; it's never sent to anyone's browser.

### 4. Recommended: a TMDB key, for adding new movies

Tagging a movie that isn't on the site yet (like a film you just mentioned) needs TMDB to look it up and fetch its poster. Without a key you can only tag movies already on the site. The key also fixes posters for `npm run find-movies` and `npm run add-movie`, which TMDB now blocks without one.

1. Make a free account at [themoviedb.org](https://www.themoviedb.org/signup), then go to **Settings → API** and request a key (type: **Developer**, personal/non-commercial use).
2. Copy the **API Read Access Token** (the long one).
3. Save it in two places:
   ```sh
   npx wrangler secret put TMDB_API_KEY   # for the site
   ```
   and in `.dev.vars` on your Mac: `TMDB_API_KEY=…` (for the scripts).

## Using it

Sign in, then:

- **✎ Edit page** (top right, on every page) turns on edit mode. Every piece of text you can change gets a dashed outline; click one, change it, press **Save** (or Enter for one-line text). It stays on as you move between pages until you click **Done editing**.
  - **Formatting:** headings and page copy take `**bold**`, `*italic*` and `[link text](https://…)`; longer text takes blank lines for paragraphs, `- ` for lists and `## ` for headings. The editor shows which applies.
  - **Empty fields** (a movie with no runtime, a host with no bio) show a grey “Add …” placeholder in edit mode only.
  - **Page copy** (headings, intros, buttons, footer, Privacy page): clear it, or use **Back to the original**, to go back to the built-in wording.
  - **Episode titles and descriptions** come from Spotify. Changing them here changes the site only; **Use Spotify’s** puts Spotify’s back.
  - **Show settings** (tagline, contact email, sponsor name, pitch and code) change everywhere they appear. They're plain text, because they're also used in page titles and search results.
- **Episode page → ✎ Edit transcript.** Every line, with its time (click to hear it), speaker and text.
  - Fix wording or the speaker, or **Delete** a line. Changed lines turn yellow. **Save** commits them all at once.
  - **Tag movie:** search for a title. Pick one already on the site, or (with the TMDB key) any film; its page and poster are created for you. It appears under "Also mentioned" with that line. The **×** on a tag removes it.
  - **Pull quote:** choose the movie and how many lines, and the quote goes on that movie's page.
  - The search box finds lines by words or by time (`12:34`).
- **Movie page → ✎ Edit movie page.** Each host's rating and one-line take, **Our take** (Markdown), and removing pull quotes.
- **Remove from list** (already there) still hides a wrong movie instantly.

**Not editable on the page:** text inside the interactive parts (comment box, sign-in form, quote search, audio player), numbers and dates the site works out (episode counts, durations), link addresses and images, and the hidden page descriptions search engines show. Change those in the code.

**Where edits are saved:** page copy in `src/data/copy.json` (only what you've changed), show settings in `src/data/site.json`, and everything else in the movie, episode or host file it belongs to.

The editor always loads the latest version from GitHub, so it includes edits that aren't live yet. Wording you fix shows on the page straight away; everything else appears after the rebuild.

## Good to know

- **Re-running `npm run transcribe` overwrites the transcript**, including fixes made on the site (git still has them). Fix up a transcript once you're happy with it.
- **`npm run find-movies -- --write` keeps your tags.** Movies tagged or removed on the site are recorded in `src/data/mention-edits.json`, and find-movies re-applies them every time it rebuilds `mentions.json`.
- **Pull before you work locally.** Site edits are commits on `main`, so `git pull` first to avoid conflicts.
- **Two people saving at once** is fine: each save starts from the latest commit and retries if someone else got there first.
- **Testing locally:** put `GITHUB_TOKEN` and `GITHUB_BRANCH=site-edits-test` in `.dev.vars`. Saves go to that branch instead of `main`, and the editor says "test mode".
