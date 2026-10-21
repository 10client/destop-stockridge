'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { answerWhenShopDown } = require('../lib/offline-door');

function storeFor(pinOk) {
  return {
    checkVerifier(username, pin) {
      if (username === 'ada' && pin === '2468') return { username: 'ada', fullName: 'Ada' };
      return null;
    },
    hasVerifier(username) { return username === 'ada'; },
    metaGet(key) {
      if (key === 'me') return { user: { username: 'ada', fullName: 'Ada', role: 'STAFF' }, settings: {} };
      if (key === 'offline_users') return {};
      return null;
    },
    all() { return [{ id: 'b1', name: 'Abuja' }]; },
    pinOk,
  };
}

test('a dead shop opens the saved till and does not repeat the proxy sentence', () => {
  const ok = answerWhenShopDown(storeFor(true), {
    method: 'POST',
    pathname: '/api/auth/login',
    body: JSON.stringify({ username: 'Ada', pin: '2468' }),
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.offline, true);
  assert.equal(ok.body.user.username, 'ada');
  assert.doesNotMatch(JSON.stringify(ok.body), /shop server could not be reached/i);

  const wrong = answerWhenShopDown(storeFor(true), {
    method: 'POST',
    pathname: '/api/auth/login',
    body: JSON.stringify({ username: 'ada', pin: '0000' }),
  });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.code, 'BAD_CREDENTIALS');
  assert.doesNotMatch(wrong.body.error, /shop server could not be reached/i);

  const stranger = answerWhenShopDown(storeFor(true), {
    method: 'POST',
    pathname: '/api/auth/login',
    body: JSON.stringify({ username: 'other', pin: '2468' }),
  });
  assert.equal(stranger, null);
});

test('a till that signed in before PIN checks existed still opens that saved person', () => {
  const store = storeFor(false);
  store.hasVerifier = () => false;
  store.checkVerifier = () => null;
  const out = answerWhenShopDown(store, {
    method: 'POST',
    pathname: '/api/auth/login',
    body: JSON.stringify({ username: 'ada', pin: '2468' }),
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.offline, true);
  assert.equal(out.body.token, null);
});
