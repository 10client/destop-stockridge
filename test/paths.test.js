'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { stockridgeRoot, workerOrigin } = require('../electron/paths');

test('development reads the sibling checkout and the sample Worker', () => {
  const root = stockridgeRoot({ packaged: false, dirname: '/work/destop-stockridge/electron' });
  assert.equal(root, path.resolve('/work/stockridge'));
  assert.equal(workerOrigin({ packaged: false }), 'https://sample.stockridge.workers.dev');
});

test('an archive carries its own screens, and the old office host is not the PWA books', () => {
  const root = stockridgeRoot({
    packaged: true,
    resourcesPath: '/app/resources',
    dirname: '/app/resources/app.asar/electron',
  });
  assert.equal(root, path.join('/app/resources', 'stockridge'));
  assert.equal(workerOrigin({
    packaged: true,
    bakedOrigin: 'https://stockridge.stockridge.workers.dev',
  }), 'https://sample.stockridge.workers.dev');
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
