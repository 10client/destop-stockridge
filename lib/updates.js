'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function isNewer(current, remote) {
  const a = String(current || '0').split('.').map((n) => Number(n) || 0);
  const b = String(remote || '0').split('.').map((n) => Number(n) || 0);
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const left = a[i] || 0;
    const right = b[i] || 0;
    if (right > left) return true;
    if (right < left) return false;
  }
  return false;
}

function writeManifest({ dir, version, fileName }) {
  const file = require('node:path').join(dir, fileName);
  const manifest = {
    version: String(version),
    file: fileName,
    sha256: sha256File(file),
    notes: 'StockRidge till update. The cloud database is not in this file.',
  };
  fs.writeFileSync(require('node:path').join(dir, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

function verifyFile(file, expected) {
  const got = sha256File(file);
  const a = Buffer.from(got, 'hex');
  const b = Buffer.from(String(expected || ''), 'hex');
  if (a.length !== 32 || b.length !== 32) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { sha256File, isNewer, writeManifest, verifyFile };
