// A small Markdown subset for text edited on the site: **bold**, *italic*, [links](url),
// paragraphs, "- " lists and "## " / "### " headings. Used at build time and in the browser (to show a saved edit
// straight away), so both render the same. Everything else is escaped.

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const safeUrl = (url: string) => /^(https?:\/\/|mailto:|\/|#)/i.test(url.trim());

/** One line of inline Markdown → HTML. */
export function renderInline(markdown: string): string {
  return escape(markdown)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, url: string) => {
      if (!safeUrl(url)) return match;
      const external = /^https?:/i.test(url) ? ' rel="noopener"' : '';
      return `<a href="${url}"${external}>${label}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>');
}

/** Paragraphs (blank-line separated) and "- " bullet lists → HTML. */
export function renderBlocks(markdown: string): string {
  return markdown
    .trim()
    .split(/\n\s*\n/)
    .filter((block) => block.trim())
    .map((block) => {
      const lines = block.split('\n').map((line) => line.trim());
      const heading = lines[0].match(/^(#{2,3}) (.+)$/);
      if (heading) {
        const tag = `h${heading[1].length}`;
        const rest = lines.slice(1).join('\n');
        return `<${tag}>${renderInline(heading[2])}</${tag}>${rest ? `\n${renderBlocks(rest)}` : ''}`;
      }
      if (lines.every((line) => /^[-*] /.test(line))) {
        return `<ul>${lines.map((line) => `<li>${renderInline(line.slice(2))}</li>`).join('')}</ul>`;
      }
      return `<p>${lines.map(renderInline).join('<br>')}</p>`;
    })
    .join('\n');
}

/** Plain text of simple HTML (e.g. an RSS description), keeping paragraph breaks. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|div|li|h\d)>|<br\s*\/?>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
