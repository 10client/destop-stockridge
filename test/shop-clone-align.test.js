'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const shopClone = require('../lib/shop-clone');

function fakeDb(existing) {
  const exec = [];
  return {
    exec,
    db: {
      exec(sql) { exec.push(sql); },
      prepare(sql) {
        const match = /table_info\(([a-z0-9_]+)\)/.exec(sql);
        const names = match && existing[match[1]] ? existing[match[1]] : [];
        return { all() { return names.map((name) => ({ name })); } };
      },
    },
  };
}

test('an older till file gains cash_sales_total before the next write', () => {
  const { exec, db } = fakeDb({
    till_sessions: ['id_key', 'id', 'branch_id', 'business_id', 'user_id', 'status', 'opening_cash', 'grand_total', 'sale_count', 'opened_at', 'is_deleted', 'updated_at', 'row_json'],
  });
  shopClone.ensure(db);
  const added = exec.filter((sql) => sql.startsWith('ALTER TABLE till_sessions'));
  assert.ok(added.some((sql) => sql === 'ALTER TABLE till_sessions ADD COLUMN cash_sales_total REAL'));
  assert.ok(added.some((sql) => sql === 'ALTER TABLE till_sessions ADD COLUMN refund_total REAL'));
  assert.equal(added.some((sql) => /opening_cash/.test(sql)), false);
});
