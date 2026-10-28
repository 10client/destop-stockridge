'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DeviceStore } = require('../lib/device-store');

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-shelf-'));
  const store = new DeviceStore(path.join(dir, 'till.db'));
  return store;
}

function batch(id, extra) {
  return Object.assign({
    id,
    product_id: 'fan',
    branch_id: 'shop',
    status: 'ACTIVE',
    quantity: 10,
    quantity_reserved: 0,
    received_at: '2026-10-01 10:00:00',
    expiry_date: null,
    batch_no: id,
    is_deleted: 0,
    product_name: 'Fan',
  }, extra);
}

function queueSale(store, clientId, lines, holds) {
  store.outboxPut({
    client_id: clientId,
    type: 'SALE',
    status: 'PENDING',
    payload: { lines, stock_holds: holds || [], sold_at: '2026-10-28 09:00:00' },
    occurred_at: '2026-10-28 09:00:00',
    at: '2026-10-28T09:00:00.000Z',
  });
}

test('a sale cuts the shelf once and the product stays visible', () => {
  const store = tempStore();
  store.putMany('stock_batches', [batch('b1', { quantity: 10 })]);
  queueSale(store, 'sale-1', [{ product_id: 'fan', quantity: 1, unit_code: 'PIECE' }]);
  const first = store.applySale({ client_id: 'sale-1', lines: [{ product_id: 'fan', quantity: 1, unit_code: 'PIECE' }] });
  assert.equal(first.ok, true);
  assert.equal(first.skipped, false);
  const row = store.get('stock_batches', 'b1');
  assert.equal(row.quantity, 9);
  assert.equal(row.status, 'ACTIVE');
  assert.equal(store.all('stock_batches').length, 1);
  const second = store.applySale({ client_id: 'sale-1', lines: [{ product_id: 'fan', quantity: 1, unit_code: 'PIECE' }] });
  assert.equal(second.skipped, true);
  assert.equal(store.get('stock_batches', 'b1').quantity, 9);
  store.close();
});

test('a carton uses the unit ladder, and a hire does not leave the shelf', () => {
  const store = tempStore();
  store.putMany('stock_batches', [batch('b1', { quantity: 20 })]);
  store.putMany('product_units', [{
    id: 'u1', product_id: 'fan', code: 'CTN', name: 'Carton', quantity_in_base: 12, is_deleted: 0,
  }]);
  store.applySale({
    client_id: 'sale-ctn',
    lines: [
      { product_id: 'fan', quantity: 1, unit_code: 'CTN' },
      { product_id: 'fan', quantity: 1, unit_code: 'PIECE', channel: 'HIRE' },
    ],
  });
  assert.equal(store.get('stock_batches', 'b1').quantity, 8);
  store.close();
});

test('reserved units stay reserved and the free count drops by the sale', () => {
  const store = tempStore();
  store.putMany('stock_batches', [
    batch('held', { received_at: '2026-09-01 10:00:00', quantity: 10, quantity_reserved: 8 }),
    batch('free', { received_at: '2026-10-01 10:00:00', quantity: 10, quantity_reserved: 0 }),
  ]);
  store.applySale({
    client_id: 'sale-free',
    lines: [{ product_id: 'fan', quantity: 5, unit_code: 'PIECE' }],
    sold_at: '2026-10-28 09:00:00',
  });
  assert.equal(store.get('stock_batches', 'held').quantity, 8);
  assert.equal(store.get('stock_batches', 'held').quantity_reserved, 8);
  assert.equal(store.get('stock_batches', 'free').quantity, 7);
  store.close();
});

