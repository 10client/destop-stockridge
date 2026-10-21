'use strict';
// Local origin for the desktop window. Static files come from the StockRidge
// checkout. /api is forwarded to the Worker. The Turso token never comes here.

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
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

function startServer({ root, origin, cacheRoot = null, host = '127.0.0.1', port = 0, offlineDoor = null, onAcceptedLogin = null } = {}) {
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
      proxy(req, res, target, transport, url, offlineDoor, onAcceptedLogin);
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
  const cachedOk = Boolean(cached && fs.existsSync(cached) && !fs.statSync(cached).isDirectory());
  const bundledOk = Boolean(bundled && fs.existsSync(bundled) && !fs.statSync(bundled).isDirectory());
  const choice = chooseStaticFile(bundledOk, cachedOk);
  const file = choice === 'bundled' ? bundled : (choice === 'cached' ? cached : null);
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

function withBodyLength(headers, body) {
  const next = Object.assign({}, headers || {});
  if (body && body.length) next['content-length'] = String(body.length);
  return next;
}

function bodyIsGzip(body) {
  return Buffer.isBuffer(body) && body.length >= 2 && body[0] === 0x1f && body[1] === 0x8b;
}

// Chromium's net.request decodes gzip and still reports content-encoding: gzip.
// Forwarding that pair makes the window fail the next call with "Failed to fetch"
// after sign-in has already succeeded. Tell the window the truth about the bytes
// we are actually sending.
function responseForWindow(headers, body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body || '');
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const name = String(key).toLowerCase();
    if (HOP.has(name) || name === 'content-length' || name === 'content-encoding' || value == null) continue;
    out[name] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  if (bodyIsGzip(buf)) {
    const encoding = headers && (headers['content-encoding'] || headers['Content-Encoding']);
    if (encoding) out['content-encoding'] = Array.isArray(encoding) ? encoding.join(', ') : String(encoding);
  }
  out['content-length'] = String(buf.length);
  return out;
}

// The screen cache is the last PWA deploy. It must not hide a till fix that is
// already in this program. A file we shipped wins. The cache only fills a gap.
function chooseStaticFile(bundledExists, cachedExists) {
  if (bundledExists) return 'bundled';
  if (cachedExists) return 'cached';
  return null;
}

function nodeUpstream(target, transport, url, method, headers, body, { family = undefined, rejectUnauthorized = true, timeout = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      protocol: target.protocol,
      hostname: target.hostname,
      servername: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      method,
      path: url.pathname + url.search,
      headers: withBodyLength(Object.assign({ 'user-agent': CHROME_UA, 'accept-encoding': 'identity' }, headers || {}, { 'accept-encoding': 'identity' }), body),
      timeout,
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

function netUpstream(target, url, method, headers, body, { timeout = 12000 } = {}) {
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
    }, timeout);
    const fail = (err) => {
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error('The shop server could not be reached.'));
    };
    const headed = withBodyLength(Object.assign({ 'user-agent': CHROME_UA }, headers || {}), body);
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

// A Cloudflare block or an HTML page is not a login. A token is. A PIN
// refusal is. Anything else is a path that did not answer, so the next path
// may still store this person.
// Node does not decode gzip. A compressed shop login is not a failed login.
// Treating it as a miss opens the saved till and says the sign-in has expired
// even though the person is online. Decode first, then judge the answer.
function decodeUpstream(upstream) {
  if (!upstream || upstream.body == null) return upstream;
  const buf = Buffer.isBuffer(upstream.body) ? upstream.body : Buffer.from(upstream.body || '');
  const headers = Object.assign({}, upstream.headers || {});
  if (!bodyIsGzip(buf)) {
    delete headers['content-encoding'];
    delete headers['Content-Encoding'];
    return { status: upstream.status, headers, body: buf };
  }
  try {
    const plain = zlib.gunzipSync(buf);
    delete headers['content-encoding'];
    delete headers['Content-Encoding'];
    delete headers['content-length'];
    delete headers['Content-Length'];
    return { status: upstream.status, headers, body: plain };
  } catch (err) {
    return { status: upstream.status, headers: upstream.headers, body: buf };
  }
}

function loginAnswer(upstream) {
  if (!upstream || upstream.status == null) return null;
  const status = Number(upstream.status);
  const text = responseText(upstream);
  if (status === 200) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && parsed.token && !parsed.offline) return upstream;
    } catch (err) { /* not a shop login */ }
    return null;
  }
  if (status === 400 || status === 401 || status === 429) {
    if (/BAD_CREDENTIALS|BAD_REQUEST|ACCOUNT_DEACTIVATED|ACCOUNT_UNAVAILABLE|LOGIN_LOCKED|Username or PIN/i.test(text)) return upstream;
  }
  return null;
}

