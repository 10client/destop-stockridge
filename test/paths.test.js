'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stockridgeRoot, workerOrigin, SAMPLE_ORIGIN } = require('../electron/paths');
const { PWA_ORIGIN, OFFICE_ORIGIN, SHARED_DATABASE } = require('../lib/shared-books');

test('the PWA, the desktop till, and the Android app name the same database', () => {
  const android = fs.readFileSync(path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml'), 'utf8');
  assert.equal(SAMPLE_ORIGIN, PWA_ORIGIN);
  assert.equal(OFFICE_ORIGIN, 'https://stockridge.stockridge.workers.dev');
  assert.equal(SHARED_DATABASE, 'stockridge-10client.aws-eu-north-1.turso.io');
  assert.match(android, new RegExp(PWA_ORIGIN.replace(/[.]/g, '\\.')));
  assert.equal(workerOrigin({}), PWA_ORIGIN);
});

test('development reads the sibling checkout and the sample Worker', () => {
  const root = stockridgeRoot({ packaged: false, dirname: '/work/destop-stockridge/electron' });
  assert.equal(root, path.resolve('/work/stockridge'));
  assert.equal(workerOrigin({ packaged: false }), 'https://sample.stockridge.workers.dev');
});

test('an archive carries its own screens and uses the baked Worker address', () => {
  const root = stockridgeRoot({
    packaged: true,
    resourcesPath: '/app/resources',
    dirname: '/app/resources/app.asar/electron',
  });
  assert.equal(root, path.join('/app/resources', 'stockridge'));
  assert.equal(workerOrigin({
    packaged: true,
    bakedOrigin: 'https://stockridge.stockridge.workers.dev',
  }), 'https://stockridge.stockridge.workers.dev');
});

test('a client Worker baked into the archive still wins', () => {
  assert.equal(workerOrigin({
    packaged: true,
    bakedOrigin: 'https://northline.example.workers.dev',
  }), 'https://northline.example.workers.dev');
});

test('an explicit origin wins over the archive default', () => {
  assert.equal(workerOrigin({
    packaged: true,
    envOrigin: 'https://sample.stockridge.workers.dev',
    bakedOrigin: 'https://stockridge.stockridge.workers.dev',
  }), 'https://sample.stockridge.workers.dev');
});
