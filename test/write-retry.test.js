'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { isOneShotWrite } = require('../electron/server');
const { desktopFetchPolicy } = require('../public/js/desktop-production.js');

const sharedRoot = path.resolve(__dirname, '../../stockridge/public/js');

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function loadApi(fetch, queued, events) {
  let sequence = 0;
  const window = {
    SRReach: {
      shopAnswered: (status) => Number(status) > 0 && Number(status) < 500,
      shouldMarkOffline: () => true,
    },
    SR: {
      util: { localId: (prefix) => `${prefix}-${++sequence}`, nowWatSql: () => '2026-11-06 12:00:00' },
      device: { current: () => ({ id: 'till-1' }) },
      state: { user: { id: 'user-1' } },
      store: {
        enqueue: async (record) => {
          const row = Object.assign({ client_id: `local-${++sequence}` }, record);
          if (queued) queued.push(row);
          return row;
        },
      },
    },
    addEventListener(name, handler) {
      if (!events) return;
      if (!events[name]) events[name] = [];
      events[name].push(handler);
    },
  };
  const sandbox = {
    window,
    localStorage: storage(),
    sessionStorage: storage(),
    navigator: { onLine: true },
    fetch,
    Response,
    Headers,
    AbortController,
    DOMException,
    URLSearchParams,
    // Timers are deliberately inert: these tests reject the first fetch
    // themselves and must not leave probe/recheck intervals alive in Node.
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    console,
  };
  vm.runInNewContext(fs.readFileSync(path.join(sharedRoot, 'api.js'), 'utf8'), sandbox);
  return window.SR.api;
}

function shopHealth() {
  return {
    status: 200,
    clone() { return { text: async () => '{"ok":true}' }; },
  };
}

test('shared, renderer and proxy agree which writes are one-shot', () => {
  const api = loadApi(async () => shopHealth());
  const cases = [
    ['POST', '/api/purchase-orders', true],
    ['PATCH', '/api/products/p1', true],
    ['GET', '/api/purchase-orders', false],
    ['POST', '/api/sync/push', false],
    ['POST', '/api/sync/pull?full=1', false],
    ['POST', '/api/auth/login', false],
    ['POST', '/api/auth/login?next=1', false],
  ];
  for (const [method, url, expected] of cases) {
    assert.equal(api.isOneShotWrite(method, url), expected);
    assert.equal(isOneShotWrite(method, url), expected);
    assert.equal(desktopFetchPolicy(null, { method }, url, api).oneShot, expected);
    assert.equal(desktopFetchPolicy(null, { method }, url, null).oneShot, expected);
  }
  assert.equal(api.mayRetryRequest('POST', '/api/purchase-orders'), false);
  assert.equal(api.mayRetryRequest('POST', '/api/sync/push'), true);
  assert.equal(api.mayRetryRequest('POST', '/api/auth/login'), false);
});

test('a successful health probe completes instead of becoming a false offline miss', async () => {
  const api = loadApi(async () => shopHealth());
  assert.equal(await api.probe({ force: true }), true);
  assert.equal(api.shopConfirmed(), true);
  assert.equal(api.isOnline(), true);
});

test('a browser online event announces returned only after the shop answers', async () => {
  const events = {};
  const api = loadApi(async () => shopHealth(), null, events);
  const notices = [];
  api.on('net', (detail) => notices.push(detail));
  assert.equal(events.online.length, 1);
  events.online[0]();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(api.shopConfirmed(), true);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].online, true);
  assert.equal(notices[0].returned, true);
  assert.equal(api.catchingUp(), true);
});

test('a missed purchase-order response is not retried after health answers', async () => {
  let posts = 0;
  let probes = 0;
  const keys = [];
  const api = loadApi(async (url, init) => {
    if (url === '/api/health') { probes += 1; return shopHealth(); }
    if (url === '/api/purchase-orders') {
      posts += 1;
      keys.push(init.headers['Idempotency-Key']);
      throw new Error('Failed to fetch');
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const err = await api.post('/api/purchase-orders', { supplier_id: 's1' }).then(() => null, (caught) => caught);
  assert.equal(err && err.code, 'SHOP_READ_FAILED', `posts=${posts}, probes=${probes}, error=${err && err.stack}`);
  assert.equal(posts, 1);
  assert.equal(probes, 1);
  assert.match(keys[0], /^request-\d+$/);
});

test('a queued automatic write keeps the key from its direct attempt', async () => {
  const queued = [];
  let posts = 0;
  let requestKey = null;
  const api = loadApi(async (url, init) => {
    if (url === '/api/health') return shopHealth();
    posts += 1;
    requestKey = init.headers['Idempotency-Key'];
    throw new Error('Failed to fetch');
  }, queued);
  const result = await api.post('/api/expenses', { amount: 500 }, { queue: 'auto' });
  // enqueue is intentionally fire-and-forget in the UI; let its resolved
  // promise and queue notification finish before inspecting the captured row.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(result.queued, true);
  assert.equal(posts, 1);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].ref, requestKey);
  assert.equal(queued[0].payload._path, '/api/expenses');
});

test('replay-safe sync may retry, but it reuses the same request key', async () => {
  let posts = 0;
  const keys = [];
  const api = loadApi(async (url, init) => {
    if (url === '/api/health') return shopHealth();
    posts += 1;
    keys.push(init.headers['Idempotency-Key']);
    if (posts === 1) throw new Error('Failed to fetch');
    return new Response('{"results":{"operations":[]}}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const result = await api.post('/api/sync/push', { operations: [] });
  assert.equal(result.results.operations.length, 0);
  assert.equal(posts, 2);
  assert.equal(keys[0], keys[1]);
});

test('outbox replay separates local row identity from logical-action identity', async () => {
  const queued = [
    { client_id: 'local-1', ref: 'request-original', type: 'EXPENSE', payload: { amount: 500 }, user_id: 'user-1' },
    { client_id: 'local-2', ref: null, type: 'EXPENSE', payload: { amount: 700 }, user_id: 'user-1' },
  ];
  let sent;
  const window = {
    SR: {
      api: {
        isOnline: () => true,
        hasToken: () => true,
        post: async (url, body) => {
          assert.equal(url, '/api/sync/push');
          sent = body;
          return { results: { operations: queued.map((item) => ({ clientId: item.client_id, status: 'APPLIED', result: {} })) } };
        },
      },
      store: {
        pending: async () => queued,
        markSynced: async () => {},
        updateOutbox: async () => {},
        purgeSynced: async () => {},
        log: async () => {},
      },
      state: { user: { id: 'user-1' }, activeBranchId: 'branch-1' },
      device: { current: () => ({ id: 'till-1' }) },
      util: {},
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(sharedRoot, 'sync.js'), 'utf8'), { window, console });
  await window.SR.sync.push();
  assert.deepEqual(Array.from(sent.operations, (op) => op.client_id), ['local-1', 'local-2']);
  assert.deepEqual(Array.from(sent.operations, (op) => op.idempotency_key), ['request-original', 'local-2']);
});

test('a direct POS sale and its write-ahead row use one idempotency key', () => {
  const pos = fs.readFileSync(path.join(sharedRoot, 'views/pos.js'), 'utf8');
  assert.match(pos, /SR\.api\.post\('\/api\/sales', payload, \{ timeoutMs: 25000, idempotencyKey: queued\.clientId \}\)/);
  const desktop = fs.readFileSync(path.join(__dirname, '../public/js/desktop-production.js'), 'utf8');
  assert.match(desktop, /res\.status !== 401 \|\| policy\.oneShot/);
  assert.match(desktop, /if \(policy\.oneShot\) \{\s*noteShopResponse/);
});
