'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shopUnreachable } = require('../lib/offline-login');

test('a dead shop server is an offline sign-in, not a refused PIN', () => {
  assert.equal(shopUnreachable({
    status: 502,
    code: 'UPSTREAM_UNREACHABLE',
    message: 'The shop server could not be reached.',
    retryable: true,
  }), true);
  assert.equal(shopUnreachable({ status: 0, code: 'OFFLINE', isOffline: true }), true);
  assert.equal(shopUnreachable({ status: 401, code: 'BAD_PIN', message: 'That PIN is not right.' }), false);
  assert.equal(shopUnreachable({ status: 500, code: 'HTTP_500', message: 'The server refused that request (HTTP 500).', retryable: true }), false);
});
