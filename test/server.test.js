'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { startServer, desktopIndex, browserHeaders, electronLostDevice, withBodyLength, responseForWindow, chooseStaticFile, loginAnswer, acceptedLogin, decodeUpstream } = require('../electron/server');

test('the shop request does not forward the local window address', () => {
  const headers = browserHeaders({
    host: '127.0.0.1:47321',
    origin: 'http://127.0.0.1:47321',
    'content-length': '20',
    'content-type': 'application/json',
    'x-device-id': 'till-1',
  });
  assert.equal(headers.host, undefined);
  assert.equal(headers.origin, undefined);
  assert.equal(headers['content-length'], undefined);
  assert.equal(headers['content-type'], 'application/json');
  assert.equal(headers['x-device-id'], 'till-1');
});

test('a login answer is a shop token or a PIN refusal, not an HTML block', () => {
  const token = loginAnswer({ status: 200, body: Buffer.from('{"token":"abc","profile":{"username":"bola"}}') });
  assert.equal(token.status, 200);
  assert.equal(loginAnswer({ status: 403, body: Buffer.from('<html>error code: 1010</html>') }), null);
  assert.equal(loginAnswer({ status: 401, body: Buffer.from('{"code":"BAD_CREDENTIALS","error":"Username or PIN is incorrect."}') }).status, 401);
  assert.equal(loginAnswer({ status: 200, body: Buffer.from('{"ok":true}') }), null);
  const accepted = acceptedLogin(
    Buffer.from('{"username":"Bola","pin":"13579"}'),
    { status: 200, body: Buffer.from('{"token":"abc","profile":{"username":"Bola","pin":"13579"}}') },
  );
  assert.equal(accepted.username, 'bola');
  assert.equal(accepted.pin, '13579');
  assert.equal(acceptedLogin(Buffer.from('{"username":"Bola","pin":"13579"}'), { status: 401, body: Buffer.from('{"code":"BAD_CREDENTIALS"}') }), null);
  const source = fs.readFileSync(path.join(__dirname, '../electron/server.js'), 'utf8');
  assert.doesNotMatch(source, /sr-shop-direct/);
  assert.doesNotMatch(source, /Promise\.any/);
});

test('a gzip shop login is a real sign-in, not an expired offline session', () => {
  const gzip = zlib.gzipSync(Buffer.from('{"token":"live-token","profile":{"username":"bola"}}'));
  const decoded = decodeUpstream({ status: 200, headers: { 'content-encoding': 'gzip', 'content-length': String(gzip.length) }, body: gzip });
  assert.equal(JSON.parse(decoded.body.toString()).token, 'live-token');
  assert.equal(loginAnswer(decoded).status, 200);
  const headers = responseForWindow(decoded.headers, decoded.body);
  assert.equal(headers['content-encoding'], undefined);
  assert.equal(headers['content-length'], String(decoded.body.length));
});

