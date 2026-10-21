'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readBudgets } = require('../electron/server');

test('a health probe is allowed to wait for a slow shop; a screen read is not', () => {
  const health = readBudgets('/api/health');
  const screen = readBudgets('/api/dashboard');
  assert.equal(health.net, 12000);
  assert.ok(health.net > screen.net);
  assert.equal(screen.net, 5000);
  assert.equal(screen.v4, 4000);
  assert.equal(health.v4, 0);
});
