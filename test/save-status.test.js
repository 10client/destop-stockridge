'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { decideSaveStatus } = require('../lib/save-status');

test('Saved means the catalogue and the sales book are on the till', () => {
  const saved = decideSaveStatus({
    lastPullAt: '2026-10-20 18:00:00',
    stockRows: 4,
    productRows: 12,
    pending: 0,
    failed: 0,
    online: true,
    salesCopied: true,
  });
  assert.equal(saved.finished, true);
  assert.equal(saved.label, 'Saved');
  const catalogueOnly = decideSaveStatus({
    lastPullAt: '2026-10-20 18:00:00',
    stockRows: 4,
    productRows: 12,
    pending: 0,
    failed: 0,
    online: true,
  });
  assert.equal(catalogueOnly.label, 'Part saved');
  assert.match(catalogueOnly.detail, /sales book/);
});

test('a running save, a refused sale, and an empty till are not finished', () => {
  assert.equal(decideSaveStatus({ running: true, lastPullAt: 'x', stockRows: 1 }).state, 'saving');
  assert.equal(decideSaveStatus({ running: true, pending: 2, online: true, lastPullAt: 'x', stockRows: 1 }).label, 'Sending…');
  assert.equal(decideSaveStatus({ failed: 1, lastPullAt: 'x', stockRows: 1 }).finished, false);
  assert.equal(decideSaveStatus({ pending: 2, online: false, lastPullAt: 'x', stockRows: 1 }).label, 'Saved here');
  assert.equal(decideSaveStatus({ pending: 0, lastPullAt: null, stockRows: 0, productRows: 0 }).label, 'Not saved');
  assert.equal(decideSaveStatus({ lastPullAt: 'x', stockRows: 1, truncated: ['products'] }).state, 'partial');
  assert.equal(decideSaveStatus({ stockRows: 3, productRows: 0, lastPullAt: null }).label, 'Part saved');
  const missed = decideSaveStatus({ pullError: 'The shop did not finish sending the catalogue. Leave the till open and connected so it can try again.' });
  assert.equal(missed.label, 'Not saved');
  assert.match(missed.detail, /did not finish sending the catalogue/);
  const emptyShop = decideSaveStatus({ catalogueEmpty: true, lastPullAt: 'x' });
  assert.equal(emptyShop.label, 'Not saved');
  assert.match(emptyShop.detail, /no products or stock/);
});

test('a refused session or a short catalogue is not Saved', () => {
  const refused = decideSaveStatus({
    lastPullAt: '2026-10-28 19:01:00',
    stockRows: 11,
    productRows: 20,
    visibleProducts: 20,
    salesCopied: true,
    pullError: 'The shop did not accept this session, so the catalogue was not copied.',
  });
  assert.notEqual(refused.label, 'Saved');
  assert.equal(refused.finished, false);
  assert.match(refused.detail, /did not accept this session, so the catalogue was not copied/);
  const short = decideSaveStatus({
    lastPullAt: '2026-10-28 19:01:00',
    stockRows: 11,
    productRows: 20,
    visibleProducts: 20,
    shopProductCount: 50,
    salesCopied: true,
  });
  assert.equal(short.label, 'Part saved');
  assert.match(short.detail, /shop has 50 products/);
  assert.match(short.detail, /till has 20/);
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