test('a decoded shop answer is not labelled gzip, which the window reports as Failed to fetch', () => {
  const plain = Buffer.from('{"ok":true}');
  const headers = responseForWindow({ 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': '99' }, plain);
  assert.equal(headers['content-encoding'], undefined);
  assert.equal(headers['content-length'], String(plain.length));
  assert.equal(headers['content-type'], 'application/json');
  const gzip = Buffer.from([0x1f, 0x8b, 0x08, 0x00]);
  const stillGzip = responseForWindow({ 'content-encoding': 'gzip', 'content-length': '2' }, gzip);
  assert.equal(stillGzip['content-encoding'], 'gzip');
  assert.equal(stillGzip['content-length'], String(gzip.length));
});

test('a till fix already in the program is not hidden by the old PWA screen cache', () => {
  assert.equal(chooseStaticFile(true, true), 'bundled');
  assert.equal(chooseStaticFile(false, true), 'cached');
  assert.equal(chooseStaticFile(false, false), null);
});

test('a login body keeps its length so the shop can read the PIN', () => {
  const body = Buffer.from('{"username":"ada","pin":"1234"}');
  const headers = withBodyLength({ 'content-type': 'application/json' }, body);
  assert.equal(headers['content-length'], String(body.length));
  assert.equal(withBodyLength({ accept: 'application/json' }, Buffer.alloc(0))['content-length'], undefined);
});

test('a shop sign-out from the Chromium path is asked again when this till sent a device id', () => {
  const kicked = { status: 401, body: Buffer.from('{"code":"SESSION_SUPERSEDED"}') };
  assert.equal(electronLostDevice(kicked, 'till-1'), true);
  assert.equal(electronLostDevice(kicked, ''), false);
  assert.equal(electronLostDevice({ status: 200, body: Buffer.from('{}') }, 'till-1'), false);
  assert.equal(electronLostDevice({ status: 401, body: Buffer.from('{"code":"BAD_TOKEN"}') }, 'till-1'), false);
});

test('index injection loads the SQLite bridge and does not register a service worker', () => {
  const html = '<script src="/js/store.js?v=1"></script>\n<script>\n  if (\'serviceWorker\' in navigator) {\n    window.addEventListener(\'load\', function () {\n      navigator.serviceWorker.register(\'/sw.js\', { scope: \'/\' }).catch(function () {});\n    });\n  }\n</script>\n';
  const out = desktopIndex(html, 'https://sample.stockridge.workers.dev');
  assert.match(out, /store-native\.js/);
  assert.match(out, /save-status\.js[\s\S]*desktop-production\.js/);
  const beforeApp = desktopIndex('<script src="/js/store.js"></script>\n<script src="/js/app.js?v=1"></script>\n');
  assert.match(beforeApp, /desktop-production\.js"><\/script>\s*<script src="\/js\/app\.js/);
  assert.match(out, /sr-native-install/);
  assert.match(out, /#install-btn,#nav-install,#login-install,\.chip-install,\.nav-install\{display:none!important\}/);
  const withButtons = '<head></head><body><button id="install-btn">Download</button><button id="nav-install">Install</button><button id="login-install">Download onto this device</button><button class="chip" id="install-btn" type="button">\n  <span>Download</span>\n</button></body>';
  const stripped = desktopIndex(withButtons);
  assert.doesNotMatch(stripped, /id="install-btn"/);
  assert.doesNotMatch(stripped, /id="nav-install"/);
  assert.doesNotMatch(stripped, /id="login-install"/);
  assert.doesNotMatch(out, /serviceWorker\.register/);
  assert.match(out, /unregister/);
  assert.doesNotMatch(out, /sr-shop-direct/);
  assert.doesNotMatch(out, /Failed to fetch/);
  assert.doesNotMatch(out, /did not answer from this window/);
});

test('serves the UI from the checkout and proxies /api without accepting a path escape', async () => {
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ path: req.url, auth: req.headers.authorization || null, device: req.headers['x-device-id'] || null }));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upPort = upstream.address().port;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-ui-'));
  fs.mkdirSync(path.join(root, 'public', 'js'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public', 'index.html'), '<script src="/js/store.js?v=1"></script>\n<script>\n  if (\'serviceWorker\' in navigator) {\n    window.addEventListener(\'load\', function () {\n      navigator.serviceWorker.register(\'/sw.js\').catch(function () {});\n    });\n  }\n</script>\n');
  fs.writeFileSync(path.join(root, 'public', 'js', 'store-native.js'), 'window.__bridge = true;\n');
  const desktop = await startServer({
    root,
    origin: `http://127.0.0.1:${upPort}`,
    host: '127.0.0.1',
    port: 0,
  });
  try {
    const page = await fetch(desktop.url);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /store-native\.js/);
    assert.doesNotMatch(html, /sr-shop-direct/);
    assert.doesNotMatch(html, /Failed to fetch/);
    assert.doesNotMatch(html, /serviceWorker\.register/);
    const api = await fetch(desktop.url + 'api/health', { headers: { Authorization: 'Bearer test-token', 'X-Device-Id': 'till-1' } });
    const body = await api.json();
    assert.equal(body.path, '/api/health');
    assert.equal(body.auth, 'Bearer test-token');
    assert.equal(body.device, 'till-1');
    const escaped = await fetch(desktop.url + '..%2fpackage.json');
    assert.equal(escaped.status, 404);
    const health = await fetch(desktop.url + '__desktop/health');
    assert.equal((await health.json()).engine, 'sqlite');
    const saveStatus = await fetch(desktop.url + 'js/save-status.js');
    assert.equal(saveStatus.status, 200);
    assert.match(await saveStatus.text(), /SR\.saveStatus/);
    const bridge = await fetch(desktop.url + 'js/store-native.js');
    const script = await bridge.text();
    assert.equal(bridge.status, 200);
    assert.match(script, /stockridgeNative/);
    assert.doesNotMatch(script, /turso/i);
  } finally {
    await desktop.close();
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test('a shop login stores that person without storing the PIN or wiping another person', async () => {
  const upstream = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const sent = JSON.parse(raw || '{}');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        token: `token-${sent.username}`,
        profile: { id: 'u2', username: sent.username, fullName: 'Bola Ade', pin: sent.pin },
        scope: { branchId: 'b1' },
      }));
    });
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upPort = upstream.address().port;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-login-'));
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public', 'index.html'), '<head></head><body></body>');
  const people = {
    ada: { username: 'ada', token: 'ada-token' },
  };
  let desktop;
  try {
    desktop = await startServer({
      root,
      origin: `http://127.0.0.1:${upPort}`,
      host: '127.0.0.1',
      port: 0,
      onAcceptedLogin: (accepted) => {
        const profile = Object.assign({}, accepted.profile || {});
        delete profile.pin;
        delete profile.pin_hash;
        people[accepted.username] = { username: accepted.username, token: accepted.token, profile, scope: accepted.scope };
      },
    });
    const api = await fetch(desktop.url + 'api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Bola', pin: '13579' }),
    });
    const body = await api.json();
    assert.equal(api.status, 200);
    assert.equal(body.token, 'token-Bola');
    assert.equal(people.bola.profile.fullName, 'Bola Ade');
    assert.equal(people.bola.profile.pin, undefined);
    assert.equal(people.ada.token, 'ada-token');
    assert.equal(people.bola.scope.branchId, 'b1');
    const kept = JSON.stringify(people);
    assert.equal(kept.includes('13579'), false);
    assert.equal(kept.includes('48291'), false);
  } finally {
    if (desktop) await desktop.close();
    await new Promise((resolve) => upstream.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a closed shop port is an unreachable proxy response, not a successful login', async () => {
  const dead = http.createServer();
  await new Promise((resolve) => dead.listen(0, '127.0.0.1', resolve));
  const deadPort = dead.address().port;
  await new Promise((resolve) => dead.close(resolve));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-dead-'));
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public', 'index.html'), '<head></head><body></body>');
  const desktop = await startServer({
    root,
    origin: `http://127.0.0.1:${deadPort}`,
    host: '127.0.0.1',
    port: 0,
  });
  try {
    const api = await fetch(desktop.url + 'api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ada', pin: '0000' }),
    });
    const body = await api.json();
    assert.equal(api.status, 502);
    assert.equal(body.code, 'UPSTREAM_UNREACHABLE');
  } finally {
    await desktop.close();
  }
});

