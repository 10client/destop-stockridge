'use strict';
// The page may call these methods and nothing else. No Node, no database
// file path the page can choose, no Turso token.

const { contextBridge, ipcRenderer } = require('electron');

const METHODS = [
  'putMany', 'all', 'get', 'remove', 'clearTable', 'clearAll', 'tableStats',
  'outboxPut', 'outboxGet', 'outboxAll', 'pending', 'outboxCount', 'outboxUpdate', 'outboxDelete',
  'markFailed', 'markSynced', 'purgeSynced', 'requeue',
  'metaGet', 'metaSet', 'metaAll',
  'logPut', 'logAll', 'logClear',
  'exportAll', 'importAll', 'info',
];

const store = { engine: 'sqlite' };
for (const method of METHODS) {
  store[method] = (...args) => ipcRenderer.invoke('store', { method, args });
}

contextBridge.exposeInMainWorld('stockridgeNative', {
  engine: 'sqlite',
  store,
  backup: () => ipcRenderer.invoke('desktop:backup'),
  info: () => ipcRenderer.invoke('desktop:info'),
});
