'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

// The API exposed to the page. None of these take a file path: the main process owns
// the current document's path, and opening a file needs a one-time token from main.
contextBridge.exposeInMainWorld('api', {
  init: () => ipcRenderer.invoke('app:init'),
  getGuide: () => ipcRenderer.invoke('help:get-guide'),
  openDialog: () => ipcRenderer.invoke('file:open-dialog'),
  openGranted: (token) => ipcRenderer.invoke('file:open-granted', token),
  saveFile: (doc) => ipcRenderer.invoke('file:save', doc),
  saveFileAs: (doc) => ipcRenderer.invoke('file:save-as', doc),
  newDocument: () => ipcRenderer.send('file:new'),
  askSave: (name) => ipcRenderer.invoke('dialog:ask-save', name),
  showError: (title, message) => ipcRenderer.invoke('dialog:error', title, message),
  setDocState: (state) => ipcRenderer.send('doc:state', state),
  setSetting: (key, value) => ipcRenderer.send('settings:set', key, value),
  openExternal: (url) => ipcRenderer.send('shell:open-external', url),
  closeNow: () => ipcRenderer.send('app:close-now'),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action, arg) => cb(action, arg)),
  onCloseRequest: (cb) => ipcRenderer.on('app:close-request', () => cb()),
});

// ---- Requests that need a real user action ----
// These listeners run in the preload's isolated world, so page scripts cannot call
// them, and `isTrusted` is only true for genuine mouse/drag input. Main still checks
// that the target is an existing Markdown/text file before granting the open.

const OPENABLE = /\.(md|markdown|mdown|mkd|txt)$/i;

window.addEventListener(
  'drop',
  (e) => {
    if (!e.isTrusted) return;
    const file = e.dataTransfer && e.dataTransfer.files[0];
    if (!file) return;
    const p = webUtils.getPathForFile(file); // '' for files the page created itself
    if (p) ipcRenderer.send('file:dropped', p);
  },
  true
);

document.addEventListener(
  'click',
  (e) => {
    if (!e.isTrusted || e.button !== 0) return;
    const a = e.target instanceof Element ? e.target.closest('#preview a[href]') : null;
    if (!a) return;
    let url;
    try {
      url = new URL(a.href);
    } catch {
      return;
    }
    if (url.protocol === 'file:' && OPENABLE.test(url.pathname)) {
      ipcRenderer.send('file:link-clicked', url.href);
    }
  },
  true
);
