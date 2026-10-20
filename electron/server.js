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

// A 502 from this proxy is the shop being down, not proof the shop answered.
// The page otherwise treats any HTTP response as "online" and prints the
// proxy sentence instead of opening the saved till.
const OFFLINE_FETCH_SCRIPT = `<script id="sr-offline-fetch">
(function () {
  if (window.__srShopFetch || !window.fetch) return;
  window.__srShopFetch = true;
  var orig = window.fetch;
  window.fetch = function () {
    return orig.apply(this, arguments).then(function (res) {
      var url = '';
      try { url = String((arguments[0] && arguments[0].url) || arguments[0] || ''); } catch (e) { url = ''; }
      if (url.indexOf('/api/') === -1 || res.status < 500) return res;
      return res.clone().text().then(function (text) {
        if (text.indexOf('UPSTREAM_UNREACHABLE') !== -1 || text.indexOf('The shop server could not be reached.') !== -1) {
          throw new TypeError('Failed to fetch');
        }
        return res;
      }, function () { return res; });
    });
  };
})();
</script>`;

function withOfflineFetch(html) {
  if (html.includes('id="sr-offline-fetch"')) return html;
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, (open) => `${open}\n${OFFLINE_FETCH_SCRIPT}`);
  return `${OFFLINE_FETCH_SCRIPT}\n${html}`;
}

function desktopIndex(html) {
  const injected = html.includes('store-native.js')
    ? html
    : html.replace(
      /(<script src="\/js\/store\.js[^"]*"><\/script>)/,
      '$1\n<script src="/js/store-native.js"></script>',
    );
  const withSave = insertScript(injected, '/js/save-status.js');
  const withProduction = insertScript(withSave, '/js/desktop-production.js');
  return withOfflineFetch(hideInstallChrome(withProduction.replace(
    /if \('serviceWorker' in navigator\) \{[\s\S]*?\}\s*\n\s*<\/script>/,
    `if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      regs.forEach(function (reg) { reg.unregister(); });
    });
  }
</script>`,
  )));
}

function electronNet() {
  let electron;
  try { electron = require('electron'); } catch (err) { return null; }
  if (!electron || !electron.net || typeof electron.net.fetch !== 'function') return null;
  return electron.net;
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
    serveStatic(root, url.pathname, res, cacheRoot);
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

function serveStatic(root, urlPath, res, cacheRoot) {
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
      if (path.basename(target) === 'index.html') body = Buffer.from(desktopIndex(buf.toString('utf8')), 'utf8');
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

const UPSTREAM_TIMEOUT_MS = 8000;

function sendJson(res, status, body) {
  if (res.headersSent) { res.end(); return; }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body || {}));
}

function nodeUpstream(target, transport, url, method, headers, body) {
  return new Promise((resolve, reject) => {
    const upstream = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      method,
      path: url.pathname + url.search,
      headers,
      timeout: UPSTREAM_TIMEOUT_MS,
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
    upstream.on('timeout', () => upstream.destroy(new Error('The Worker did not answer in time.')));
    upstream.on('error', reject);
    if (body && body.length) upstream.write(body);
    upstream.end();
  });
}

function chromiumUpstream(net, target, url, method, headers, body) {
  const init = {
    method,
    headers,
    redirect: 'follow',
  };
  if (method !== 'GET' && method !== 'HEAD') init.body = new Uint8Array(body);
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    init.signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  }
  return net.fetch(target.origin + url.pathname + url.search, init).then(async (response) => {
    const buf = Buffer.from(await response.arrayBuffer());
    const out = {};
    response.headers.forEach((value, key) => {
      if (!HOP.has(String(key).toLowerCase())) out[key] = value;
    });
    return { status: response.status, headers: out, body: buf };
  });
}

function localDoor(offlineDoor, method, url, body) {
  if (typeof offlineDoor !== 'function') return null;
  try {
    return offlineDoor({ method, pathname: url.pathname, body }) || null;
  } catch (err) {
    return { status: 503, body: { error: 'The saved till could not be opened.', code: 'SAVED_TILL_UNREADABLE' } };
  }
}

function proxy(req, res, target, transport, url, offlineDoor) {
  const net = target.protocol === 'https:' ? electronNet() : null;
  readBody(req).then(async (body) => {
    const method = req.method || 'GET';
    try {
      const upstream = net
        ? await chromiumUpstream(net, target, url, method, forwardHeaders(req.headers), body)
        : await nodeUpstream(target, transport, url, method, forwardHeaders(req.headers, { host: target.host }), body);
      if (res.headersSent) return;
      res.writeHead(upstream.status, upstream.headers);
      res.end(upstream.body);
    } catch (err) {
      const local = localDoor(offlineDoor, method, url, body);
      if (local && local.status) {
        sendJson(res, local.status, local.body);
        return;
      }
      unreachable(res);
    }
  }).catch(() => unreachable(res));
}

module.exports = { startServer, desktopIndex, safeFile };
