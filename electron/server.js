'use strict';
// Local origin for the desktop window. Static files come from the StockRidge
// checkout. /api is forwarded to the Worker. The Turso token never comes here.

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { hideInstallChrome } = require('./hide-install');

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
});

const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade', 'host']);

function publicDir(root) {
  return path.resolve(root, 'public');
}

function safeFile(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const file = path.resolve(publicDir(root), rel);
  const base = publicDir(root);
  if (file !== base && !file.startsWith(base + path.sep)) return null;
  return file;
}

function insertScript(html, src) {
  if (html.includes(src)) return html;
  const tag = `<script src="${src}"></script>`;
  if (html.includes('</body>')) return html.replace('</body>', `${tag}\n</body>`);
  return `${html}\n${tag}\n`;
}

// The local proxy was failing, and the page turned that into the raw browser
// sentence "Failed to fetch". The window now asks the shop directly, on the
// same connection the PWA uses. A miss becomes a normal JSON answer, not a throw.
function shopDirectScript(origin) {
  const shop = JSON.stringify(String(origin || '').replace(/\/$/, ''));
  return `<script id="sr-shop-direct">
(function () {
  var shop = ${shop};
  if (!window.fetch || window.__srShopDirect) return;
  window.__srShopDirect = true;
  var orig = window.fetch;
  function shopUrl(input) {
    if (!shop) return null;
    var url = '';
    try { url = String((input && input.url) || input || ''); } catch (e) { return null; }
    var path = url;
    if (url.indexOf('http://') === 0 || url.indexOf('https://') === 0) {
      try {
        var parsed = new URL(url);
        if (parsed.origin !== location.origin) return null;
        path = parsed.pathname + parsed.search;
      } catch (e2) { return null; }
    }
    if (path.indexOf('/api/') !== 0) return null;
    return shop + path;
  }
  function missed() {
    return new Response(JSON.stringify({
      error: 'The shop did not answer from this window. Try again.',
      code: 'UPSTREAM_UNREACHABLE'
    }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
  window.fetch = function (input, init) {
    var next = shopUrl(input);
    var run = next ? orig.call(this, next, init) : orig.apply(this, arguments);
    return run.then(function (res) { return res; }, function () {
      if (next || String(input || '').indexOf('/api/') !== -1) return missed();
      return Promise.reject(new TypeError('The shop did not answer from this window. Try again.'));
    });
  };
})();
</script>`;
}

function withShopDirect(html, origin) {
  if (html.includes('id="sr-shop-direct"') || html.includes('id="sr-offline-fetch"')) return html;
  const script = shopDirectScript(origin);
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, (open) => `${open}\n${script}`);
  return `${script}\n${html}`;
}

function desktopIndex(html, origin) {
  const injected = html.includes('store-native.js')
    ? html
    : html.replace(
      /(<script src="\/js\/store\.js[^"]*"><\/script>)/,
      '$1\n<script src="/js/store-native.js"></script>',
    );
  const withSave = insertScript(injected, '/js/save-status.js');
  const withProduction = insertScript(withSave, '/js/desktop-production.js');
  return withShopDirect(hideInstallChrome(withProduction.replace(
    /if \('serviceWorker' in navigator\) \{[\s\S]*?\}\s*\n\s*<\/script>/,
    `if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      regs.forEach(function (reg) { reg.unregister(); });
    });
  }
</script>`,
  )), origin);
}

function electronNet() {
  try {
    const electron = require('electron');
    if (!electron || !electron.net || typeof electron.net.request !== 'function') return null;
    if (!electron.session || !electron.session.defaultSession) return null;
    return electron;
  } catch (err) { /* tests and the plain Node process have no Electron session */ }
  return null;
}

const BROWSER_HEADERS = new Set(['accept', 'authorization', 'content-type', 'x-device-id', 'idempotency-key']);

function browserHeaders(raw) {
  const headers = {};
  for (const [key, value] of Object.entries(raw || {})) {
    const name = key.toLowerCase();
    if (value == null) continue;
    if (!BROWSER_HEADERS.has(name) && !name.startsWith('x-')) continue;
    headers[name] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  if (!headers.accept) headers.accept = 'application/json';
  return headers;
}

function startServer({ root, origin, cacheRoot = null, host = '127.0.0.1', port = 0, offlineDoor = null } = {}) {
  if (!root) throw new Error('The desktop shell needs STOCKRIDGE_ROOT, the folder that contains public/.');
  if (!fs.existsSync(path.join(publicDir(root), 'index.html'))) {
    throw new Error(`No StockRidge UI at ${publicDir(root)}. Set STOCKRIDGE_ROOT to the checkout.`);
  }
  const target = new URL(origin || 'https://sample.stockridge.workers.dev');
  const transport = target.protocol === 'http:' ? http : https;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    if (url.pathname === '/__desktop/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, engine: 'sqlite', origin: target.origin }));
      return;
    }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      proxy(req, res, target, transport, url, offlineDoor);
      return;
    }
    serveStatic(root, url.pathname, res, cacheRoot, target.origin);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve({
        server,
        url: `http://${host}:${address.port}/`,
        port: address.port,
        origin: target.origin,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

function bridgeScript() {
  return path.join(__dirname, '..', 'public', 'js', 'store-native.js');
}

function productionScript() {
  return path.join(__dirname, '..', 'public', 'js', 'desktop-production.js');
}

function saveStatusScript() {
  return path.join(__dirname, '..', 'public', 'js', 'save-status.js');
}

function serveStatic(root, urlPath, res, cacheRoot, origin) {
  const pathname = urlPath.split('?')[0];
  if (pathname === '/sw.js') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('The desktop till does not use the service worker.');
    return;
  }
  if (pathname === '/js/store-native.js' || pathname === '/js/desktop-production.js' || pathname === '/js/save-status.js') {
    const bundled = pathname === '/js/store-native.js'
      ? bridgeScript()
      : (pathname === '/js/save-status.js' ? saveStatusScript() : productionScript());
    if (fs.existsSync(bundled)) {
      res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
      fs.createReadStream(bundled).pipe(res);
      return;
    }
  }
  const cached = cacheRoot ? safeFile(cacheRoot, urlPath) : null;
  const bundled = safeFile(root, urlPath);
  const file = (cached && fs.existsSync(cached) && !fs.statSync(cached).isDirectory()) ? cached : bundled;
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Not found');
    return;
  }
  fs.stat(file, (err, stat) => {
    const target = (!err && stat.isDirectory()) ? path.join(file, 'index.html') : file;
    fs.readFile(target, (readErr, buf) => {
      if (readErr) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end('Not found');
        return;
      }
      const ext = path.extname(target).toLowerCase();
      let body = buf;
      if (path.basename(target) === 'index.html') body = Buffer.from(desktopIndex(buf.toString('utf8'), origin), 'utf8');
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    });
  });
}

