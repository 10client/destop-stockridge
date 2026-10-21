'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { archiveCommand } = require('../tools/archive');

test('the archive command keeps a spaced Windows path in one argument', () => {
  const root = path.join('C:', 'Users', 'Mohammed Hayatudeen', 'StockRidge', 'destop-stockridge');
  const spec = archiveCommand({
    root,
    execPath: path.join('C:', 'Program Files', 'nodejs', 'node.exe'),
    sign: false,
  });
  assert.equal(spec.shell, false);
  assert.equal(spec.args.length, 2);
  assert.equal(spec.args[0], path.join(root, 'node_modules', 'electron-builder', 'cli.js'));
  assert.match(spec.args[0], /Mohammed Hayatudeen/);
  assert.equal(spec.args.includes('Mohammed'), false);
  assert.equal(spec.args[1], '--config.win.signAndEditExecutable=false');
});
