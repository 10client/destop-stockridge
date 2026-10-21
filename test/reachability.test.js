'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shopAnswered, callMissed } = require('../../stockridge/public/js/reachability');

test('a shop answer is online, including a refusal, and a proxy miss is not', () => {
  assert.equal(shopAnswered(200, '{"ok":true}'), true);
  assert.equal(shopAnswered(401, '{"code":"SESSION_SUPERSEDED"}'), true);
  assert.equal(shopAnswered(404, '{"code":"NOT_FOUND"}'), true);
  assert.equal(shopAnswered(502, '{"code":"UPSTREAM_UNREACHABLE","error":"The shop server could not be reached."}'), false);
  assert.equal(shopAnswered(502, '{"code":"OFFLINE","error":"The shop did not answer from this window. Try again."}'), false);
  assert.equal(shopAnswered(0, ''), false);
  assert.equal(callMissed(401, '{"code":"BAD_CREDENTIALS"}', 'BAD_CREDENTIALS'), false);
  assert.equal(callMissed(502, '{"code":"OFFLINE"}', 'OFFLINE'), true);
});

test('one miss, or the browser offline flag, does not mark the till offline', () => {
  const { shouldMarkOffline } = require('../../stockridge/public/js/reachability');
  assert.equal(shouldMarkOffline({ probeAttempted: false, navigatorOffline: true, consecutiveProbeMisses: 1 }), false);
  assert.equal(shouldMarkOffline({ probeAttempted: true, probeAnswered: true, consecutiveProbeMisses: 2 }), false);
  assert.equal(shouldMarkOffline({ probeAttempted: true, probeAnswered: false, consecutiveProbeMisses: 1 }), false);
  assert.equal(shouldMarkOffline({ probeAttempted: true, probeAnswered: false, consecutiveProbeMisses: 2 }), true);
});
