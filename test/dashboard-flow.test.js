'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { startServer } = require('../electron/server');

const desktopSource = fs.readFileSync(path.join(__dirname, '../public/js/desktop-production.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(__dirname, '../../stockridge/public/js/api.js'), 'utf8');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function json(res, status, body, delay = 0) {
  const send = () => {
    if (res.destroyed) return;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (delay) setTimeout(send, delay);
  else send();
}

function mockUpstream(name, routes, counts) {
  return http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const key = `${name} ${req.method} ${req.url}`;
      counts[key] = (counts[key] || 0) + 1;
      (routes[req.url] || (() => json(res, 200, { ok: true })))(req, res);
    });
  });
}

async function mockDesktop(primaryRoutes, fallbackRoutes) {
  const counts = {};
  const primary = mockUpstream('primary', primaryRoutes, counts);
  const fallback = mockUpstream('fallback', fallbackRoutes, counts);
  await listen(primary);
  await listen(fallback);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-dashboard-flow-'));
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public/index.html'), '<html></html>');
  const desktop = await startServer({
    root,
    origin: `http://127.0.0.1:${primary.address().port}`,
    fallbackOrigin: `http://127.0.0.1:${fallback.address().port}`,
    host: '127.0.0.1',
    port: 0,
  });
  return {
    counts,
    desktop,
    async cleanup() {
      await desktop.close();
      await close(primary);
      await close(fallback);
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function storage() {
  const values = {};
  return {
    getItem(key) { return values[key] || null; },
    setItem(key, value) { values[key] = String(value); },
    removeItem(key) { delete values[key]; },
  };
}

function loadDesktopApi(desktopUrl) {
  const document = {
    head: { appendChild() {} },
    documentElement: { appendChild() {} },
    body: { classList: { add() {} } },
    getElementById() { return null; },
    querySelectorAll() { return []; },
    createElement() { return { style: {}, classList: { add() {} } }; },
  };
  const context = {
    console,
    URL,
    URLSearchParams,
    AbortController,
    DOMException,
    Headers,
    Response,
    document,
    stockridgeNative: { store: {
      async metaGet() { return null; },
      async metaSet() {},
    } },
    localStorage: storage(),
    sessionStorage: storage(),
    setInterval() { return 0; },
    clearInterval() {},
    setTimeout(fn, ms, ...args) {
      if (ms === 30) return 0;
      return setTimeout(fn, ms, ...args);
    },
    clearTimeout,
    addEventListener() {},
    removeEventListener() {},
    fetch(input, init) {
      const target = new URL(String(input && input.url || input), desktopUrl);
      return fetch(target, init);
    },
    SR: { store: {}, state: { user: null } },
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(apiSource, context, { filename: 'api.js' });
  vm.runInNewContext(desktopSource, context, { filename: 'desktop-production.js' });
  context.SR.api.setToken('synthetic-dashboard-token');
  return context.SR;
}

test('a valid dashboard answer beyond the old path limit reaches the screen API', async () => {
  const dashboard = { ok: true, date: '2026-11-06', today: { count: 1, gross: 2500 }, stock: { units: 8 } };
  const pair = await mockDesktop({
    '/api/dashboard': (req, res) => json(res, 200, dashboard, 5000),
    '/api/health': (req, res) => json(res, 200, { ok: true }),
  }, {
    '/api/dashboard': (req, res) => json(res, 200, dashboard, 5000),
    '/api/health': (req, res) => json(res, 200, { ok: true }),
  });
  try {
    const SR = loadDesktopApi(pair.desktop.url);
    const out = await SR.api.get('/api/dashboard', { timeoutMs: 25000 });
    assert.equal(out.ok, true);
    assert.equal(out.today.gross, 2500);
    assert.equal(pair.counts['primary GET /api/dashboard'], 1);
    assert.equal(pair.counts['fallback GET /api/dashboard'], undefined);
    assert.equal(pair.counts['primary GET /api/health'], undefined);
  } finally {
    await pair.cleanup();
  }
});
