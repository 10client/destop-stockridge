'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const { DeviceStore } = require('../lib/device-store');
const { startServer } = require('./server');
const { stockridgeRoot, workerOrigin } = require('./paths');

const METHODS = new Set([
  'putMany', 'all', 'get', 'remove', 'clearTable', 'clearAll', 'tableStats',
  'outboxPut', 'outboxGet', 'outboxAll', 'pending', 'outboxCount', 'outboxUpdate', 'outboxDelete',
  'markFailed', 'markSynced', 'purgeSynced', 'requeue',
  'metaGet', 'metaSet', 'metaAll',
  'logPut', 'logAll', 'logClear',
  'exportAll', 'importAll', 'info',
]);

let store = null;
let server = null;

function uiRoot() {
  return stockridgeRoot({
    envRoot: process.env.STOCKRIDGE_ROOT,
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    dirname: __dirname,
  });
}

function bakedOrigin() {
  if (!app.isPackaged) return null;
  try {
    const file = path.join(process.resourcesPath, 'desktop-config.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && parsed.origin ? String(parsed.origin) : null;
  } catch (err) {
    return null;
  }
}

function origin() {
  return workerOrigin({
    envOrigin: process.env.STOCKRIDGE_ORIGIN,
    packaged: app.isPackaged,
    bakedOrigin: bakedOrigin(),
  });
}

function createWindow(url) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: 'StockRidge',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
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
  store = new DeviceStore(dbFile);
  const port = Number(process.env.STOCKRIDGE_PORT) || 47321;
  try {
    server = await startServer({ root: uiRoot(), origin: origin(), port });
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
  ipcMain.handle('desktop:info', () => Object.assign(store.info(), { origin: server.origin, ui: server.url }));
  ipcMain.handle('desktop:backup', () => backup());

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'Save a copy of this till…', click: () => { backup().catch((err) => dialog.showErrorBox('Backup failed', err.message)); } },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]));

  createWindow(server.url);
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
  if (store) store.close();
  if (server) server.close();
  app.quit();
});
