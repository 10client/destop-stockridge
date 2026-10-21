'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isPlainSqlite, openSteps } = require('../lib/sql-open');

test('a plain till file is not opened as SQLCipher first', () => {
  const steps = openSteps(true, null);
  assert.deepEqual(steps, ['plain-read']);
  assert.equal(steps.includes('sqlcipher'), false);
  assert.equal(steps.includes('sqlcipher-raw'), false);
});

test('an encrypted till tries the scheme that the old opener wrote before the default cipher', () => {
  const steps = openSteps(false, null);
  assert.equal(steps[0], 'sqlcipher-raw');
  assert.ok(steps.includes('sqleet'));
});

test('the SQLite header is recognised and a short file is not', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-sql-'));
  const plain = path.join(dir, 'plain.db');
  const junk = path.join(dir, 'junk.db');
  fs.writeFileSync(plain, Buffer.concat([Buffer.from('SQLite format 3\0', 'utf8'), Buffer.alloc(32)]));
  fs.writeFileSync(junk, Buffer.from('not a database'));
  assert.equal(isPlainSqlite(plain), true);
  assert.equal(isPlainSqlite(junk), false);
  assert.equal(isPlainSqlite(path.join(dir, 'missing.db')), false);
});
