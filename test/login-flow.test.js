'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {
  startServer,
  LOGIN_PROXY_WAIT_MS,
} = require('../electron/server');
const { LOGIN_WINDOW_WAIT_MS } = require('../public/js/desktop-production');

const desktopSource = fs.readFileSync(path.join(__dirname, '../public/js/desktop-production.js'), 'utf8');

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
      const route = routes[req.url] || (() => json(res, 200, { ok: true }));
      route(req, res);
    });
  });
}

async function mockDesktop(primaryRoutes, fallbackRoutes) {
  const counts = {};
  const primary = mockUpstream('primary', primaryRoutes, counts);
  const fallback = mockUpstream('fallback', fallbackRoutes, counts);
  await listen(primary);
  await listen(fallback);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-login-flow-'));
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

function loadDesktopLogin(desktopUrl, saved = {}) {
  const values = {
    device_label: 'Windows test till',
    offline_users: saved.offlineUsers || {},
    me: saved.me || null,
  };
  const calls = { rememberVerifier: 0, probe: 0, tokens: [] };
  const profile = saved.me && saved.me.user;
  const native = {
    store: {
      async metaGet(key) { return values[key] == null ? null : values[key]; },
      async metaSet(key, value) { values[key] = value; },
      async rememberVerifier() { calls.rememberVerifier += 1; },
      async checkVerifier(username, pin) {
        if (!saved.offlineVerified || !profile) return null;
        return username === profile.username && pin === '0000' ? profile : null;
      },
      async hasVerifier(username) {
        return Boolean(saved.offlineVerified && profile && username === profile.username);
      },
    },
  };
  const storage = { 'sr.deviceId': 'SR-TEST-TILL-0001' };
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
    atob,
    document,
    stockridgeNative: native,
    localStorage: {
      getItem(key) { return storage[key] || null; },
      setItem(key, value) { storage[key] = String(value); },
    },
    setInterval() { return 0; },
    clearInterval() {},
    setTimeout(fn, ms, ...args) {
      // Leave the optional chrome/save-status installers dormant. Login is
      // installed synchronously before this readiness poll.
      if (ms === 30) return 0;
      return setTimeout(fn, ms, ...args);
    },
    clearTimeout,
    fetch(input, init) {
      const target = new URL(String(input && input.url || input), desktopUrl);
      return fetch(target, init);
    },
    SR: {
      api: {
        async login() { throw new Error('the desktop login wrapper was not installed'); },
        setToken(token) { calls.tokens.push(token); },
        noteReachable() {},
        emit() {},
        async probe() { calls.probe += 1; return false; },
      },
      state: { user: null },
      store: {},
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(desktopSource, context, { filename: 'desktop-production.js' });
  return { SR: context.SR, calls, values };
}

function loginCount(counts) {
  return Object.entries(counts).reduce((total, [key, count]) => (
    total + (key.endsWith('POST /api/auth/login') ? count : 0)
  ), 0);
}

test('a delayed fallback sign-in is validated by its own host and is not repeated', async () => {
  const profile = { id: 'u-local', username: 'timing-probe', fullName: 'Local Timing Probe' };
  const pair = await mockDesktop({
    '/api/auth/login': (req, res) => json(res, 502, { error: 'login gateway unavailable' }),
    '/api/auth/me': (req, res) => json(res, 401, { code: 'BAD_TOKEN', error: 'Invalid token signature' }),
    '/api/health': (req, res) => json(res, 200, { ok: true }),
  }, {
    '/api/auth/login': (req, res) => json(res, 200, { token: 'synthetic-fallback-token', profile }, 75),
    '/api/auth/me': (req, res) => json(res, 200, { user: profile }),
    '/api/health': (req, res) => json(res, 200, { ok: true }),
  });
  try {
    const { SR, calls } = loadDesktopLogin(pair.desktop.url);
    const out = await SR.api.login({ username: 'timing-probe', pin: '0000', remember: true });
    assert.equal(out.token, 'synthetic-fallback-token');
    assert.equal(out.offline, undefined);
    assert.equal(pair.counts['fallback POST /api/auth/login'], 1);
    assert.equal(pair.counts['fallback GET /api/auth/me'], 1);
    assert.equal(loginCount(pair.counts), 3); // two fast primary paths, then one fallback
    assert.equal(calls.rememberVerifier, 1);
  } finally {
    await pair.cleanup();
  }
});

test('a health answer does not turn one click into two full login sequences', async () => {
  const pair = await mockDesktop({
    '/api/auth/login': (req, res) => json(res, 502, { error: 'login gateway unavailable' }),
    '/api/health': (req, res) => json(res, 200, { ok: true }),
  }, {
    '/api/auth/login': (req, res) => json(res, 502, { error: 'login gateway unavailable' }),
    '/api/health': (req, res) => json(res, 200, { ok: true }),
  });
  try {
    const { SR } = loadDesktopLogin(pair.desktop.url);
    await assert.rejects(
      SR.api.login({ username: 'timing-probe', pin: '0000', remember: true }),
      (err) => err && err.code === 'LOGIN_NOT_STUCK',
    );
    assert.equal(loginCount(pair.counts), 4); // two serialized paths on each host, once only
  } finally {
    await pair.cleanup();
  }
});

test('a real PIN refusal stays a credential error and never asks the sibling', async () => {
  const pair = await mockDesktop({
    '/api/auth/login': (req, res) => json(res, 401, { code: 'BAD_CREDENTIALS', error: 'Username or PIN is incorrect.' }),
  }, {
    '/api/auth/login': (req, res) => json(res, 200, { token: 'must-not-be-used' }),
  });
  try {
    const { SR } = loadDesktopLogin(pair.desktop.url);
    await assert.rejects(
      SR.api.login({ username: 'timing-probe', pin: '0000', remember: true }),
      (err) => err && err.code === 'BAD_CREDENTIALS' && /Username or PIN/.test(err.message),
    );
    assert.equal(pair.counts['primary POST /api/auth/login'], 1);
    assert.equal(pair.counts['fallback POST /api/auth/login'], undefined);
  } finally {
    await pair.cleanup();
  }
});

test('a genuine outage still opens only the saved offline person', async () => {
  const deadPrimary = http.createServer();
  const deadFallback = http.createServer();
  await listen(deadPrimary);
  await listen(deadFallback);
  const primaryPort = deadPrimary.address().port;
  const fallbackPort = deadFallback.address().port;
  await close(deadPrimary);
  await close(deadFallback);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-login-offline-'));
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public/index.html'), '<html></html>');
  const desktop = await startServer({
    root,
    origin: `http://127.0.0.1:${primaryPort}`,
    fallbackOrigin: `http://127.0.0.1:${fallbackPort}`,
    host: '127.0.0.1',
    port: 0,
  });
  try {
    const user = { id: 'u-saved', username: 'saved-person', fullName: 'Saved Person' };
    const { SR } = loadDesktopLogin(desktop.url, {
      offlineVerified: true,
      me: { user },
      offlineUsers: { 'saved-person': { me: { user }, token: null } },
    });
    const out = await SR.api.login({ username: 'saved-person', pin: '0000', remember: true });
    assert.equal(out.offline, true);
    assert.equal(out.token, null);
    assert.equal(out.user.username, 'saved-person');
  } finally {
    await desktop.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('when both hosts reject a token, primary BAD_TOKEN remains honest', async () => {
  const refusal = { code: 'BAD_TOKEN', error: 'Invalid token signature' };
  const pair = await mockDesktop({
    '/api/auth/me': (req, res) => json(res, 401, refusal),
  }, {
    '/api/auth/me': (req, res) => json(res, 401, refusal),
  });
  try {
    const response = await fetch(pair.desktop.url + 'api/auth/me', {
      headers: { Authorization: 'Bearer synthetic-invalid-token' },
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, 'BAD_TOKEN');
    assert.equal(pair.counts['primary GET /api/auth/me'], 1);
    assert.equal(pair.counts['fallback GET /api/auth/me'], 1);
  } finally {
    await pair.cleanup();
  }
});

test('an explicit foreign signature can hand a one-shot write to its issuer once', async () => {
  const pair = await mockDesktop({
    '/api/purchase-orders': (req, res) => json(res, 401, { code: 'BAD_TOKEN', error: 'Invalid token signature' }),
  }, {
    '/api/purchase-orders': (req, res) => json(res, 200, { ok: true, poNumber: 'PO-LOCAL-1' }),
  });
  try {
    const response = await fetch(pair.desktop.url + 'api/purchase-orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer synthetic-fallback-token',
        'Idempotency-Key': 'local-po-1',
      },
      body: JSON.stringify({ supplier_id: 's-local', items: [{ product_id: 'p-local', quantity: 1 }] }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).poNumber, 'PO-LOCAL-1');
    assert.equal(pair.counts['primary POST /api/purchase-orders'], 1);
    assert.equal(pair.counts['fallback POST /api/purchase-orders'], 1);
  } finally {
    await pair.cleanup();
  }
});

test('renderer cancellation closes the active login and starts no later path or host', async () => {
  const attempts = [];
  let closed = 0;
  const primary = http.createServer((req, res) => {
    attempts.push(Date.now());
    req.resume();
    res.on('close', () => { closed += 1; });
    // Cancellation after upstream headers must also settle the body stream.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"token":');
  });
  const fallback = http.createServer((req, res) => {
    attempts.push(Date.now());
    req.resume();
    res.on('close', () => { closed += 1; });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"token":');
  });
  await listen(primary);
  await listen(fallback);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-login-cancel-'));
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public/index.html'), '<html></html>');
  const desktop = await startServer({
    root,
    origin: `http://127.0.0.1:${primary.address().port}`,
    fallbackOrigin: `http://127.0.0.1:${fallback.address().port}`,
    host: '127.0.0.1',
    port: 0,
  });
  try {
    const controller = new AbortController();
    const waiting = fetch(desktop.url + 'api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'timing-probe', pin: '0000' }),
      signal: controller.signal,
    }).catch((err) => err);
    await new Promise((resolve) => setTimeout(resolve, 150));
    controller.abort();
    await waiting;
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(attempts.length, 1);
    assert.equal(closed, 1, 'the upstream response must close when the renderer goes away');
    // The old first Node path would time out here and start another login.
    await new Promise((resolve) => setTimeout(resolve, 8300));
    assert.equal(attempts.length, 1);
  } finally {
    await desktop.close();
    await close(primary);
    await close(fallback);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the proxy login cap covers two serialized hosts and finishes before the renderer', () => {
  assert.ok(LOGIN_PROXY_WAIT_MS >= 60000);
  assert.ok(LOGIN_PROXY_WAIT_MS < LOGIN_WINDOW_WAIT_MS);
  assert.equal(LOGIN_WINDOW_WAIT_MS - LOGIN_PROXY_WAIT_MS, 5000);
});
