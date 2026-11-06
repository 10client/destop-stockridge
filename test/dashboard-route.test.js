'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dashboard = require('../../stockridge/server/routes/dashboard');

function rowsFor(sql) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (/^SELECT COUNT\(\*\) AS c FROM businesses/.test(s)) return [{ c: 14 }];
  if (/^SELECT COUNT\(\*\) AS c FROM branches/.test(s)) return [{ c: 28 }];
  if (/^SELECT COUNT\(\*\) AS c FROM users/.test(s)) return [{ c: 100 }];
  if (/COALESCE\(SUM\(si.cost_price_snapshot/.test(s)) return [{ cogs: 300 }];
  if (/^SELECT COUNT\(\*\) AS count, COALESCE\(SUM\(s.total\)/.test(s)) {
    return [{ count: 2, gross: 1000, vat: 75, outstanding: 100, delivery: 20, average: 500, value: 0 }];
  }
  if (/^SELECT COALESCE\(SUM\(sb.quantity\)/.test(s)) return [{ units: 8, at_cost: 400, at_retail: 800, products: 2 }];
  if (/^SELECT COUNT\(\*\) AS count, COALESCE\(SUM\(c.credit_balance\)/.test(s)) return [{ count: 1, total: 100 }];
  if (/COALESCE\(SUM\(t.variance\)/.test(s)) return [{ net: 0, shortages: 0, surpluses: 0, closed: 0, unreviewed: 0 }];
  if (/FROM branch_safe_ledger/.test(s)) return [{ balance: 50 }];
  if (/^SELECT COUNT\(\*\)/.test(s)) return [{ 'COUNT(*)': 0 }];
  if (/^SELECT 0$/.test(s)) return [{ 0: 0 }];
  return [];
}

function fakeDb() {
  const calls = { remote: 0, batches: 0, statements: 0, first: 0, all: 0, scalar: 0, writes: 0 };
  return {
    calls,
    async readBatch(list) {
      calls.remote += 1;
      calls.batches += 1;
      calls.statements += list.length;
      for (const statement of list) assert.match(statement.sql, /^\s*(?:SELECT|WITH)\b/i);
      return list.map((statement) => rowsFor(statement.sql));
    },
    async first(sql) { calls.remote += 1; calls.first += 1; return rowsFor(sql)[0] || null; },
    async all(sql) { calls.remote += 1; calls.all += 1; return rowsFor(sql); },
    async scalar(sql) {
      calls.remote += 1;
      calls.scalar += 1;
      const row = rowsFor(sql)[0];
      return row ? Object.values(row)[0] : null;
    },
    async run() { calls.remote += 1; calls.writes += 1; return { changes: 0 }; },
  };
}

test('the dashboard batches independent reads and does not run maintenance writes', async () => {
  const db = fakeDb();
  const routes = new Map();
  dashboard.mount({ get: (route, handler) => routes.set(route, handler) }, '/api');
  const user = { id: 'owner-1', username: 'owner', full_name: 'Owner', role: 'OWNER', branch_id: null };
  const scope = { allBusinesses: true, allBranches: true, businessIds: new Set(), branchIds: new Set() };
  const settings = {
    expiry_alert_days: 60,
    subscription_plan: 'TEST',
    subscription_status: 'ACTIVE',
    max_businesses: 0,
    max_branches: 0,
    max_staff: 0,
  };
  let payload;
  const ctx = {
    env: { DB: db },
    get: (key) => (key === 'user' ? user : key === 'scope' ? scope : key === 'settings' ? settings : null),
    req: { queryParam: () => null, param: () => null, header: () => '' },
    json: (body) => { payload = body; },
  };
  await routes.get('/api/dashboard')(ctx);

  assert.equal(payload.ok, true);
  assert.equal(payload.view, 'GROUP');
  assert.equal(payload.today.gross, 1000);
  assert.equal(payload.today.vat, 75);
  assert.equal(payload.today.cogs, 300);
  assert.equal(payload.stock.units, 8);
  assert.equal(payload.debtors.totalOwed, 100);
  assert.equal(payload.cash.safeBalance, 50);
  assert.equal(payload.plan.businesses.used, 14);
  assert.equal(payload.plan.branches.used, 28);
  assert.equal(payload.plan.staff.used, 100);

  assert.ok(db.calls.batches >= 7);
  assert.ok(db.calls.statements >= 30);
  assert.ok(db.calls.remote <= 10, `dashboard used ${db.calls.remote} logical remote reads`);
  assert.equal(db.calls.writes, 0);

  const source = fs.readFileSync(path.join(__dirname, '../../stockridge/server/routes/dashboard.js'), 'utf8');
  const review = fs.readFileSync(path.join(__dirname, '../../stockridge/server/routes/saleIssues.js'), 'utf8');
  assert.doesNotMatch(source, /await saleIssues\.scan/);
  assert.match(review, /scanFirst: !saleId/);
});
