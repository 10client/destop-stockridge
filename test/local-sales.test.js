'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { localSales } = require('../lib/local-sales');

test('a sale saved while the shop is down is counted, and an uploaded sale is not counted twice', () => {
  const saved = localSales([
    { type: 'SALE', status: 'PENDING', occurred_at: '2026-10-21 09:15:00', payload: { payments: [{ method: 'CASH', amount: 1500 }, { method: 'CREDIT', amount: 200 }] } },
    { type: 'SALE', status: 'RETRY', occurred_at: '2026-10-21 10:00:00', payload: { payments: [{ method: 'TRANSFER', amount: 800 }] } },
    { type: 'SALE', status: 'SYNCED', occurred_at: '2026-10-21 08:00:00', payload: { payments: [{ method: 'CASH', amount: 9000 }] } },
    { type: 'SALE', status: 'PENDING', occurred_at: '2026-10-20 18:00:00', payload: { payments: [{ method: 'CASH', amount: 400 }] } },
    { type: 'STOCK_ADJUST', status: 'PENDING', occurred_at: '2026-10-21 11:00:00', payload: {} },
  ], '2026-10-21');
  assert.equal(saved.count, 2);
  assert.equal(saved.gross, 2300);
});
