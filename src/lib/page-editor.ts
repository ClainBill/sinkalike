// "Edit page" mode for hosts: every element marked with lib/editable.ts gets an outline;
// clicking one opens a small editor that saves through /api/edit/text and updates the page
// straight away (the rebuilt page follows in about 2 minutes). Loaded only for hosts.
import { editApi, liveSoon, setupWarning, type EditSetup } from './edit-client';
import { renderBlocks, renderInline } from './markdown-lite';
import '../components/islands/page-editor.css';

let editing = false;
let installed = false;
let setup: EditSetup | null = null;
let current: HTMLElement | null = null;

const HINTS: Record<string, string> = {
  plain: 'Plain text.',
  inline: '**bold**, *italic*, [link text](https://…)',
  blocks: 'A blank line starts a new paragraph. **bold**, *italic*, [link text](https://…), “- ” for a list.',
  markdown: 'Markdown. A blank line starts a new paragraph.',
  lines: 'One per line.',
  number: 'A number. Leave it empty to remove it.',
};
const ROWS: Record<string, number> = { plain: 2, inline: 3, blocks: 8, markdown: 14, lines: 6, number: 1 };

export function setEditing(on: boolean) {
  editing = on;
  document.documentElement.classList.toggle('is-editing', on);
  if (on && !installed) install();
  banner();
}

function install() {
  installed = true;
  // Capture phase, so links and play buttons don't fire while editing.
  document.addEventListener('click', onClick, true);
  document.addEventListener('astro:after-swap', () => {
    document.documentElement.classList.toggle('is-editing', editing);
    banner();
  });
  editApi<EditSetup>('search')
    .then((info) => (setup = info))
    .catch(() => {});
}

function onClick(event: MouseEvent) {
  if (!editing) return;
  const target = event.target as Element;
  if (target.closest('.page-editor, .edit-banner')) return;
  const element = target.closest<HTMLElement>('[data-edit]');
  if (!element) return;
  event.preventDefault();
  event.stopPropagation();
  open(element);
}

function describe(target: string): { title: string; note: string; reset: string } {
  const [type, a, b] = target.split(':');
  if (type === 'copy') return { title: 'Page text', note: '', reset: 'Back to the original' };
  if (type === 'site') return { title: `Show setting: ${a}`, note: 'This appears on every page that uses it.', reset: '' };
  if (type === 'episode' && (b === 'title' || b === 'description')) {
    return {
      title: `Episode ${b}`,
      note: 'This comes from Spotify. Saving here changes it on this site only; Spotify keeps its own. Clear it to use Spotify’s again.',
      reset: 'Use Spotify’s',
    };
  }
  const what = type === 'movie' ? 'Movie' : type === 'episode' ? 'Episode' : 'Host';
  const names: Record<string, string> = { body: type === 'movie' ? 'our take' : type === 'episode' ? 'show notes' : 'bio' };
  return { title: `${what}: ${names[b] ?? b.replace('.', ' ')}`, note: '', reset: '' };
}

function dialog(): HTMLDialogElement {
  let element = document.querySelector<HTMLDialogElement>('dialog.page-editor');
  if (element) return element;
  element = document.createElement('dialog');
  element.className = 'page-editor';
  element.innerHTML = `
    <form method="dialog">
      <p class="kicker">Edit</p>
      <h2 data-pe-title></h2>
      <p class="pe-note" data-pe-note></p>
      <textarea class="input" data-pe-input></textarea>
      <p class="meta" data-pe-hint></p>
      <p class="pe-status" role="status" data-pe-status></p>
      <div class="pe-buttons">
        <button type="button" class="linkish" data-pe-reset></button>
        <span class="pe-spacer"></span>
        <button type="button" class="btn btn-small" data-pe-cancel>Cancel</button>
        <button type="submit" class="btn btn-small btn-primary" data-pe-save>Save</button>
      </div>
    </form>`;
  document.body.append(element);
  const input = element.querySelector<HTMLTextAreaElement>('[data-pe-input]')!;
  element.querySelector('[data-pe-cancel]')!.addEventListener('click', () => element!.close());
  element.querySelector('form')!.addEventListener('submit', (event) => {
    event.preventDefault();
    save(input.value);
  });
  element.querySelector('[data-pe-reset]')!.addEventListener('click', () => save(''));
  // One-line kinds: Enter saves.
  input.addEventListener('keydown', (event) => {
    const kind = current?.dataset.editKind ?? '';
    if (event.key === 'Enter' && !event.shiftKey && ['plain', 'inline', 'number'].includes(kind)) {
      event.preventDefault();
      save(input.value);
    }
  });
  return element;
}

