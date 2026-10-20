'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runningInNativeShell } = require('../lib/native-shell');

test('the install button stays on a browser PWA and hides in Electron or an Android app', () => {
  assert.equal(runningInNativeShell({
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
  }), false);
  assert.equal(runningInNativeShell({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  }), false);
  assert.equal(runningInNativeShell({
    userAgent: 'Mozilla/5.0 Chrome/120.0.0.0 Electron/28.0.0 Safari/537.36',
  }), true);
  assert.equal(runningInNativeShell({ native: { shell: 'electron' } }), true);
  assert.equal(runningInNativeShell({ native: { shell: 'android', store: {} } }), true);
  assert.equal(runningInNativeShell({
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
  }), true);
  assert.equal(runningInNativeShell({ capacitorNative: true }), true);
});
