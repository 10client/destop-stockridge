'use strict';

// Copies the live PWA screens onto this computer so the desktop window and the
// browser are the same version. The Turso token is not involved. The Worker
// remains the only door into that database.

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');

const MAX_BYTES = 5_000_000;
const MAX_FILES = 80;

function localPath(urlPath) {
  const clean = String(urlPath || '').split('?')[0].split('#')[0];
  if (clean === '/' || clean === '/index.html') return 'index.html';
  if (!clean.startsWith('/') || clean.includes('..') || clean.includes('\\')) return null;
  if (clean === '/sw.js' || clean === '/offline.html') return null;
  if (!/^\/(?:js|css|icons|brand)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+$/.test(clean)) return null;
  return clean.slice(1);
}

function extractRefs(text) {
  const refs = new Set();
  const re = /(?:src|href)=["']([^"']+)["']|url\(([^)]+)\)/g;
  let match;
  while ((match = re.exec(String(text || '')))) {
    let raw = (match[1] || match[2] || '').trim().replace(/^['"]|['"]$/g, '');
    if (!raw.startsWith('/') || raw.startsWith('//')) continue;
    refs.add(raw.split('#')[0]);
  }
  return [...refs];
}

function getBuffer(origin, urlPath, timeoutMs, redirects = 0) {
  return new Promise((resolve, reject) => {
    let target;
    try { target = new URL(urlPath, origin); } catch (err) { reject(err); return; }
    const home = new URL(origin);
    if (target.origin !== home.origin) {
      reject(new Error('Refused a screen file from another host.'));
      return;
    }
    const lib = target.protocol === 'http:' ? http : https;
    const req = lib.get(target, { timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects >= 3) {
          reject(new Error('Too many redirects while reading the shop screens.'));
          return;
        }
        getBuffer(origin, res.headers.location, timeoutMs, redirects + 1).then(resolve, reject);
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          req.destroy(new Error('A screen file was larger than expected.'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        if ((res.statusCode || 500) >= 400) {
          reject(new Error(`The Worker answered ${res.statusCode} for ${urlPath}`));
          return;
        }
        resolve(Buffer.concat(chunks));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('The Worker did not answer in time.')));
  });
}

function writeRel(dir, rel, buf) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

async function refreshScreens({ origin, cacheDir, timeoutMs = 20000 } = {}) {
  if (!origin) throw new Error('The till needs the Worker address before it can match the PWA.');
  if (!cacheDir) throw new Error('The till needs a folder for the shop screens.');
  const incoming = `${cacheDir}.incoming`;
  fs.rmSync(incoming, { recursive: true, force: true });
  const publicDir = path.join(incoming, 'public');
  fs.mkdirSync(publicDir, { recursive: true });
  const index = await getBuffer(origin, '/', timeoutMs);
  const html = index.toString('utf8');
  if (!/<html[\s>]/i.test(html)) throw new Error('The Worker did not return the shop screen.');
  writeRel(publicDir, 'index.html', index);
  const wanted = [];
  const seen = new Set(['index.html']);
  for (const ref of extractRefs(html)) {
    const rel = localPath(ref);
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    wanted.push({ ref, rel });
  }
  const extras = [];
  await mapPool(wanted.slice(0, MAX_FILES), 6, async (item) => {
    const buf = await getBuffer(origin, item.ref, timeoutMs);
    writeRel(publicDir, item.rel, buf);
    if (item.rel.endsWith('.css')) {
      for (const nested of extractRefs(buf.toString('utf8'))) {
        const rel = localPath(nested);
        if (!rel || seen.has(rel)) continue;
        seen.add(rel);
        extras.push({ ref: nested, rel });
      }
    }
    return item.rel;
  });
  await mapPool(extras.slice(0, 20), 4, async (item) => {
    const buf = await getBuffer(origin, item.ref, timeoutMs);
    writeRel(publicDir, item.rel, buf);
    return item.rel;
  });
  const stamp = (html.match(/ridge-\d{8}-\d{4}-[0-9a-f]+/) || [null])[0];
  const files = fs.readdirSync(publicDir, { recursive: true }).length;
  fs.writeFileSync(path.join(incoming, 'stamp.json'), JSON.stringify({
    origin: new URL(origin).origin,
    stamp,
    at: new Date().toISOString(),
    files,
  }, null, 2));
  fs.rmSync(cacheDir, { recursive: true, force: true });
  fs.renameSync(incoming, cacheDir);
  return { origin: new URL(origin).origin, stamp, files };
}

function readStamp(cacheDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(cacheDir, 'stamp.json'), 'utf8'));
  } catch (err) {
    return null;
  }
}

module.exports = { refreshScreens, readStamp, localPath, extractRefs };
