'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DeviceStore } = require('../lib/device-store');
const { encode } = require('../lib/escpos');
const { applyHolds } = require('../lib/stock-hold');
const { startHub, SECRET_HEADER } = require('../lib/hub');
const { isNewer, writeManifest, verifyFile } = require('../lib/updates');
const { matches } = require('../lib/offline-auth');

function tempStore(key) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-prod-'));
  return { store: new DeviceStore(path.join(dir, 'till.db'), { key }), dir };
}

test('SQLCipher hides a product name and still opens with the same key', () => {
  const key = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
  const { store, dir } = tempStore(key);
  store.putMany('products', [{ id: 'p1', name: 'Bag of rice', updated_at: '2026-10-20 12:00:00' }]);
  const file = store.file;
  store.close();
  const raw = fs.readFileSync(file);
  assert.equal(raw.includes(Buffer.from('Bag of rice')), false);
  assert.notEqual(raw.subarray(0, 16).toString('utf8'), 'SQLite format 3\0');
  const again = new DeviceStore(file, { key });
  assert.equal(again.get('products', 'p1').name, 'Bag of rice');
  assert.equal(again.info().cipher, 'sqlcipher');
  again.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a plaintext till is rekeyed rather than left readable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-rekey-'));
  const file = path.join(dir, 'till.db');
  const plain = new DeviceStore(file);
  plain.putMany('products', [{ id: 'p1', name: 'Open bag', updated_at: '2026-10-20 12:00:00' }]);
  plain.close();
  const key = 'ff'.repeat(32);
  const locked = new DeviceStore(file, { key });
  assert.equal(locked.get('products', 'p1').name, 'Open bag');
  locked.close();
  assert.equal(fs.readFileSync(file).includes(Buffer.from('Open bag')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('offline sign-in keeps a verifier and not the PIN', () => {
  const { store } = tempStore();
  store.rememberVerifier('Ada', '48291', { id: 'u1', username: 'Ada', pin: '48291', pin_hash: 'nope' });
  const user = store.checkVerifier('ada', '48291');
  assert.equal(user.username, 'Ada');
  assert.equal(user.pin, undefined);
  assert.equal(user.pin_hash, undefined);
  assert.equal(store.checkVerifier('ada', '11111'), null);
  const raw = JSON.stringify(store.exportAll());
  assert.equal(raw.includes('48291'), false);
  store.close();
});

test('a queued sale holds stock and a sync releases it', () => {
  const { store } = tempStore();
  store.reserveFromSale({
    client_id: 'op1',
    device_id: 'till-a',
    payload: { lines: [{ product_id: 'rice', quantity: 2 }] },
  });
  assert.equal(store.reservedByProduct().rice, 2);
  const held = applyHolds([{ product_id: 'rice', quantity: 5, quantity_reserved: 1 }], store.reservedByProduct());
  assert.equal(held[0].quantity_reserved, 3);
  store.markSynced('op1', 'sale-1');
  assert.equal(store.reservedByProduct().rice, undefined);
  store.close();
});

test('the LAN hub shares a hold and refuses a Turso token', async () => {
  const { store } = tempStore();
  store.putMany('products', [{ id: 'rice', name: 'Rice', updated_at: '2026-10-20 12:00:00' }]);
  const secret = 'hub-secret-value-1';
  const hub = await startHub({ store, secret, host: '127.0.0.1', port: 0 });
  try {
    const denied = await fetch(hub.url + '/hub/v1/health');
    assert.equal(denied.status, 401);
    const headers = { 'Content-Type': 'application/json', [SECRET_HEADER]: secret };
    const health = await fetch(hub.url + '/hub/v1/health', { headers });
    assert.equal((await health.json()).ok, true);
    const bad = await fetch(hub.url + '/hub/v1/reservations', {
      method: 'POST',
      headers,
      body: JSON.stringify({ client_id: 'op1', product_id: 'rice', qty: 1, authToken: 'turso-token' }),
    });
    assert.equal(bad.status, 400);
    const ok = await fetch(hub.url + '/hub/v1/reservations', {
      method: 'POST',
      headers,
      body: JSON.stringify({ client_id: 'op1', product_id: 'rice', qty: 1, till_id: 'till-b' }),
    });
    assert.equal((await ok.json()).ok, true);
    const mirror = await fetch(hub.url + '/hub/v1/mirror', { headers });
    const body = await mirror.json();
    assert.equal(body.tables.products.rows[0].name, 'Rice');
    assert.equal(body.reservations.rice, 1);
    assert.equal(JSON.stringify(body).includes('turso'), false);
  } finally {
    await hub.close();
    store.close();
  }
});

test('an update is offered only when the hash matches', () => {
  assert.equal(isNewer('0.1.0', '0.1.1'), true);
  assert.equal(isNewer('0.2.0', '0.1.9'), false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-upd-'));
  const fileName = 'StockRidge-0.1.1-win-x64.exe';
  fs.writeFileSync(path.join(dir, fileName), 'not a real exe');
  const manifest = writeManifest({ dir, version: '0.1.1', fileName });
  assert.equal(verifyFile(path.join(dir, fileName), manifest.sha256), true);
  assert.equal(verifyFile(path.join(dir, fileName), 'ab'.repeat(32)), false);
});

test('ESC/POS starts a slip and can kick the drawer without storing the text as a secret', () => {
  const bytes = encode('Rice  500', { drawer: true });
  assert.equal(bytes[0], 0x1b);
  assert.equal(bytes[1], 0x40);
  assert.equal(bytes.includes(0x70), true);
  assert.equal(matches('48291', { salt: 'aa', hash: 'bb' }), false);
});
