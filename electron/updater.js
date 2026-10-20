'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { app } = require('electron');
const { isNewer, verifyFile } = require('../lib/updates');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        fetchJson(new URL(res.headers.location, url).href).then(resolve, reject);
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (err) { reject(new Error('The update list was not readable.')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('The update list did not answer.')));
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { timeout: 120000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        download(new URL(res.headers.location, url).href, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('The update file was not available.'));
        return;
      }
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve(dest)));
      out.on('error', reject);
    });
    req.on('error', reject);
  });
}

async function checkForUpdate(updateUrl) {
  if (!updateUrl) return { ok: false, reason: 'no-url' };
  const base = String(updateUrl).replace(/\/$/, '');
  const manifest = await fetchJson(`${base}/latest.json`);
  if (!manifest || !manifest.version || !manifest.file || !manifest.sha256) {
    throw new Error('The update list is missing the version, the file, or the hash.');
  }
  if (!isNewer(app.getVersion(), manifest.version)) return { ok: true, update: false, version: manifest.version };
  const dest = path.join(app.getPath('userData'), `StockRidge-${manifest.version}${path.extname(manifest.file)}`);
  await download(`${base}/${manifest.file}`, dest);
  if (!verifyFile(dest, manifest.sha256)) {
    fs.unlinkSync(dest);
    throw new Error('The downloaded update did not match its hash. It was deleted.');
  }
  return { ok: true, update: true, version: manifest.version, file: dest };
}

module.exports = { checkForUpdate };