function unreachable(res) {
  if (res.headersSent) { res.end(); return; }
  res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: 'The shop server could not be reached.', code: 'UPSTREAM_UNREACHABLE' }));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function forwardHeaders(raw, { host = null } = {}) {
  const headers = {};
  for (const [key, value] of Object.entries(raw || {})) {
    if (HOP.has(key.toLowerCase()) || value == null) continue;
    headers[key] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  if (host) headers.host = host;
  return headers;
}

function sendJson(res, status, body) {
  if (res.headersSent) { res.end(); return; }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body || {}));
}

function nodeUpstream(target, transport, url, method, headers, body, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const upstream = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      servername: target.hostname,
      family: 4,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      method,
      path: url.pathname + url.search,
      headers,
      timeout: 12000,
    }, (pres) => {
      const chunks = [];
      pres.on('data', (chunk) => chunks.push(chunk));
      pres.on('end', () => {
        const out = {};
        for (const [key, value] of Object.entries(pres.headers)) {
          if (HOP.has(key.toLowerCase())) continue;
          out[key] = value;
        }
        resolve({ status: pres.statusCode || 502, headers: out, body: Buffer.concat(chunks) });
      });
    });
    const fail = (err) => {
      upstream.destroy();
      reject(err instanceof Error ? err : new Error('The shop server could not be reached.'));
    };
    if (signal) signal.addEventListener('abort', () => fail(new Error('aborted')), { once: true });
    upstream.on('timeout', () => fail(new Error('The Worker did not answer in time.')));
    upstream.on('error', fail);
    if (body && body.length) upstream.write(body);
    upstream.end();
  });
}

function netUpstream(target, url, method, headers, body) {
  const electron = electronNet();
  if (!electron) return Promise.reject(new Error('Chromium network is not available.'));
  return new Promise((resolve, reject) => {
    let upstream;
    try {
      upstream = electron.net.request({
        method,
        url: `${target.origin}${url.pathname}${url.search}`,
        session: electron.session.defaultSession,
      });
    } catch (err) {
      reject(err);
      return;
    }
    const timer = setTimeout(() => {
      try { upstream.abort(); } catch (abortErr) { /* already finished */ }
      reject(new Error('The Worker did not answer in time.'));
    }, 12000);
    const fail = (err) => {
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error('The shop server could not be reached.'));
    };
    for (const [key, value] of Object.entries(headers || {})) {
      if (value == null) continue;
      try { upstream.setHeader(key, String(value)); } catch (headerErr) { /* Chromium refuses a hop header */ }
    }
    const chunks = [];
    upstream.on('response', (response) => {
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        clearTimeout(timer);
        const out = {};
        for (const [key, value] of Object.entries(response.headers || {})) {
          if (HOP.has(key.toLowerCase())) continue;
          out[key] = Array.isArray(value) ? value.join(', ') : value;
        }
        resolve({ status: response.statusCode || 502, headers: out, body: Buffer.concat(chunks) });
      });
      response.on('error', fail);
    });
    upstream.on('error', fail);
    if (body && body.length && method !== 'GET' && method !== 'HEAD') upstream.write(body);
    upstream.end();
  });
}

function localDoor(offlineDoor, method, url, body) {
  if (typeof offlineDoor !== 'function') return null;
  try {
    return offlineDoor({ method, pathname: url.pathname, body }) || null;
  } catch (err) {
    return null;
  }
}

function proxy(req, res, target, transport, url, offlineDoor) {
  readBody(req).then(async (body) => {
    const method = req.method || 'GET';
    let upstream = null;
    if (target.protocol === 'https:' && electronNet()) {
      try {
        upstream = await netUpstream(target, url, method, browserHeaders(req.headers), body);
      } catch (err) {
        upstream = null;
      }
    }
    if (!upstream) {
      try {
        upstream = await nodeUpstream(target, transport, url, method, forwardHeaders(req.headers, { host: target.host }), body, null);
      } catch (err) {
        upstream = null;
      }
    }
    if (upstream) {
      if (res.headersSent) return;
      res.writeHead(upstream.status, upstream.headers);
      res.end(upstream.body);
      return;
    }
    const local = localDoor(offlineDoor, method, url, body);
    if (local && local.status) {
      sendJson(res, local.status, local.body);
      return;
    }
    unreachable(res);
  }).catch(() => unreachable(res));
}

module.exports = { startServer, desktopIndex, safeFile, browserHeaders };
