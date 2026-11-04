'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { decideSessionHold } = require('../lib/session-hold');

test('a line that returns does not sign out a saved till', () => {
  const held = decideSessionHold({
    reason: 'TOKEN_EXPIRED',
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

test('another device signs this till out on the shop\'s first answer', () => {
  const once = decideSessionHold({
    reason: 'SESSION_SUPERSEDED',
    hasLocalSession: true,
    shopConfirmed: true,
    reconnecting: false,
  });
  assert.equal(once.signOut, true);
  assert.equal(once.keep, false);
  const unconfirmed = decideSessionHold({
    reason: 'SESSION_SUPERSEDED',
    hasLocalSession: true,
    shopConfirmed: false,
  });
  assert.equal(unconfirmed.signOut, false);
});

test('changing page while the line returns does not sign out', () => {
  const moved = decideSessionHold({
    reason: 'TOKEN_EXPIRED',
    hasLocalSession: true,
    shopConfirmed: true,
    reconnecting: false,
    confirmedTwice: true,
    navigated: true,
  });
  assert.equal(moved.signOut, false);
  assert.equal(moved.keep, true);
});

test('sales still waiting do not block a session the other device replaced', () => {
  const waiting = decideSessionHold({
    reason: 'SESSION_REVOKED',
    hasLocalSession: true,
    shopConfirmed: true,
    reconnecting: false,
    uploading: false,
    confirmedTwice: true,
    pendingUpload: true,
  });
  assert.equal(waiting.signOut, true);
  assert.equal(waiting.keep, false);
});

test('uploading does not keep a session another device has taken', () => {
  const sending = decideSessionHold({
    reason: 'SESSION_SUPERSEDED',
    hasLocalSession: true,
    shopConfirmed: true,
    reconnecting: true,
    confirmedTwice: false,
    uploading: true,
  });
  assert.equal(sending.signOut, true);
  assert.equal(sending.keep, false);
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