function open(element: HTMLElement) {
  current = element;
  const box = dialog();
  const kind = element.dataset.editKind ?? 'plain';
  const info = describe(element.dataset.edit!);
  const fallback = element.dataset.editDefault;
  const source = element.dataset.editSrc ?? '';
  box.querySelector('[data-pe-title]')!.textContent = info.title;
  const note = box.querySelector<HTMLElement>('[data-pe-note]')!;
  note.textContent = setupWarning(setup) || info.note;
  note.hidden = !note.textContent;
  note.classList.toggle('error', !!setupWarning(setup));
  box.querySelector('[data-pe-hint]')!.textContent = HINTS[kind] ?? '';
  box.querySelector('[data-pe-status]')!.textContent = '';
  const reset = box.querySelector<HTMLButtonElement>('[data-pe-reset]')!;
  reset.textContent = info.reset;
  reset.hidden = !info.reset || fallback === undefined || fallback === source;
  box.querySelector<HTMLButtonElement>('[data-pe-save]')!.disabled = !!setup && !setup.editing;
  const input = box.querySelector<HTMLTextAreaElement>('[data-pe-input]')!;
  input.value = source;
  input.rows = ROWS[kind] ?? 3;
  input.inputMode = kind === 'number' ? 'decimal' : 'text';
  box.showModal();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

async function save(value: string) {
  if (!current) return;
  const box = dialog();
  const status = box.querySelector<HTMLElement>('[data-pe-status]')!;
  const buttons = box.querySelectorAll<HTMLButtonElement>('button');
  const target = current.dataset.edit!;
  buttons.forEach((b) => (b.disabled = true));
  status.classList.remove('error');
  status.textContent = 'Saving…';
  try {
    await editApi('text', { target, value });
    // Empty means "back to the default" where there is one (page text, Spotify's wording).
    const shown = value.trim() === '' && current.dataset.editDefault !== undefined ? current.dataset.editDefault : value;
    for (const element of document.querySelectorAll<HTMLElement>(`[data-edit="${CSS.escape(target)}"]`)) show(element, shown);
    box.close();
    toast(liveSoon(setup));
  } catch (error) {
    status.classList.add('error');
    status.textContent = (error as Error).message;
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

/** Puts saved text on the page now, rendered the way the build will render it. */
function show(element: HTMLElement, value: string) {
  const kind = element.dataset.editKind ?? 'plain';
  element.dataset.editSrc = value;
  const empty = value.trim() === '';
  element.toggleAttribute('data-edit-empty', empty);
  if (element.hasAttribute('data-edit-static')) return;
  if (kind === 'inline') element.innerHTML = renderInline(value.replace(/\s+/g, ' ').trim());
  else if (kind === 'blocks' || kind === 'markdown') element.innerHTML = renderBlocks(value);
  else if (kind === 'lines') {
    const items = value.split('\n').map((line) => line.trim()).filter(Boolean);
    if (element.tagName === 'UL' || element.tagName === 'OL') {
      element.replaceChildren(...items.map((item) => Object.assign(document.createElement('li'), { textContent: item })));
    } else if (element.dataset.editJoin !== undefined) element.textContent = items.join(element.dataset.editJoin);
    // Anything else (e.g. poll options) shows after the rebuild.
  } else element.textContent = `${element.dataset.editPrefix ?? ''}${value.replace(/\s+/g, ' ').trim()}${element.dataset.editSuffix ?? ''}`;
}

function toast(text: string) {
  const element = Object.assign(document.createElement('p'), { className: 'edit-toast', role: 'status', textContent: text });
  document.body.append(element);
  setTimeout(() => element.remove(), 5000);
}

function banner() {
  document.querySelector('.edit-banner')?.remove();
  if (!editing) return;
  const element = document.createElement('div');
  element.className = 'edit-banner';
  element.innerHTML = '<span>Editing: click any outlined text to change it.</span>';
  const done = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-small', textContent: 'Done' });
  done.addEventListener('click', () => document.dispatchEvent(new CustomEvent('sa:stop-editing')));
  element.append(done);
  document.body.append(element);
}