test('a download does not restore the old count, and a second replay does not cut again', () => {
  const store = tempStore();
  store.putMany('stock_batches', [batch('b1', { quantity: 10 })]);
  queueSale(store, 'sale-1', [{ product_id: 'fan', quantity: 1, unit_code: 'PIECE' }]);
  store.applySale({ client_id: 'sale-1', lines: [{ product_id: 'fan', quantity: 1, unit_code: 'PIECE' }] });
  assert.equal(store.get('stock_batches', 'b1').quantity, 9);
  store.putMany('stock_batches', [batch('b1', { quantity: 10 })]);
  assert.equal(store.get('stock_batches', 'b1').quantity, 10);
  const replayed = store.replayShelf();
  assert.equal(replayed.skipped, false);
  assert.equal(store.get('stock_batches', 'b1').quantity, 9);
  assert.equal(store.get('stock_batches', 'b1').status, 'ACTIVE');
  const again = store.replayShelf();
  assert.equal(again.skipped, true);
  assert.equal(store.get('stock_batches', 'b1').quantity, 9);
  store.close();
});

test('this till\'s own hold does not hide the remaining units', () => {
  const store = tempStore();
  store.putMany('stock_batches', [batch('b1', { quantity: 10 })]);
  queueSale(store, 'sale-1', [{ product_id: 'fan', quantity: 1, unit_code: 'PIECE' }]);
  store.reserveFromSale({
    client_id: 'sale-1',
    payload: { lines: [{ product_id: 'fan', quantity: 9 }] },
  });
  store.applySale({ client_id: 'sale-1', lines: [{ product_id: 'fan', quantity: 1, unit_code: 'PIECE' }] });
  const row = store.get('stock_batches', 'b1');
  assert.equal(row.quantity, 9);
  assert.equal(row.quantity_reserved, 0);
  const holds = store.offeredHolds();
  assert.equal(Number(holds.fan || 0), 0);
  store.metaSet('hub_reservations', { fan: 1 });
  const echoed = store.offeredHolds();
  assert.equal(Number(echoed.fan || 0), 0);
  store.close();
});

test('another till\'s hold still reduces what this till offers', () => {
  const store = tempStore();
  store.putMany('stock_batches', [batch('b1', { quantity: 10 })]);
  store.reserve({ client_id: 'other-sale:fan', product_id: 'fan', qty: 3 });
  const holds = store.offeredHolds();
  assert.equal(holds.fan, 3);
  assert.equal(store.get('stock_batches', 'b1').quantity, 10);
  store.close();
});

test('a short shelf does not throw and does not go negative', () => {
  const store = tempStore();
  store.putMany('stock_batches', [batch('b1', { quantity: 2, quantity_reserved: 2 })]);
  const result = store.applySale({
    client_id: 'sale-short',
    lines: [{ product_id: 'fan', quantity: 5, unit_code: 'PIECE' }],
  });
  assert.equal(result.ok, true);
  assert.equal(store.get('stock_batches', 'b1').quantity, 2);
  assert.ok(result.short > 0);
  store.close();
});

test('a sale the shop already took is not cut again after the download', () => {
  const store = tempStore();
  store.putMany('stock_batches', [batch('b1', { quantity: 9 })]);
  queueSale(store, 'sale-1', [{ product_id: 'fan', quantity: 1, unit_code: 'PIECE' }]);
  store.markSynced('sale-1', 'shop-sale');
  const replayed = store.replayShelf();
  assert.equal(replayed.skipped, false);
  assert.equal(store.get('stock_batches', 'b1').quantity, 9);
  const late = store.applySale({
    client_id: 'sale-1',
    lines: [{ product_id: 'fan', quantity: 1, unit_code: 'PIECE' }],
  });
  assert.equal(late.skipped, true);
  assert.equal(store.get('stock_batches', 'b1').quantity, 9);
  store.close();
});

test('soonest expiry is the batch the statement cuts', () => {
  const store = tempStore();
  store.putMany('stock_batches', [
    batch('old', { received_at: '2026-09-01 10:00:00', expiry_date: '2027-01-01', quantity: 10 }),
    batch('soon', { received_at: '2026-10-20 10:00:00', expiry_date: '2026-11-01', quantity: 10 }),
  ]);
  store.applySale({
    client_id: 'sale-exp',
    lines: [{ product_id: 'fan', quantity: 4, unit_code: 'PIECE' }],
    sold_at: '2026-10-28 09:00:00',
  });
  assert.equal(store.get('stock_batches', 'soon').quantity, 6);
  assert.equal(store.get('stock_batches', 'old').quantity, 10);
  store.close();
});
