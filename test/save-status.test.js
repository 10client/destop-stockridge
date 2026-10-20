'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { decideSaveStatus } = require('../lib/save-status');

test('Saved means the catalogue is on the till and the queue is empty', () => {
  const saved = decideSaveStatus({
    lastPullAt: '2026-10-20 18:00:00',
    stockRows: 4,
    productRows: 12,
    pending: 0,
    failed: 0,
    online: true,
  });
  assert.equal(saved.finished, true);
  assert.equal(saved.label, 'Saved');
});

test('a running save, a refused sale, and an empty till are not finished', () => {
  assert.equal(decideSaveStatus({ running: true, lastPullAt: 'x', stockRows: 1 }).state, 'saving');
  assert.equal(decideSaveStatus({ failed: 1, lastPullAt: 'x', stockRows: 1 }).finished, false);
  assert.equal(decideSaveStatus({ pending: 2, online: false, lastPullAt: 'x', stockRows: 1 }).label, 'Saved here');
  assert.equal(decideSaveStatus({ pending: 0, lastPullAt: null, stockRows: 0, productRows: 0 }).label, 'Not saved');
  assert.equal(decideSaveStatus({ lastPullAt: 'x', stockRows: 1, truncated: ['products'] }).state, 'partial');
});

test('the till script uses the same decision as the library', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'save-status.js'), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox);
  const facts = { pending: 1, online: true, lastPullAt: 'x', stockRows: 2, productRows: 3 };
  assert.equal(
    JSON.stringify(sandbox.window.SR.saveStatus.decide(facts)),
    JSON.stringify(decideSaveStatus(facts)),
  );
});
