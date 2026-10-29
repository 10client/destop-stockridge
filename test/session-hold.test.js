'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { decideSessionHold } = require('../lib/session-hold');

test('a line that returns does not sign out a saved till', () => {
  const held = decideSessionHold({
    reason: 'SESSION_SUPERSEDED',
    hasLocalSession: true,
    reconnecting: true,
    shopConfirmed: true,
  });
  assert.equal(held.signOut, false);
  assert.equal(held.keep, true);
  const foreign = decideSessionHold({
    reason: 'BAD_TOKEN',
    message: 'Invalid token signature',
    hasLocalSession: true,
    shopConfirmed: true,
  });
  assert.equal(foreign.signOut, false);
  const expired = decideSessionHold({
    reason: 'TOKEN_EXPIRED',
    hasLocalSession: true,
    shopConfirmed: true,
    reconnecting: false,
  });
  assert.equal(expired.signOut, false);
  assert.equal(expired.needsSignInToUpload, true);
});

test('another device signs this till out only after the shop confirms it twice', () => {
  const once = decideSessionHold({
    reason: 'SESSION_SUPERSEDED',
    hasLocalSession: true,
    shopConfirmed: true,
    reconnecting: false,
  });
  assert.equal(once.signOut, false);
  const twice = decideSessionHold({
    reason: 'SESSION_SUPERSEDED',
    hasLocalSession: true,
    shopConfirmed: true,
    reconnecting: false,
    confirmedTwice: true,
  });
  assert.equal(twice.signOut, true);
});

test('changing page while the line returns does not sign out', () => {
  const moved = decideSessionHold({
    reason: 'SESSION_SUPERSEDED',
    hasLocalSession: true,
    shopConfirmed: true,
    reconnecting: false,
    confirmedTwice: true,
    navigated: true,
  });
  assert.equal(moved.signOut, false);
  assert.equal(moved.keep, true);
});

test('uploading queued sales does not sign out', () => {
  const sending = decideSessionHold({
    reason: 'SESSION_SUPERSEDED',
    hasLocalSession: true,
    shopConfirmed: true,
    reconnecting: false,
    confirmedTwice: true,
    uploading: true,
  });
  assert.equal(sending.signOut, false);
  assert.equal(sending.keep, true);
});

test('the till script uses the same decision', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'stockridge', 'public', 'js', 'session-hold.js'), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox);
  const facts = { reason: 'TOKEN_EXPIRED', hasLocalSession: true, shopConfirmed: true };
  assert.equal(
    JSON.stringify(sandbox.window.SR.sessionHold.decide(facts)),
    JSON.stringify(decideSessionHold(facts)),
  );
});
