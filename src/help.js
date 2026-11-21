'use strict';

/* global marked, DOMPurify, api */
// Renders the bundled syntax guide (assets/syntax-guide.md). No network access.

const guide = document.getElementById('preview');

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

const slugCounts = new Map();
marked.use({
  gfm: true,
  renderer: {
    heading({ tokens, depth, text }) {
      let slug = slugify(text) || 'section';
      const n = slugCounts.get(slug) || 0;
      slugCounts.set(slug, n + 1);
      if (n) slug += `-${n}`;
      return `<h${depth} id="${slug}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
    },
  },
});

guide.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute('href') || '';
  if (href.startsWith('#')) {
    const target = document.getElementById(decodeURIComponent(href.slice(1)));
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (/^(https?:|mailto:)/i.test(href)) {
    api.openExternal(href);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close();
});

api.getGuide().then((md) => {
  guide.innerHTML = DOMPurify.sanitize(marked.parse(md));
});
