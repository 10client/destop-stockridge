'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DeviceStore } = require('../lib/device-store');

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-till-'));
  const store = new DeviceStore(path.join(dir, 'till.db'));
  return { store, dir };
}

test('opens WAL, migrates once, and refuses a PIN hash', () => {
  const { store } = tempStore();
  const info = store.info();
  assert.equal(info.engine, 'sqlite');
  assert.equal(info.migration, 4);
  assert.equal(info.journal.toLowerCase(), 'wal');
  store.putMany('users', [{ id: 'u1', full_name: 'Ada', pin_hash: 'secret', updated_at: '2026-10-20 10:00:00' }]);
  const row = store.get('users', 'u1');
  assert.equal(row.full_name, 'Ada');
  assert.equal(row.pin_hash, undefined);
  store.close();
});

test('replaces a mirror row and keeps the server timestamp', () => {
  const { store } = tempStore();
  store.putMany('products', [{ id: 'p1', name: 'Bag', updated_at: '2026-10-20 09:00:00' }]);
  store.putMany('products', [{ id: 'p1', name: 'Bag of rice', updated_at: '2026-10-20 11:00:00' }]);
  assert.equal(store.all('products').length, 1);
  assert.equal(store.get('products', 'p1').name, 'Bag of rice');
  assert.equal(store.tableStats().latestUpdatedAt, '2026-10-20 11:00:00');
  store.close();
});

test('outbox update keeps the original queue time and a failed row leaves the pending count', () => {
  const { store } = tempStore();
  store.outboxPut({ client_id: 'op1', status: 'PENDING', at: '2026-10-20T10:00:00.000Z', type: 'SALE' });
  store.outboxUpdate('op1', { attempts: 1, status: 'PENDING' });
  assert.equal(store.outboxGet('op1').at, '2026-10-20T10:00:00.000Z');
  store.markFailed('op1', { code: 'NO', message: 'refused' });
  assert.equal(store.outboxCount(), 0);
  assert.equal(store.outboxGet('op1').status, 'FAILED');
  store.requeue('op1');
  assert.equal(store.pending().length, 1);
  store.markSynced('op1', 'sale-9');
  assert.equal(store.outboxGet('op1').server_ref, 'sale-9');
  store.outboxUpdate('op1', { synced_at: '2020-01-01T00:00:00.000Z' });
  assert.equal(store.purgeSynced(1), 1);
  store.close();
});

test('imports an IndexedDB backup without taking a PIN hash', () => {
  const { store } = tempStore();
  const result = store.importAll({
    format: 'stockridge-device-backup',
    version: 1,
    rows: [{ table: 'customers', id: 'c1', row: { id: 'c1', name: 'Ngozi', pin_hash: 'nope', updated_at: '2026-10-19 08:00:00' } }],
    outbox: [{ client_id: 'op9', status: 'PENDING', at: '2026-10-20T08:00:00.000Z', type: 'SALE' }],
    meta: [{ key: 'cursor', value: { products: '2026-10-19' } }],
  });
  assert.equal(result.rows, 1);
  assert.equal(store.get('customers', 'c1').name, 'Ngozi');
  assert.equal(store.get('customers', 'c1').pin_hash, undefined);
  assert.equal(store.pending()[0].client_id, 'op9');
  assert.deepEqual(store.metaGet('cursor'), { products: '2026-10-19' });
  const backup = store.exportAll();
  assert.equal(backup.format, 'stockridge-device-backup');
  assert.equal(backup.rows.length, 1);
  store.close();
});

test('a backup file can be opened and still has the sale', async () => {
  const { store, dir } = tempStore();
  store.putMany('products', [{ id: 'p9', name: 'Rice', updated_at: '2026-10-20 12:00:00' }]);
  store.outboxPut({ client_id: 'op-backup', status: 'PENDING', at: '2026-10-20T12:00:00.000Z', type: 'SALE' });
  const dest = path.join(dir, 'copy.db');
  await store.backupTo(dest);
  store.close();
  const copy = new DeviceStore(dest);
  assert.equal(copy.get('products', 'p9').name, 'Rice');
  assert.equal(copy.outboxGet('op-backup').type, 'SALE');
  copy.close();
});

test('rejects a file that is not a device backup', () => {
  const { store } = tempStore();
  assert.throws(() => store.importAll({ format: 'other' }), /not a StockRidge device backup/);
  store.close();
});
