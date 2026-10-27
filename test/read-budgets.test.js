'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readBudgets, isOneShotWrite, requestMayHaveLanded, shopSpoke, sessionBlip } = require('../electron/server');

test('every shop read can use IPv4, the inspected certificate, and the other host', () => {
  const budget = readBudgets('/api/health');
  const screen = readBudgets('/api/dashboard');
  assert.equal(budget.v4, screen.v4);
  assert.ok(budget.v4 > 0);
  assert.ok(budget.insecure > 0);
  assert.ok(budget.sibling > 0);
  assert.ok(budget.v4 + budget.node + budget.insecure + budget.net + budget.sibling <= 20000);
  assert.equal(budget.catalogue, false);
});

test('a catalogue download is not cut off by the screen read budget', () => {
  const pull = readBudgets('/api/sync/pull');
  const screen = readBudgets('/api/dashboard');
  assert.ok(pull.v4 >= 50000);
  assert.ok(pull.v4 > screen.v4);
  assert.equal(pull.catalogue, true);
  assert.equal(screen.catalogue, false);
});

test('a purchase order is sent once and is not asked of the other host', () => {
  const budget = readBudgets('/api/purchase-orders', 'POST');
  assert.equal(isOneShotWrite('POST', '/api/purchase-orders'), true);
  assert.equal(budget.once, true);
  assert.equal(budget.node, 0);
  assert.equal(budget.insecure, 0);
  assert.equal(budget.net, 0);
  assert.equal(budget.sibling, 0);
  assert.ok(budget.v4 >= 15000);
  assert.ok(budget.v4 <= 20000);
  assert.equal(isOneShotWrite('GET', '/api/purchase-orders'), false);
  assert.equal(isOneShotWrite('POST', '/api/sync/push'), false);
  assert.equal(isOneShotWrite('POST', '/api/auth/login'), false);
  assert.equal(requestMayHaveLanded(Object.assign(new Error('The Worker did not answer in time.'), { sent: true })), true);
  assert.equal(requestMayHaveLanded(new Error('connect ECONNREFUSED')), false);
});

test('a gateway failure is not the shop, and a refusal is', () => {
  assert.equal(shopSpoke({ status: 200, body: Buffer.from('{"ok":true}') }), true);
  assert.equal(shopSpoke({ status: 401, body: Buffer.from('{"code":"NO_TOKEN"}') }), true);
  assert.equal(shopSpoke({ status: 404, body: Buffer.from('{"code":"NOT_FOUND"}') }), true);
  assert.equal(shopSpoke({ status: 502, body: Buffer.from('{"code":"UPSTREAM_UNREACHABLE"}') }), false);
  assert.equal(shopSpoke({ status: 200, body: Buffer.from('{"ok":true,"offline":true}') }), false);
  assert.equal(shopSpoke({ status: 403, body: Buffer.from('<html>blocked</html>') }), false);
});

test('a dropped token or a device mismatch is not the last answer from one path', () => {
  assert.equal(sessionBlip({ status: 401, body: Buffer.from('{"code":"NO_TOKEN"}') }), true);
  assert.equal(sessionBlip({ status: 401, body: Buffer.from('{"code":"SESSION_SUPERSEDED"}') }), true);
  assert.equal(sessionBlip({ status: 401, body: Buffer.from('{"code":"SESSION_REVOKED"}') }), false);
  assert.equal(sessionBlip({ status: 200, body: Buffer.from('{"ok":true}') }), false);
});
