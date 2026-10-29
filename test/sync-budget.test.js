'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { changedRows, copyDue } = require('../lib/sync-budget');

test('an unchanged row is not written again', () => {
  const stamps = new Map([['a', '2026-10-29 07:00:00']]);
  const rows = changedRows([
    { id: 'a', updated_at: '2026-10-29 07:00:00', name: 'same' },
    { id: 'b', updated_at: '2026-10-29 08:00:00' },
    { id: 'c' },
  ], stamps);
  assert.deepEqual(rows.map((row) => row.id), ['b', 'c']);
});

test('a book copied recently is not read again', () => {
  const now = Date.parse('2026-10-29T08:00:00Z');
  assert.equal(copyDue('2026-10-29T07:50:00Z', now, 20 * 60 * 1000), false);
  assert.equal(copyDue('2026-10-29T07:00:00Z', now, 20 * 60 * 1000), true);
  assert.equal(copyDue(null, now, 20 * 60 * 1000), true);
});
