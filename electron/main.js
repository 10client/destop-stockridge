'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { app, BrowserWindow, ipcMain, dialog, Menu, safeStorage, session } = require('electron');
const { DeviceStore } = require('../lib/device-store');
const { startServer } = require('./server');
const { stockridgeRoot, workerOrigin } = require('./paths');
const { startHub } = require('../lib/hub');
const { refreshScreens, readStamp } = require('../lib/screen-sync');
const { SAMPLE_ORIGIN } = require('./paths');
const { listPrinters, printSlip } = require('./printer');
const { checkForUpdate } = require('./updater');
const { HIDE_INSTALL_CSS } = require('./hide-install');
const { SHARED_DATABASE, PWA_ORIGIN, OFFICE_ORIGIN } = require('../lib/shared-books');

const METHODS = new Set([
  'putMany', 'all', 'get', 'remove', 'clearTable', 'clearAll', 'tableStats',
  'outboxPut', 'outboxGet', 'outboxAll', 'pending', 'outboxCount', 'outboxUpdate', 'outboxDelete',
  'markFailed', 'markSynced', 'purgeSynced', 'requeue',
  'metaGet', 'metaSet', 'metaAll',
  'logPut', 'logAll', 'logClear',
  'exportAll', 'importAll', 'info',
  'reserve', 'reserveFromSale', 'reservedByProduct', 'dropReservation',
  'rememberVerifier', 'checkVerifier', 'hasVerifier',
]);

let store = null;
let server = null;
let hub = null;

function databaseKey() {
  const file = path.join(app.getPath('userData'), 'stockridge.key');
  if (fs.existsSync(file)) {
    const buf = fs.readFileSync(file);
    if (safeStorage.isEncryptionAvailable()) {
      try { return safeStorage.decryptString(buf); } catch (err) { /* an older raw key falls through */ }
    }
    const text = buf.toString('utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(text)) return text;
    throw new Error('This till\'s encryption key could not be read. Do not delete the database to get past this.');
  }
  const key = crypto.randomBytes(32).toString('hex');
  const payload = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key) : Buffer.from(key, 'utf8');
  fs.writeFileSync(file, payload, { mode: 0o600 });
  return key;
}

function hubSecret() {
  const existing = store.metaGet('hub_secret');
  if (existing && String(existing).length >= 16) return String(existing);
  const secret = crypto.randomBytes(24).toString('hex');
  store.metaSet('hub_secret', secret);
  return secret;
}

async function listenHub() {
  if (hub) return hub;
  hub = await startHub({ store, secret: hubSecret(), port: Number(process.env.STOCKRIDGE_HUB_PORT) || 47322 });
  store.metaSet('hub_listen', true);
  return hub;
}

function uiRoot() {
  return stockridgeRoot({
    envRoot: process.env.STOCKRIDGE_ROOT,
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    dirname: __dirname,
  });
}

function bakedConfig() {
  if (!app.isPackaged) return {};
  try {
    return JSON.parse(fs.readFileSync(path.join(process.resourcesPath, 'desktop-config.json'), 'utf8'));
  } catch (err) {
    return {};
  }
}

function bakedOrigin() {
  const parsed = bakedConfig();
  return parsed && parsed.origin ? String(parsed.origin) : null;
}

function screenCacheDir() {
  return path.join(app.getPath('userData'), 'screens');
}

function origin() {
  return workerOrigin({
    envOrigin: process.env.STOCKRIDGE_ORIGIN,
    bakedOrigin: bakedOrigin(),
    savedOrigin: null,
  });
}

async function matchPwaScreens() {
  const refreshed = await refreshScreens({ origin: origin(), cacheDir: screenCacheDir() });
  return refreshed;
}

const STRIP_INSTALL = `(function () {
  var ids = ['install-btn', 'nav-install', 'login-install'];
  function strip() {
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    var extra = document.querySelectorAll('.chip-install, .nav-install');
    for (var j = 0; j < extra.length; j++) {
      if (extra[j].parentNode) extra[j].parentNode.removeChild(extra[j]);
    }
  }
  strip();
  if (document.documentElement && !window.__srInstallStrip) {
    window.__srInstallStrip = new MutationObserver(strip);
    window.__srInstallStrip.observe(document.documentElement, { childList: true, subtree: true });
  }
})();`;

