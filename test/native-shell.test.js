'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

test('the Android app removes the same install buttons the Electron window removes', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'hide-install.js'), 'utf8');
  assert.match(source, /install-btn/);
  assert.match(source, /nav-install/);
  assert.match(source, /login-install/);
  assert.match(source, /shell = 'android'/);
  assert.match(source, /keepLoginDoor/);
  assert.match(source, /_explicitSignOut/);
  assert.match(source, /login-screen/);
});

test('sign-out cannot leave the shell up over the sign-in page', () => {
  const desktop = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'desktop-production.js'), 'utf8');
  assert.match(desktop, /function forceLoginDoor/);
  assert.match(desktop, /_explicitSignOut/);
  assert.match(desktop, /forceLoginDoor\(\)/);
  assert.doesNotMatch(desktop, /location\.reload\(\)/);
});
