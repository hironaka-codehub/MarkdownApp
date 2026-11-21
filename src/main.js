'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const APP_NAME = 'MarkdownApp';
const MAX_RECENT = 10;
const MD_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] },
  { name: 'All files', extensions: ['*'] },
];

let win = null;
let helpWin = null;
let forceClose = false;
let pendingOpenPath = null;

// ---------- file access control ----------
// The renderer never names a path. Main owns the current document's path, and any
// open the renderer did not start through a dialog needs a one-time grant from main.
const current = { path: null, dirty: false };
const grants = new Map(); // token -> absolute path
const OPENABLE = /\.(md|markdown|mdown|mkd|txt)$/i;

function isOpenableFile(p) {
  try {
    return OPENABLE.test(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Lets the renderer open `p` once (after its unsaved-changes prompt). */
function grantOpen(p) {
  const token = crypto.randomUUID();
  grants.set(token, path.resolve(p));
  while (grants.size > 10) grants.delete(grants.keys().next().value);
  send('menu', 'open-granted', token);
}

// ---------- settings ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const defaults = {
  bounds: { width: 1200, height: 800 },
  maximized: false,
  viewMode: 'split',
  syncScroll: true,
  divider: 0.5,
  recent: [],
};
let settings = { ...defaults };

function loadSettings() {
  try {
    settings = { ...defaults, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    settings = { ...defaults };
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.error('Could not save settings:', err);
  }
}

// ---------- files ----------
function readDoc(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  current.path = path.resolve(filePath);
  addRecent(filePath);
  return { path: current.path, content: content.replace(/\r\n/g, '\n'), eol };
}

function writeDoc(filePath, content, eol) {
  if (typeof content !== 'string') throw new Error('Invalid content');
  const out = eol === '\r\n' ? content.replace(/\r?\n/g, '\r\n') : content;
  fs.writeFileSync(filePath, out, 'utf8');
  current.path = path.resolve(filePath);
  addRecent(filePath);
  return current.path;
}

async function saveAsDialog(content, eol) {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: current.path || 'Untitled.md',
    filters: MD_FILTERS,
  });
  if (r.canceled || !r.filePath) return null;
  let target = r.filePath;
  if (!path.extname(target)) target += '.md';
  return writeDoc(target, content, eol);
}

function addRecent(filePath) {
  const full = path.resolve(filePath);
  settings.recent = [full, ...settings.recent.filter((p) => p.toLowerCase() !== full.toLowerCase())].slice(0, MAX_RECENT);
  saveSettings();
  buildMenu();
}

function fileFromArgv(argv) {
  // In dev (`electron .`) argv is [electron, ., file]; packaged it is [exe, file].
  const args = argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-'));
  for (const a of args) {
    const p = path.resolve(a);
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {
      /* not a file */
    }
  }
  return null;
}

// ---------- window ----------
function updateTitle() {
  if (!win) return;
  const name = current.path ? path.basename(current.path) : 'Untitled';
  win.setTitle(`${current.dirty ? '● ' : ''}${name} — ${APP_NAME}`);
  win.setDocumentEdited(current.dirty);
}

function send(...args) {
  if (win && !win.isDestroyed()) win.webContents.send(...args);
}

function isSafeExternal(url) {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

const APP_ICON = path.join(__dirname, '..', 'assets', 'icon.png');

const secureWebPreferences = () => ({
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  spellcheck: false,
});

function lockNavigation(w) {
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

/** Opens the bundled Markdown syntax guide in its own read-only window (works offline). */
function openHelp() {
  if (helpWin) {
    if (helpWin.isMinimized()) helpWin.restore();
    helpWin.focus();
    return;
  }
  helpWin = new BrowserWindow({
    width: 820,
    height: 760,
    minWidth: 400,
    minHeight: 300,
    title: `Markdown Syntax Guide — ${APP_NAME}`,
    icon: APP_ICON,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
    webPreferences: secureWebPreferences(),
  });
  helpWin.setMenu(null);
  lockNavigation(helpWin);
  helpWin.on('page-title-updated', (e) => e.preventDefault());
  helpWin.once('ready-to-show', () => helpWin.show());
  helpWin.on('closed', () => {
    helpWin = null;
  });
  helpWin.loadFile(path.join(__dirname, 'help.html'));
}

function createWindow() {
  win = new BrowserWindow({
    ...settings.bounds,
    minWidth: 500,
    minHeight: 300,
    title: APP_NAME,
    icon: APP_ICON,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
    webPreferences: secureWebPreferences(),
  });
  if (settings.maximized) win.maximize();

  lockNavigation(win);

  win.on('page-title-updated', (e) => e.preventDefault()); // title is driven by updateTitle()
  win.once('ready-to-show', () => win.show());

  win.on('close', (e) => {
    if (!forceClose && current.dirty) {
      e.preventDefault();
      send('app:close-request');
      return;
    }
    settings.maximized = win.isMaximized();
    if (!settings.maximized && !win.isMinimized()) settings.bounds = win.getBounds();
    saveSettings();
  });
  win.on('closed', () => {
    win = null;
    if (helpWin) helpWin.close();
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  updateTitle();
}

// ---------- menu ----------
function buildMenu() {
  const menuAction = (action, arg) => () => send('menu', action, arg);
  const recentItems = settings.recent.length
    ? [
        ...settings.recent.map((p) => ({ label: p, click: () => grantOpen(p) })),
        { type: 'separator' },
        {
          label: 'Clear Recent',
          click: () => {
            settings.recent = [];
            saveSettings();
            buildMenu();
          },
        },
      ]
    : [{ label: '(none)', enabled: false }];

  const viewItem = (label, mode, accelerator) => ({
    label,
    type: 'radio',
    accelerator,
    checked: settings.viewMode === mode,
    click: () => {
      settings.viewMode = mode;
      saveSettings();
      send('menu', 'view', mode);
    },
  });

  const template = [
    {
      label: '&File',
      submenu: [
        { label: '&New', accelerator: 'CmdOrCtrl+N', click: menuAction('new') },
        { label: '&Open…', accelerator: 'CmdOrCtrl+O', click: menuAction('open') },
        { label: 'Open &Recent', submenu: recentItems },
        { type: 'separator' },
        { label: '&Save', accelerator: 'CmdOrCtrl+S', click: menuAction('save') },
        { label: 'Save &As…', accelerator: 'CmdOrCtrl+Shift+S', click: menuAction('save-as') },
        { type: 'separator' },
        { label: 'E&xit', accelerator: 'Alt+F4', click: () => win && win.close() },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: '&Bold', accelerator: 'CmdOrCtrl+B', click: menuAction('format', 'bold') },
        { label: '&Italic', accelerator: 'CmdOrCtrl+I', click: menuAction('format', 'italic') },
        { label: '&Link', accelerator: 'CmdOrCtrl+K', click: menuAction('format', 'link') },
        { label: 'Inline &Code', accelerator: 'CmdOrCtrl+`', click: menuAction('format', 'code') },
      ],
    },
    {
      label: '&View',
      submenu: [
        viewItem('&Split', 'split', 'CmdOrCtrl+1'),
        viewItem('&Editor Only', 'editor', 'CmdOrCtrl+2'),
        viewItem('&Preview Only', 'preview', 'CmdOrCtrl+3'),
        { type: 'separator' },
        {
          label: 'S&ync Scroll',
          type: 'checkbox',
          checked: settings.syncScroll,
          click: (item) => {
            settings.syncScroll = item.checked;
            saveSettings();
            send('menu', 'sync-scroll', item.checked);
          },
        },
        { type: 'separator' },
        { role: 'zoomIn', accelerator: 'CmdOrCtrl+=' },
        { role: 'zoomOut', accelerator: 'CmdOrCtrl+-' },
        { role: 'resetZoom', accelerator: 'CmdOrCtrl+0' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: '&Help',
      submenu: [
        { label: 'Markdown Syntax &Guide', accelerator: 'F1', click: openHelp },
        {
          label: `About ${APP_NAME}`,
          click: () =>
            dialog.showMessageBox(win, {
              type: 'info',
              title: `About ${APP_NAME}`,
              message: `${APP_NAME} ${app.getVersion()}`,
              detail: 'A simple Markdown editor and viewer for Windows.',
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('app:init', () => {
    let welcome = '';
    try {
      welcome = fs.readFileSync(path.join(__dirname, '..', 'samples', 'welcome.md'), 'utf8');
    } catch {
      /* no welcome document */
    }
    const initialPath = pendingOpenPath;
    pendingOpenPath = null;
    let initialDoc = null;
    if (initialPath) {
      try {
        initialDoc = readDoc(initialPath);
      } catch (err) {
        dialog.showErrorBox('Could not open file', `${initialPath}\n\n${err.message}`);
      }
    }
    return {
      settings: { viewMode: settings.viewMode, syncScroll: settings.syncScroll, divider: settings.divider },
      welcome,
      initialDoc,
    };
  });

  ipcMain.handle('help:get-guide', () =>
    fs.readFileSync(path.join(__dirname, '..', 'assets', 'syntax-guide.md'), 'utf8')
  );

  ipcMain.handle('file:open-dialog', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: MD_FILTERS });
    if (r.canceled || !r.filePaths.length) return null;
    return readDoc(r.filePaths[0]);
  });

  ipcMain.handle('file:open-granted', (_e, token) => {
    const p = grants.get(token);
    if (!p) throw new Error('This file was not opened by you.');
    grants.delete(token);
    return readDoc(p);
  });

  // Save writes only to the document main already has open; otherwise ask for a path.
  ipcMain.handle('file:save', (_e, { content, eol }) =>
    current.path ? writeDoc(current.path, content, eol) : saveAsDialog(content, eol)
  );

  ipcMain.handle('file:save-as', (_e, { content, eol }) => saveAsDialog(content, eol));

  ipcMain.on('file:new', () => {
    current.path = null;
    updateTitle();
  });

  // These two arrive from the preload's isolated world, only for trusted (real) user
  // drops and clicks, and only for Markdown/text files.
  ipcMain.on('file:dropped', (_e, p) => {
    if (typeof p === 'string' && isOpenableFile(p)) grantOpen(p);
  });
  ipcMain.on('file:link-clicked', (_e, url) => {
    let p;
    try {
      p = fileURLToPath(url);
    } catch {
      return;
    }
    if (isOpenableFile(p)) grantOpen(p);
  });

  ipcMain.handle('dialog:ask-save', async (_e, name) => {
    const r = await dialog.showMessageBox(win, {
      type: 'warning',
      title: APP_NAME,
      message: `Do you want to save changes to ${name}?`,
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    return ['save', 'discard', 'cancel'][r.response];
  });

  ipcMain.handle('dialog:error', (_e, title, message) => {
    dialog.showErrorBox(title, message);
  });

  ipcMain.on('doc:state', (_e, state) => {
    current.dirty = !!(state && state.dirty);
    updateTitle();
  });

  ipcMain.on('settings:set', (_e, key, value) => {
    if (['divider'].includes(key)) {
      settings[key] = value;
      saveSettings();
    }
  });

  ipcMain.on('shell:open-external', (_e, url) => {
    if (isSafeExternal(url)) shell.openExternal(url);
  });

  ipcMain.on('app:close-now', () => {
    forceClose = true;
    if (win) win.close();
  });
}

// ---------- startup ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    // second-instance argv always has the exe first; packaged or not, skip flags.
    const p = argv
      .slice(1)
      .filter((a) => !a.startsWith('-') && a !== '.')
      .map((a) => path.resolve(a))
      .find((a) => {
        try {
          return fs.statSync(a).isFile();
        } catch {
          return false;
        }
      });
    if (p) grantOpen(p);
  });

  app.whenReady().then(() => {
    loadSettings();
    pendingOpenPath = fileFromArgv(process.argv);
    registerIpc();
    buildMenu();
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
