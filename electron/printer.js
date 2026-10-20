'use strict';

const net = require('node:net');
const { BrowserWindow } = require('electron');
const { encode } = require('../lib/escpos');

function slipHtml(text) {
  const body = String(text || '').replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page { size: 80mm auto; margin: 2mm; }
    pre { font-family: Consolas, monospace; font-size: 12px; white-space: pre; margin: 0; }
  </style></head><body><pre>${body}</pre></body></html>`;
}

async function listPrinters(win) {
  const host = win || BrowserWindow.getAllWindows()[0];
  if (!host) return [];
  const rows = await host.webContents.getPrintersAsync();
  return rows.map((row) => ({ name: row.name, isDefault: Boolean(row.isDefault), status: row.status }));
}

function sendEscpos({ host, port = 9100, text, drawer = false }) {
  const address = String(host || '').trim();
  if (!address || address.includes('/') || address.includes(' ')) throw new Error('The receipt printer needs a host name or an IP address.');
  const bytes = encode(text, { drawer: Boolean(drawer), cut: true });
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: address, port: Number(port) || 9100 }, () => {
      socket.end(bytes);
    });
    socket.setTimeout(8000, () => socket.destroy(new Error('The receipt printer did not answer.')));
    socket.on('error', (err) => reject(err));
    socket.on('close', () => resolve({ ok: true, mode: 'escpos' }));
  });
}

async function printSlip({ text, deviceName, host, port, drawer }) {
  if (host) return sendEscpos({ host, port, text, drawer });
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(slipHtml(text))}`);
    await new Promise((resolve, reject) => {
      win.webContents.print({
        silent: Boolean(deviceName),
        deviceName: deviceName || '',
        printBackground: true,
      }, (ok, reason) => (ok ? resolve() : reject(new Error(reason || 'The printer did not accept the slip.'))));
    });
    return { ok: true, mode: deviceName ? 'windows' : 'dialog' };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

module.exports = { listPrinters, printSlip, sendEscpos };
