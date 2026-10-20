'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, desktopIndex } = require('../electron/server');

test('index injection loads the SQLite bridge and does not register a service worker', () => {
  const html = '<script src="/js/store.js?v=1"></script>\n<script>\n  if (\'serviceWorker\' in navigator) {\n    window.addEventListener(\'load\', function () {\n      navigator.serviceWorker.register(\'/sw.js\', { scope: \'/\' }).catch(function () {});\n    });\n  }\n</script>\n';
  const out = desktopIndex(html);
  assert.match(out, /store-native\.js/);
  assert.match(out, /save-status\.js[\s\S]*desktop-production\.js/);
  assert.match(out, /sr-native-install/);
  assert.match(out, /#install-btn,#nav-install,#login-install,\.chip-install,\.nav-install\{display:none!important\}/);
  const withButtons = '<head></head><body><button id="install-btn">Download</button><button id="nav-install">Install</button><button id="login-install">Download onto this device</button><button class="chip" id="install-btn" type="button">\n  <span>Download</span>\n</button></body>';
  const stripped = desktopIndex(withButtons);
  assert.doesNotMatch(stripped, /id="install-btn"/);
  assert.doesNotMatch(stripped, /id="nav-install"/);
  assert.doesNotMatch(stripped, /id="login-install"/);
  assert.doesNotMatch(out, /serviceWorker\.register/);
  assert.match(out, /unregister/);
});

test('serves the UI from the checkout and proxies /api without accepting a path escape', async () => {
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ path: req.url, auth: req.headers.authorization || null }));
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
    assert.doesNotMatch(html, /serviceWorker\.register/);
    const api = await fetch(desktop.url + 'api/health', { headers: { Authorization: 'Bearer test-token' } });
    const body = await api.json();
    assert.equal(body.path, '/api/health');
    assert.equal(body.auth, 'Bearer test-token');
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
