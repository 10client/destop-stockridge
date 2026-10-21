'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readBudgets, shopSpoke } = require('../electron/server');

test('every shop read can use IPv4, the inspected certificate, and the other host', () => {
  const budget = readBudgets('/api/health');
  const screen = readBudgets('/api/dashboard');
  assert.equal(budget.v4, screen.v4);
  assert.ok(budget.v4 > 0);
  assert.ok(budget.insecure > 0);
  assert.ok(budget.sibling > 0);
  assert.ok(budget.v4 + budget.node + budget.insecure + budget.net + budget.sibling <= 20000);
});

test('a gateway failure is not the shop, and a refusal is', () => {
  assert.equal(shopSpoke({ status: 200, body: Buffer.from('{"ok":true}') }), true);
  assert.equal(shopSpoke({ status: 401, body: Buffer.from('{"code":"NO_TOKEN"}') }), true);
  assert.equal(shopSpoke({ status: 404, body: Buffer.from('{"code":"NOT_FOUND"}') }), true);
  assert.equal(shopSpoke({ status: 502, body: Buffer.from('{"code":"UPSTREAM_UNREACHABLE"}') }), false);
  assert.equal(shopSpoke({ status: 200, body: Buffer.from('{"ok":true,"offline":true}') }), false);
  assert.equal(shopSpoke({ status: 403, body: Buffer.from('<html>blocked</html>') }), false);
});
