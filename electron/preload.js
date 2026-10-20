'use strict';
// The page may call these methods and nothing else. No Node, no database
// file path the page can choose, no Turso token.

const { contextBridge, ipcRenderer } = require('electron');

// Runs before the page scripts. The hosted screens still contain Download and
// Install until a deploy, and a cached service worker can put them back. Remove
// the nodes here so the Electron window cannot show them.
function stripInstallButtons() {
  const ids = ['install-btn', 'nav-install', 'login-install'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }
  for (const el of document.querySelectorAll('.chip-install, .nav-install')) {
    if (el.parentNode) el.parentNode.removeChild(el);
  }
}
function armInstallStrip() {
  if (!document.documentElement || document.documentElement.dataset.srInstallArmed) return;
  document.documentElement.dataset.srInstallArmed = '1';
  const style = document.createElement('style');
  style.id = 'sr-native-install';
  style.textContent = '#install-btn,#nav-install,#login-install,.chip-install,.nav-install{display:none!important}';
  document.documentElement.appendChild(style);
  stripInstallButtons();
  const observer = new MutationObserver(stripInstallButtons);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
armInstallStrip();
document.addEventListener('DOMContentLoaded', armInstallStrip);

const METHODS = [
  'putMany', 'all', 'get', 'remove', 'clearTable', 'clearAll', 'tableStats',
  'outboxPut', 'outboxGet', 'outboxAll', 'pending', 'outboxCount', 'outboxUpdate', 'outboxDelete',
  'markFailed', 'markSynced', 'purgeSynced', 'requeue',
  'metaGet', 'metaSet', 'metaAll',
  'logPut', 'logAll', 'logClear',
  'exportAll', 'importAll', 'info',
  'reserve', 'reserveFromSale', 'reservedByProduct', 'dropReservation',
  'rememberVerifier', 'checkVerifier',
];

const store = { engine: 'sqlite' };
for (const method of METHODS) {
  store[method] = (...args) => ipcRenderer.invoke('store', { method, args });
}

contextBridge.exposeInMainWorld('stockridgeNative', {
  engine: 'sqlite',
  shell: 'electron',
  store,
  backup: () => ipcRenderer.invoke('desktop:backup'),
  info: () => ipcRenderer.invoke('desktop:info'),
  printers: {
    list: () => ipcRenderer.invoke('printers:list'),
    print: (job) => ipcRenderer.invoke('printers:print', job || {}),
  },
  hub: {
    reserve: (row) => ipcRenderer.invoke('hub:reserve', row || {}),
    mirror: () => ipcRenderer.invoke('hub:mirror'),
    status: () => ipcRenderer.invoke('hub:status'),
  },
  updates: {
    check: () => ipcRenderer.invoke('updates:check'),
  },
});