function armInstallHide(win) {
  const apply = () => {
    if (win.isDestroyed()) return;
    win.webContents.insertCSS(HIDE_INSTALL_CSS).catch(() => {});
    win.webContents.executeJavaScript(STRIP_INSTALL, true).catch(() => {});
  };
  win.webContents.on('dom-ready', apply);
  win.webContents.on('did-finish-load', apply);
  win.webContents.on('did-navigate-in-page', apply);
}

function createWindow(url) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'StockRidge',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  armInstallHide(win);
  let shown = false;
  const reveal = () => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    win.show();
  };
  win.webContents.on('dom-ready', () => {
    win.webContents.insertCSS(HIDE_INSTALL_CSS).finally(reveal);
  });
  setTimeout(reveal, 3000);
  win.loadURL(url);
  return win;
}

async function backup() {
  const chosen = await dialog.showSaveDialog({
    title: 'Save a copy of this till',
    defaultPath: `stockridge-till-${new Date().toISOString().slice(0, 10)}.db`,
    filters: [{ name: 'SQLite database', extensions: ['db'] }],
  });
  if (chosen.canceled || !chosen.filePath) return null;
  await store.backupTo(chosen.filePath);
  return chosen.filePath;
}

async function boot() {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }
  const dbFile = path.join(app.getPath('userData'), 'stockridge.db');
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  store = new DeviceStore(dbFile, { key: databaseKey() });
  if (process.env.STOCKRIDGE_HUB && process.env.STOCKRIDGE_HUB_SECRET) {
    store.metaSet('hub_peer', { url: process.env.STOCKRIDGE_HUB, secret: process.env.STOCKRIDGE_HUB_SECRET });
  }
  if (process.env.STOCKRIDGE_UPDATE_URL) store.metaSet('update_url', process.env.STOCKRIDGE_UPDATE_URL);
  const port = Number(process.env.STOCKRIDGE_PORT) || 47321;
  let screenNote = null;
  try {
    const refreshed = await matchPwaScreens();
    screenNote = refreshed.stamp || refreshed.origin;
  } catch (err) {
    const cached = readStamp(screenCacheDir());
    screenNote = cached && cached.stamp ? cached.stamp : null;
  }
  try {
    server = await startServer({
      root: uiRoot(),
      cacheRoot: screenCacheDir(),
      origin: origin(),
      port,
    });
  } catch (err) {
    if (err && err.code === 'EADDRINUSE') {
      throw new Error(`Port ${port} is already in use. Close the other StockRidge window, or set STOCKRIDGE_PORT.`);
    }
    throw err;
  }

  ipcMain.handle('store', (_event, payload) => {
    const method = payload && payload.method;
    if (!METHODS.has(method)) throw new Error('That store call is not allowed.');
    return store[method](...(payload.args || []));
  });
  ipcMain.handle('desktop:info', () => Object.assign(store.info(), {
    origin: server.origin,
    ui: server.url,
    hub: hub ? hub.url : null,
    screens: readStamp(screenCacheDir()),
    sameBooksAs: SAMPLE_ORIGIN,
  }));
  ipcMain.handle('desktop:backup', () => backup());
  ipcMain.handle('printers:list', (event) => listPrinters(BrowserWindow.fromWebContents(event.sender)));
  ipcMain.handle('printers:print', (_event, job) => printSlip(job || {}));
  ipcMain.handle('hub:status', () => ({ listening: Boolean(hub), url: hub ? hub.url : null }));
  ipcMain.handle('hub:reserve', async (_event, row) => {
    const cfg = store.metaGet('hub_peer');
    if (!cfg || !cfg.url || !cfg.secret) return { ok: false, skipped: true };
    const res = await fetch(`${String(cfg.url).replace(/\/$/, '')}/hub/v1/reservations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-StockRidge-Hub': cfg.secret },
      body: JSON.stringify(row || {}),
    });
    if (!res.ok) return { ok: false };
    return res.json();
  });
  ipcMain.handle('hub:mirror', async () => {
    const cfg = store.metaGet('hub_peer');
    if (!cfg || !cfg.url || !cfg.secret) return null;
    const res = await fetch(`${String(cfg.url).replace(/\/$/, '')}/hub/v1/mirror`, {
      headers: { 'X-StockRidge-Hub': cfg.secret },
    });
    if (!res.ok) return null;
    return res.json();
  });
  ipcMain.handle('updates:check', async () => {
    const url = process.env.STOCKRIDGE_UPDATE_URL || store.metaGet('update_url') || bakedConfig().updateUrl;
    if (!url) return { ok: false, reason: 'no-url' };
    return checkForUpdate(url);
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'Save a copy of this till…', click: () => { backup().catch((err) => dialog.showErrorBox('Backup failed', err.message)); } },
        { label: 'Match the PWA screens', click: () => {
          matchPwaScreens().then((refreshed) => {
            const win = BrowserWindow.getAllWindows()[0];
            if (win) win.reload();
            dialog.showMessageBox({ message: 'This window is now on the same screens as the PWA.', detail: refreshed.stamp || refreshed.origin });
          }).catch((err) => dialog.showErrorBox('The PWA screens could not be read', err.message));
        } },
        { label: 'Which books is this?', click: () => {
          const stamp = readStamp(screenCacheDir());
          dialog.showMessageBox({
            message: 'This till uses the same Turso books as the PWA and the Android app.',
            detail: `Worker: ${origin()}\nSame books: ${PWA_ORIGIN} and ${OFFICE_ORIGIN}\nDatabase: ${SHARED_DATABASE}\nScreens: ${stamp && stamp.stamp ? stamp.stamp : 'the copy already on this computer'}\nThe Turso token stays on the Worker. It is not on this computer.`,
          });
        } },
        { label: 'Choose receipt printer', click: async () => {
          const win = BrowserWindow.getAllWindows()[0];
          const printers = await listPrinters(win);
          if (!printers.length) {
            dialog.showMessageBox({ message: 'Windows did not report a printer.' });
            return;
          }
          const choice = await dialog.showMessageBox(win || undefined, {
            message: 'Which printer should take the receipt?',
            buttons: printers.map((item) => item.name).concat(['Cancel']),
            cancelId: printers.length,
          });
          if (choice.response >= printers.length) return;
          const current = store.metaGet('printer') || {};
          store.metaSet('printer', Object.assign({}, current, { deviceName: printers[choice.response].name }));
          if (win) win.reload();
        } },
        { label: 'Start the LAN hub', click: () => { listenHub().then((started) => dialog.showMessageBox({ message: `Other tills can use ${started.url}`, detail: 'The shared secret is stored in this till. It is not written into a backup. Set STOCKRIDGE_HUB and STOCKRIDGE_HUB_SECRET on the other tills.' })).catch(() => {}); } },
        { label: 'Check for a program update', click: () => {
          const url = process.env.STOCKRIDGE_UPDATE_URL || store.metaGet('update_url') || bakedConfig().updateUrl;
          checkForUpdate(url).then((result) => {
            if (result && result.update) dialog.showMessageBox({ message: `Version ${result.version} is ready.`, detail: result.file });
            else dialog.showMessageBox({ message: 'This till is already on the newest downloaded program.' });
          }).catch((err) => dialog.showErrorBox('Update check failed', err.message));
        } },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]));

  if (store.metaGet('hub_listen') || process.env.STOCKRIDGE_HUB_LISTEN === '1') {
    await listenHub();
  }
  await session.defaultSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] }).catch(() => {});
  const win = createWindow(server.url);
  if (screenNote) win.setTitle(`StockRidge · ${screenNote}`);
  app.on('second-instance', () => {
    const wins = BrowserWindow.getAllWindows();
    if (wins[0]) { if (wins[0].isMinimized()) wins[0].restore(); wins[0].focus(); }
  });
}

app.whenReady().then(boot).catch((err) => {
  dialog.showErrorBox('StockRidge could not start', err.message);
  app.quit();
});

app.on('window-all-closed', () => {
  if (hub) hub.close();
  if (store) store.close();
  if (server) server.close();
  app.quit();
});
