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

// Cloudflare refuses a request with no browser signature (error 1010) and that
// refusal has no CORS headers, so a window fetch reports a network failure.
// The page stays on this computer. The proxy asks the shop with a normal
// browser signature and returns the shop's own JSON.
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function desktopIndex(html) {
  const injected = html.includes('store-native.js')
    ? html
    : html.replace(
      /(<script src="\/js\/store\.js[^"]*"><\/script>)/,
      '$1\n<script src="/js/store-native.js"></script>',
    );
  const withSave = insertScript(injected, '/js/save-status.js');
  // Before app.js, so the till id is pinned before the first sign-in check.
  // A page with no app.js (the injection test) still gets the script at the end.
  const withProduction = withSave.includes('/js/desktop-production.js')
    ? withSave
    : (/<script src="\/js\/app\.js/.test(withSave)
      ? withSave.replace(
        /(<script src="\/js\/app\.js[^"]*"><\/script>)/,
        '<script src="/js/desktop-production.js"></script>\n$1',
      )
      : insertScript(withSave, '/js/desktop-production.js'));
  return hideInstallChrome(withProduction.replace(
    /if \('serviceWorker' in navigator\) \{[\s\S]*?\}\s*\n\s*<\/script>/,
    `if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      regs.forEach(function (reg) { reg.unregister(); });
    });
  }
</script>`,
  ));
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
  if (!headers['user-agent']) headers['user-agent'] = CHROME_UA;
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

function nodeUpstream(target, transport, url, method, headers, body, { family = undefined, rejectUnauthorized = true } = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      protocol: target.protocol,
      hostname: target.hostname,
      servername: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      method,
      path: url.pathname + url.search,
      headers: Object.assign({ 'user-agent': CHROME_UA }, headers || {}),
      timeout: 12000,
      rejectUnauthorized,
    };
    if (family) options.family = family;
    const upstream = transport.request(options, (pres) => {
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
    const headed = Object.assign({ 'user-agent': CHROME_UA }, headers || {});
    for (const [key, value] of Object.entries(headed)) {
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

function responseText(upstream) {
  if (!upstream || upstream.body == null) return '';
  return Buffer.isBuffer(upstream.body) ? upstream.body.toString('utf8') : String(upstream.body);
}

// Chromium's net.request can accept the call and still omit x-device-id. The
// shop then treats this till as a different device and signs it out. Node
// sends the header we set. A real other-device sign-in still answers 401.
function electronLostDevice(upstream, deviceId) {
  if (!deviceId || !upstream || Number(upstream.status) !== 401) return false;
  return responseText(upstream).includes('SESSION_SUPERSEDED');
}

function proxy(req, res, target, transport, url, offlineDoor) {
  readBody(req).then(async (body) => {
    const method = req.method || 'GET';
    const pageHeaders = browserHeaders(req.headers);
    const deviceId = pageHeaders['x-device-id'] || '';
    let upstream = null;
    if (target.protocol === 'https:' && electronNet()) {
      try {
        upstream = await netUpstream(target, url, method, pageHeaders, body);
      } catch (err) {
        upstream = null;
      }
    }
    if (electronLostDevice(upstream, deviceId)) upstream = null;
    const nodeHeaders = forwardHeaders(req.headers, { host: target.host });
    nodeHeaders['user-agent'] = CHROME_UA;
    if (deviceId) nodeHeaders['x-device-id'] = deviceId;
    const nodeTries = [
      () => nodeUpstream(target, transport, url, method, nodeHeaders, body),
      () => nodeUpstream(target, transport, url, method, nodeHeaders, body, { family: 4 }),
    ];
    if (target.protocol === 'https:') {
      nodeTries.push(() => nodeUpstream(target, transport, url, method, nodeHeaders, body, { rejectUnauthorized: false }));
    }
    for (const attempt of nodeTries) {
      if (upstream) break;
      try {
        upstream = await attempt();
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

module.exports = { startServer, desktopIndex, safeFile, browserHeaders, electronLostDevice };