function acceptedLogin(requestBody, upstream) {
  if (!upstream || Number(upstream.status) !== 200) return null;
  let sent;
  let got;
  try {
    sent = JSON.parse(Buffer.isBuffer(requestBody) ? requestBody.toString('utf8') : String(requestBody || ''));
    got = JSON.parse(responseText(upstream));
  } catch (err) {
    return null;
  }
  if (!got || got.offline || !got.token) return null;
  const username = sent && sent.username;
  const pin = sent && sent.pin;
  if (!username || pin == null || pin === '') return null;
  return {
    username: String(username).trim().toLowerCase(),
    pin: String(pin),
    profile: got.profile || got.user || { username },
    token: got.token,
    scope: got.scope || null,
  };
}

// One login request at a time. Two parallel logins would sign the same account
// out of itself. This is not the window calling the Worker. A path that does
// not return a real login answer is not kept, or a new person is never stored.
async function loginUpstream(target, transport, url, method, pageHeaders, nodeHeaders, body) {
  const tries = [];
  if (target.protocol === 'https:' && electronNet()) {
    tries.push(() => netUpstream(target, url, method, pageHeaders, body, { timeout: 8000 }));
  }
  tries.push(() => nodeUpstream(target, transport, url, method, nodeHeaders, body, { timeout: 8000 }));
  tries.push(() => nodeUpstream(target, transport, url, method, nodeHeaders, body, { family: 4, timeout: 8000 }));
  if (target.protocol === 'https:') {
    tries.push(() => nodeUpstream(target, transport, url, method, nodeHeaders, body, {
      family: 4,
      rejectUnauthorized: false,
      timeout: 6000,
    }));
  }
  for (const attempt of tries) {
    try {
      const upstream = loginAnswer(decodeUpstream(await attempt()));
      if (upstream) return upstream;
    } catch (err) { /* this path did not answer a login */ }
  }
  return null;
}

// A health check is how the till decides it is online. Give that one path long
// enough for a slow shop to answer. A normal screen read stays short so the
// window is not still waiting when it gives up and paints Offline.
function readBudgets(pathname) {
  const pathName = String(pathname || '');
  if (pathName === '/api/health' || pathName === '/api/health/ping') {
    return { net: 12000, node: 10000, v4: 0, insecure: 0 };
  }
  return { net: 5000, node: 5000, v4: 4000, insecure: 4000 };
}

function proxy(req, res, target, transport, url, offlineDoor, onAcceptedLogin) {
  readBody(req).then(async (body) => {
    const method = req.method || 'GET';
    const pageHeaders = browserHeaders(req.headers);
    const deviceId = pageHeaders['x-device-id'] || '';
    const nodeHeaders = forwardHeaders(req.headers, { host: target.host });
    nodeHeaders['user-agent'] = CHROME_UA;
    if (deviceId) nodeHeaders['x-device-id'] = deviceId;
    const login = method === 'POST' && url.pathname === '/api/auth/login';
    let upstream = null;
    if (login) {
      upstream = await loginUpstream(target, transport, url, method, pageHeaders, nodeHeaders, body);
      const accepted = acceptedLogin(body, upstream);
      if (accepted && typeof onAcceptedLogin === 'function') {
        try { onAcceptedLogin(accepted); } catch (err) { /* the shop already accepted this person */ }
      }
    } else {
      // A read must answer before the window's 20 second wait. Login is allowed
      // longer. If this read is still trying when the window gives up, a
      // connected sign-in is painted as offline.
      const budget = readBudgets(url.pathname);
      if (target.protocol === 'https:' && electronNet() && budget.net) {
        try {
          upstream = await netUpstream(target, url, method, pageHeaders, body, { timeout: budget.net });
        } catch (err) {
          upstream = null;
        }
      }
      if (electronLostDevice(upstream, deviceId)) upstream = null;
      const nodeTries = [];
      if (budget.node) nodeTries.push(() => nodeUpstream(target, transport, url, method, nodeHeaders, body, { timeout: budget.node }));
      if (budget.v4) nodeTries.push(() => nodeUpstream(target, transport, url, method, nodeHeaders, body, { family: 4, timeout: budget.v4 }));
      if (target.protocol === 'https:' && budget.insecure) {
        nodeTries.push(() => nodeUpstream(target, transport, url, method, nodeHeaders, body, { rejectUnauthorized: false, timeout: budget.insecure }));
      }
      for (const attempt of nodeTries) {
        if (upstream) break;
        try {
          upstream = await attempt();
        } catch (err) {
          upstream = null;
        }
      }
    }
    if (upstream) {
      if (res.headersSent) return;
      const plain = decodeUpstream(upstream);
      res.writeHead(plain.status, responseForWindow(plain.headers, plain.body));
      res.end(plain.body);
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

module.exports = { startServer, desktopIndex, safeFile, browserHeaders, electronLostDevice, withBodyLength, responseForWindow, chooseStaticFile, loginAnswer, acceptedLogin, decodeUpstream, readBudgets };
