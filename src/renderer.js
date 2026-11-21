'use strict';

/* global marked, DOMPurify */

// `api` is the global exposed by preload.js (window.api); redeclaring it here is a SyntaxError.
const $ = (id) => document.getElementById(id);

const editor = $('editor');
const preview = $('preview');
const previewPane = $('preview-pane');
const workspace = $('workspace');
const divider = $('divider');

const doc = {
  path: null,
  saved: '', // content as of last load/save, used for the dirty check
  eol: '\r\n', // Windows default for new files; files keep their own line endings
};
let syncScroll = true;

// ---------- helpers ----------
const fileName = () => (doc.path ? doc.path.split(/[\\/]/).pop() : 'Untitled');
const isDirty = () => editor.value !== doc.saved;

function dirUrl() {
  if (!doc.path) return null;
  const dir = doc.path.replace(/[\\/][^\\/]*$/, '');
  return 'file:///' + dir.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:') + '/';
}

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

// ---------- markdown rendering ----------
let slugCounts = new Map();
marked.use({
  gfm: true,
  breaks: false,
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

let currentBase = null;
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (!currentBase) return;
  const attr = node.tagName === 'IMG' ? 'src' : node.tagName === 'A' ? 'href' : null;
  if (!attr || !node.hasAttribute(attr)) return;
  const value = node.getAttribute(attr);
  if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(value)) return; // absolute or in-page
  try {
    node.setAttribute(attr, new URL(value, currentBase).href);
  } catch {
    /* leave as-is */
  }
});

function render() {
  slugCounts = new Map();
  currentBase = dirUrl();
  const html = marked.parse(editor.value);
  preview.innerHTML = DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
  if (syncScroll) syncPreviewScroll();
}

let renderTimer = null;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 150);
}

// ---------- status / state ----------
function updateStatus() {
  const pos = editor.selectionStart;
  const before = editor.value.slice(0, pos);
  const line = before.split('\n').length;
  const col = pos - before.lastIndexOf('\n');
  const words = (editor.value.match(/\S+/g) || []).length;
  $('status-pos').textContent = `Ln ${line}, Col ${col}`;
  $('status-words').textContent = `${words} word${words === 1 ? '' : 's'}`;
}

let lastSent = null;
function updateDocState() {
  const dirty = isDirty();
  $('status-path').textContent = doc.path || 'Untitled';
  $('status-state').textContent = dirty ? 'Modified' : 'Saved';
  $('status-state').classList.toggle('modified', dirty);
  const key = `${doc.path}|${dirty}`;
  if (key !== lastSent) {
    lastSent = key;
    api.setDocState({ dirty });
  }
}

function loadDoc({ path, content, eol }) {
  doc.path = path;
  doc.saved = content;
  doc.eol = eol || '\r\n';
  editor.value = content;
  editor.setSelectionRange(0, 0);
  editor.scrollTop = 0;
  previewPane.scrollTop = 0;
  render();
  updateStatus();
  updateDocState();
}

// ---------- file commands ----------
async function save(forceDialog = false) {
  // Main decides where to write: the open file, or a path chosen in the Save As dialog.
  const payload = { content: editor.value, eol: doc.eol };
  try {
    const saved = forceDialog ? await api.saveFileAs(payload) : await api.saveFile(payload);
    if (!saved) return false;
    const pathChanged = saved !== doc.path;
    doc.path = saved;
    doc.saved = payload.content;
    if (pathChanged) render(); // relative paths may now resolve differently
    updateDocState();
    return true;
  } catch (err) {
    await api.showError('Could not save file', String(err.message || err));
    return false;
  }
}

/** Resolves true when the current document may be discarded. */
async function confirmDiscard() {
  if (!isDirty()) return true;
  const answer = await api.askSave(fileName());
  if (answer === 'cancel') return false;
  if (answer === 'save') return save();
  return true;
}

async function newDoc() {
  if (!(await confirmDiscard())) return;
  api.newDocument();
  loadDoc({ path: null, content: '', eol: '\r\n' });
  editor.focus();
}

async function openDialog() {
  if (!(await confirmDiscard())) return;
  try {
    const d = await api.openDialog();
    if (d) loadDoc(d);
  } catch (err) {
    await api.showError('Could not open file', String(err.message || err));
  }
}

/** Opens a file main has granted (recent list, drop, link, second launch). */
async function openGranted(token) {
  if (!(await confirmDiscard())) return;
  try {
    loadDoc(await api.openGranted(token));
  } catch (err) {
    await api.showError('Could not open file', String(err.message || err));
  }
}

// ---------- editing helpers ----------
function replaceSelection(text, selectStart, selectEnd) {
  // execCommand keeps the native undo stack intact.
  editor.focus();
  const start = editor.selectionStart;
  document.execCommand('insertText', false, text);
  if (selectStart !== undefined) editor.setSelectionRange(start + selectStart, start + selectEnd);
}

