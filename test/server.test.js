'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, desktopIndex, browserHeaders, electronLostDevice } = require('../electron/server');

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