test('a closed shop answers the saved till instead of the proxy sentence', async () => {
  const dead = http.createServer();
  await new Promise((resolve) => dead.listen(0, '127.0.0.1', resolve));
  const deadPort = dead.address().port;
  await new Promise((resolve) => dead.close(resolve));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-door-'));
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public', 'index.html'), '<head></head><body></body>');
  const desktop = await startServer({
    root,
    origin: `http://127.0.0.1:${deadPort}`,
    host: '127.0.0.1',
    port: 0,
    offlineDoor: () => ({
      status: 200,
      body: { ok: true, offline: true, user: { username: 'ada' }, profile: { username: 'ada' } },
    }),
  });
  try {
    const api = await fetch(desktop.url + 'api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ada', pin: '2468' }),
    });
    const body = await api.json();
    assert.equal(api.status, 200);
    assert.equal(body.offline, true);
    assert.equal(body.user.username, 'ada');
    assert.doesNotMatch(JSON.stringify(body), /shop server could not be reached/i);
  } finally {
    await desktop.close();
  }
});

test('a gateway 502 is not kept when the next path is the shop', async () => {
  let n = 0;
  const upstream = http.createServer((req, res) => {
    n += 1;
    if (n === 1) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'bad gateway' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-502-'));
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public', 'index.html'), '<head></head><body></body>');
  const desktop = await startServer({
    root,
    origin: `http://127.0.0.1:${upstream.address().port}`,
    host: '127.0.0.1',
    port: 0,
  });
  try {
    const api = await fetch(desktop.url + 'api/health');
    const body = await api.json();
    assert.equal(api.status, 200);
    assert.equal(body.ok, true);
    assert.ok(n >= 2);
  } finally {
    await desktop.close();
    await new Promise((resolve) => upstream.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a write is not sent to the other host when this host does not answer', async () => {
  const dead = http.createServer();
  await new Promise((resolve) => dead.listen(0, '127.0.0.1', resolve));
  const deadPort = dead.address().port;
  await new Promise((resolve) => dead.close(resolve));
  let siblingPosts = 0;
  const live = http.createServer((req, res) => {
    if (req.method === 'POST') siblingPosts += 1;
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid token signature', code: 'TOKEN_BAD_SIGNATURE' }));
  });
  await new Promise((resolve) => live.listen(0, '127.0.0.1', resolve));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-write-once-'));
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public', 'index.html'), '<head></head><body></body>');
  const desktop = await startServer({
    root,
    origin: `http://127.0.0.1:${deadPort}`,
    fallbackOrigin: `http://127.0.0.1:${live.address().port}`,
    host: '127.0.0.1',
    port: 0,
  });
  try {
    const api = await fetch(desktop.url + 'api/purchase-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ supplier_id: 's1', items: [{ product_id: 'p1', quantity: 1 }] }),
    });
    const body = await api.json();
    assert.equal(api.status, 502);
    assert.equal(body.code, 'UPSTREAM_UNREACHABLE');
    assert.equal(siblingPosts, 0);
    assert.equal(JSON.stringify(body).includes('Invalid token signature'), false);
  } finally {
    await desktop.close();
    await new Promise((resolve) => live.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a signature from the other host does not sign the saved till out', async () => {
  const dead = http.createServer();
  await new Promise((resolve) => dead.listen(0, '127.0.0.1', resolve));
  const deadPort = dead.address().port;
  await new Promise((resolve) => dead.close(resolve));
  const live = http.createServer((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid token signature', code: 'TOKEN_BAD_SIGNATURE' }));
  });
  await new Promise((resolve) => live.listen(0, '127.0.0.1', resolve));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-hold-'));
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public', 'index.html'), '<head></head><body></body>');
  const store = {
    metaGet(key) {
      if (key === 'me') return { user: { id: 'u1', username: 'ada', fullName: 'Ada' }, scope: null, settings: {} };
      return null;
    },
    all() { return []; },
  };
  const desktop = await startServer({
    root,
    origin: `http://127.0.0.1:${deadPort}`,
    fallbackOrigin: `http://127.0.0.1:${live.address().port}`,
    host: '127.0.0.1',
    port: 0,
    offlineDoor: (call) => require('../lib/offline-door').answerWhenShopDown(store, call),
  });
  try {
    const api = await fetch(desktop.url + 'api/auth/me', {
      headers: { Authorization: 'Bearer saved-token', 'X-Device-Id': 'till-1' },
    });
    const body = await api.json();
    assert.equal(api.status, 200);
    assert.equal(body.offline, true);
    assert.equal(body.user.username, 'ada');
    assert.equal(JSON.stringify(body).includes('Invalid token signature'), false);
  } finally {
    await desktop.close();
    await new Promise((resolve) => live.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the other host answers when the primary port is closed', async () => {
  const dead = http.createServer();
  await new Promise((resolve) => dead.listen(0, '127.0.0.1', resolve));
  const deadPort = dead.address().port;
  await new Promise((resolve) => dead.close(resolve));
  const live = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });
  await new Promise((resolve) => live.listen(0, '127.0.0.1', resolve));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-sib-'));
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public', 'index.html'), '<head></head><body></body>');
  const desktop = await startServer({
    root,
    origin: `http://127.0.0.1:${deadPort}`,
    fallbackOrigin: `http://127.0.0.1:${live.address().port}`,
    host: '127.0.0.1',
    port: 0,
  });
  try {
    const api = await fetch(desktop.url + 'api/health');
    const body = await api.json();
    assert.equal(api.status, 200);
    assert.equal(body.ok, true);
  } finally {
    await desktop.close();
    await new Promise((resolve) => live.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
