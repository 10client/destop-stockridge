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

test('a second saved person can sign in when the shop is down, even if someone else was last', () => {
  const store = {
    checkVerifier(username, pin) {
      if (username === 'bola' && pin === '1357') return { username: 'bola', fullName: 'Bola' };
      return null;
    },
    hasVerifier(username) { return username === 'ada' || username === 'bola'; },
    metaGet(key) {
      if (key === 'me') return { user: { username: 'ada', fullName: 'Ada', role: 'STAFF' }, settings: {} };
      if (key === 'offline_users') return { bola: { me: { user: { username: 'bola', fullName: 'Bola' } } } };
      return null;
    },
    all() { return []; },
  };
  const out = answerWhenShopDown(store, {
    method: 'POST',
    pathname: '/api/auth/login',
    body: JSON.stringify({ username: 'Bola', pin: '1357' }),
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.offline, true);
  assert.equal(out.body.user.username, 'bola');
  assert.equal(out.body.user.fullName, 'Bola');
  const wrong = answerWhenShopDown(store, {
    method: 'POST',
    pathname: '/api/auth/login',
    body: JSON.stringify({ username: 'bola', pin: '0000' }),
  });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.code, 'BAD_CREDENTIALS');
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

test('a pinned staff member does not receive every business the till copied', () => {
  const store = {
    metaGet(key) {
      if (key !== 'me') return null;
      return {
        user: {
          username: 'ada',
          role: 'STAFF',
          branch: { id: 'shop-1', name: 'Ikeja' },
          business: { id: 'biz-1', name: 'Ikeja Electronics' },
        },
        scope: {
          allBusinesses: false,
          allBranches: false,
          businessIds: ['biz-1'],
          branchIds: ['shop-1'],
          pinnedBranchId: 'shop-1',
        },
        settings: {},
      };
    },
    all(table) {
      if (table === 'businesses') {
        return [
          { id: 'biz-1', name: 'Ikeja Electronics' },
          { id: 'biz-2', name: 'Abuja Pharmacy' },
        ];
      }
      if (table === 'branches') {
        return [
          { id: 'shop-1', business_id: 'biz-1', name: 'Ikeja' },
          { id: 'shop-2', business_id: 'biz-2', name: 'Abuja' },
        ];
      }
      return [];
    },
  };
  const out = answerWhenShopDown(store, { method: 'GET', pathname: '/api/auth/me' });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body.businesses.map((row) => row.id), ['biz-1']);
  assert.deepEqual(out.body.branches.map((row) => row.id), ['shop-1']);
});
