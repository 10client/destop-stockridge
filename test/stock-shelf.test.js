'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const shelf = require('../../stockridge/public/js/stock-shelf');

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
  }, extra);
}

test('one shop on the till still shows when the session shop id does not match', () => {
  const rows = [
    batch('a', { branch_id: 'shelf-shop', quantity: 4 }),
    batch('b', { branch_id: 'shelf-shop', quantity: 2 }),
  ];
  const shown = shelf.batchesForBranch(rows, 'session-shop');
  assert.equal(shown.length, 2);
  const hidden = shelf.batchesForBranch([
    batch('a', { branch_id: 'shop-a' }),
    batch('b', { branch_id: 'shop-b' }),
  ], 'session-shop');
  assert.equal(hidden.length, 0);
});

test('a sale takes the soonest expiry, not a newer receipt that arrived first', () => {
  const older = batch('old', { received_at: '2026-09-01 10:00:00', expiry_date: '2027-01-01', quantity: 10 });
  const sooner = batch('soon', { received_at: '2026-10-20 10:00:00', expiry_date: '2026-11-01', quantity: 10 });
  const changed = shelf.consumeLines([older, sooner], [{ product_id: 'fan', quantity: 4, unit_code: 'PIECE' }], { asOf: '2026-10-28' });
  const hit = changed.find((row) => row.id === 'soon');
  assert.equal(hit.quantity, 6);
  assert.equal(changed.some((row) => row.id === 'old'), false);
});

test('reserved stock is not sold, so the remaining free count drops by the sale', () => {
  const held = batch('held', { received_at: '2026-09-01 10:00:00', quantity: 10, quantity_reserved: 8 });
  const free = batch('free', { received_at: '2026-10-01 10:00:00', quantity: 10, quantity_reserved: 0 });
  const changed = shelf.consumeLines([held, free], [{ productId: 'fan', quantity: 5, unitFactor: 1 }], { asOf: '2026-10-28' });
  const heldNext = changed.find((row) => row.id === 'held');
  const freeNext = changed.find((row) => row.id === 'free');
  assert.equal(heldNext.quantity, 8);
  assert.equal(heldNext.quantity_reserved, 8);
  assert.equal(freeNext.quantity, 7);
  const left = [heldNext, freeNext].reduce((sum, row) => sum + row.quantity - row.quantity_reserved, 0);
  assert.equal(left, 7);
});

test('a carton uses the unit ladder, not a missing factor of one', () => {
  const units = new Map([['fan', [{ code: 'PIECE', quantity_in_base: 1, is_deleted: 0 }, { code: 'CARTON', quantity_in_base: 12, is_deleted: 0 }]]]);
  const changed = shelf.consumeLines(
    [batch('only', { quantity: 20 })],
    [{ product_id: 'fan', quantity: 1, unit_code: 'CARTON', unitFactor: 1 }],
    { unitsByProduct: units, asOf: '2026-10-28' },
  );
  assert.equal(changed[0].quantity, 8);
});

test('a hire does not take the unit off the shelf', () => {
  const changed = shelf.consumeLines(
    [batch('only', { quantity: 6 })],
    [{ product_id: 'fan', quantity: 1, unit_code: 'PIECE', channel: 'HIRE' }],
    { asOf: '2026-10-28' },
  );
  assert.equal(changed.length, 0);
});

test('damage removes free stock and found puts it back', () => {
  const start = [batch('only', { quantity: 9, quantity_reserved: 1 })];
  const damaged = shelf.adjustLine(start, {
    product_id: 'fan', branch_id: 'shop', adjustment_type: 'DAMAGE', quantity: 3, unit_code: 'PIECE',
  });
  assert.equal(damaged[0].quantity, 6);
  const found = shelf.adjustLine(damaged, {
    product_id: 'fan', branch_id: 'shop', adjustment_type: 'FOUND', quantity: 2, unit_code: 'PIECE',
  });
  assert.equal(found[0].quantity, 8);
  assert.equal(found[0].status, 'ACTIVE');
});