function wrap(before, after, placeholder) {
  const { selectionStart: s, selectionEnd: e, value } = editor;
  const selected = value.slice(s, e) || placeholder;
  replaceSelection(before + selected + after, before.length, before.length + selected.length);
}

function format(kind) {
  switch (kind) {
    case 'bold':
      return wrap('**', '**', 'bold text');
    case 'italic':
      return wrap('*', '*', 'italic text');
    case 'code':
      return wrap('`', '`', 'code');
    case 'link': {
      const { selectionStart: s, selectionEnd: e, value } = editor;
      const label = value.slice(s, e) || 'link text';
      const text = `[${label}](https://)`;
      const urlStart = label.length + 3;
      return replaceSelection(text, urlStart, urlStart + 8);
    }
  }
}

function indent(outdent) {
  const { selectionStart: s, selectionEnd: e, value } = editor;
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  if (!outdent && s === e) {
    replaceSelection('  ');
    return;
  }
  let lineEnd = value.indexOf('\n', e > s && value[e - 1] === '\n' ? e - 1 : e);
  if (lineEnd === -1) lineEnd = value.length;
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const changed = lines.map((l) => (outdent ? l.replace(/^ {1,2}/, '') : '  ' + l)).join('\n');
  if (changed === block) return;
  editor.setSelectionRange(lineStart, lineEnd);
  replaceSelection(changed, 0, changed.length);
}

editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    indent(e.shiftKey);
  }
});

editor.addEventListener('input', () => {
  scheduleRender();
  updateStatus();
  updateDocState();
});
['keyup', 'click', 'select'].forEach((ev) => editor.addEventListener(ev, updateStatus));

// ---------- scroll sync ----------
function syncPreviewScroll() {
  const max = editor.scrollHeight - editor.clientHeight;
  const ratio = max > 0 ? editor.scrollTop / max : 0;
  previewPane.scrollTop = ratio * (previewPane.scrollHeight - previewPane.clientHeight);
}
editor.addEventListener('scroll', () => {
  if (syncScroll) syncPreviewScroll();
});

// ---------- preview links ----------
preview.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute('href') || '';
  if (href.startsWith('#')) {
    const target = document.getElementById(decodeURIComponent(href.slice(1)));
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  let url;
  try {
    url = new URL(href);
  } catch {
    return;
  }
  // Links to local Markdown files are handled by preload.js (needs a real click);
  // main then sends an 'open-granted' token. Other local files are ignored.
  if (url.protocol === 'file:') return;
  api.openExternal(url.href);
});

// ---------- view modes & divider ----------
function setViewMode(mode) {
  document.body.classList.remove('mode-split', 'mode-editor', 'mode-preview');
  document.body.classList.add(`mode-${mode}`);
  if (mode !== 'preview') editor.focus();
}

function setDivider(ratio) {
  const r = Math.min(0.85, Math.max(0.15, ratio));
  workspace.style.setProperty('--split', `${r * 100}%`);
  return r;
}

divider.addEventListener('pointerdown', (e) => {
  divider.setPointerCapture(e.pointerId);
  document.body.classList.add('resizing');
  const rect = workspace.getBoundingClientRect();
  let ratio = null;
  const move = (ev) => {
    ratio = setDivider((ev.clientX - rect.left) / rect.width);
  };
  const up = () => {
    divider.removeEventListener('pointermove', move);
    divider.removeEventListener('pointerup', up);
    document.body.classList.remove('resizing');
    if (ratio !== null) api.setSetting('divider', ratio);
  };
  divider.addEventListener('pointermove', move);
  divider.addEventListener('pointerup', up);
});
divider.addEventListener('dblclick', () => api.setSetting('divider', setDivider(0.5)));

// ---------- drag & drop ----------
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (![...e.dataTransfer.types].includes('Files')) return;
  dragDepth++;
  $('drop-hint').hidden = false;
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    $('drop-hint').hidden = true;
  }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('drop-hint').hidden = true;
  // The file itself is picked up by preload.js, which asks main for an open grant.
});

// ---------- main-process events ----------
api.onMenu((action, arg) => {
  switch (action) {
    case 'new':
      return newDoc();
    case 'open':
      return openDialog();
    case 'open-granted':
      return openGranted(arg);
    case 'save':
      return save(false);
    case 'save-as':
      return save(true);
    case 'format':
      return format(arg);
    case 'view':
      return setViewMode(arg);
    case 'sync-scroll':
      syncScroll = arg;
      if (syncScroll) syncPreviewScroll();
      return;
  }
});

api.onCloseRequest(async () => {
  if (await confirmDiscard()) api.closeNow();
});

// ---------- startup ----------
(async () => {
  const { settings, welcome, initialDoc } = await api.init();
  syncScroll = settings.syncScroll;
  setDivider(settings.divider);
  setViewMode(settings.viewMode);
  if (initialDoc) {
    loadDoc(initialDoc);
  } else {
    // The welcome text is shown as an unmodified Untitled document.
    loadDoc({ path: null, content: welcome.replace(/\r\n/g, '\n'), eol: '\r\n' });
  }
  editor.focus();
})();
