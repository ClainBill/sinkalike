// Applies hosts' "Remove from list" choices (stored in D1) to the static movie pages, and gives
// hosts Remove / Restore buttons on every movie card and movie page.
import { loadUser } from './session';

async function hiddenSlugs(fresh: boolean): Promise<Set<string>> {
  try {
    const response = await fetch('/api/movies/hidden', { cache: fresh ? 'reload' : 'default' });
    const data = (await response.json()) as { hidden: string[] };
    return new Set(data.hidden);
  } catch {
    return new Set();
  }
}

async function apply(fresh = false) {
  const items = [...document.querySelectorAll<HTMLElement>('[data-movie-slug]')];
  if (!items.length) return;
  const [hidden, me] = await Promise.all([hiddenSlugs(fresh), loadUser()]);
  const admin = !!me?.isAdmin;

  for (const item of items) {
    const slug = item.dataset.movieSlug!;
    const isHidden = hidden.has(slug);
    item.classList.toggle('is-removed', isHidden);
    if (item.hasAttribute('data-movie-page')) {
      item.querySelector<HTMLElement>('[data-removed-notice]')?.toggleAttribute('hidden', !isHidden);
    } else {
      item.hidden = isHidden && !admin;
    }
    const slot = item.querySelector<HTMLElement>('[data-movie-admin]');
    if (!admin || !slot) continue;
    let button = slot.querySelector<HTMLButtonElement>('button');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-small movie-admin-button';
      slot.append(button);
    }
    button.textContent = isHidden ? 'Restore to list' : 'Remove from list';
    button.onclick = async () => {
      button!.disabled = true;
      await fetch('/api/movies/hidden', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, hidden: !isHidden }),
      });
      button!.disabled = false;
      apply(true);
    };
  }

  // Hide a whole section when everything in it has been removed.
  for (const section of document.querySelectorAll<HTMLElement>('[data-movie-section]')) {
    section.hidden = !admin && ![...section.querySelectorAll<HTMLElement>('[data-movie-slug]')].some((item) => !item.hidden);
  }
}

document.addEventListener('astro:page-load', () => apply());
