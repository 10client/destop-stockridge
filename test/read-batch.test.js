'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTursoDatabase } = require('../../stockridge/worker/src/turso');
const { createD1Database } = require('../../stockridge/worker/src/d1');
const Module = require('node:module');

// wrap() does not open a native database in this test. Stub only the module
// import so the portable adapter can be checked without compiling better-sqlite3.
const originalLoad = Module._load;
let wrap;
try {
  Module._load = function (request, parent, isMain) {
    if (request === 'better-sqlite3') return class UnusedNativeDatabase {};
    return originalLoad.call(this, request, parent, isMain);
  };
  ({ wrap } = require('../../stockridge/server/lib/db'));
} finally {
  Module._load = originalLoad;
}

test('Turso read batch uses one ordered pipeline and keeps result/error positions', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  let failSecond = false;
  let lastBody = null;
  global.fetch = async (url, init) => {
    calls += 1;
    const body = JSON.parse(init.body);
    lastBody = body;
    let select = 0;
    const results = body.requests.map((request) => {
      if (request.type === 'close') return { type: 'ok', response: { type: 'close' } };
      if (!/^SELECT/i.test(request.stmt.sql)) {
        return { type: 'ok', response: { type: 'execute', result: { cols: [], rows: [] } } };
      }
      select += 1;
      if (failSecond && select === 2) return { type: 'error', error: { message: 'synthetic bad SELECT' } };
      return { type: 'ok', response: { type: 'execute', result: {
        cols: [{ name: 'n' }],
        rows: [[{ type: 'integer', value: String(select) }]],
      } } };
    });
    return new Response(JSON.stringify({ results }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const db = createTursoDatabase({ url: 'https://synthetic.invalid', authToken: 'synthetic-not-a-secret' });
    const rows = await db.readBatch([
      { sql: 'SELECT ? AS n', params: [1] },
      { sql: 'SELECT ? AS n', params: [2] },
    ]);
    assert.deepEqual(rows, [[{ n: 1 }], [{ n: 2 }]]);
    assert.equal(calls, 1);
    assert.equal(lastBody.requests.length, 4); // foreign keys, two SELECTs, close
    assert.equal(lastBody.requests[1].stmt.args[0].value, '1');
    assert.equal(lastBody.requests[2].stmt.args[0].value, '2');
    failSecond = true;
    await assert.rejects(db.readBatch([
      { sql: 'SELECT 1 AS n', params: [] },
      { sql: 'SELECT 2 AS n', params: [] },
    ]), (err) => {
      assert.equal(err.batchIndex, 2);
      assert.match(err.message, /synthetic bad SELECT/);
      return true;
    });
    await assert.rejects(db.readBatch([{ sql: 'DELETE FROM sales', params: [] }]), /SELECT\/WITH/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('D1 read batch returns each statement rows in order without individual reads', async () => {
  let batches = 0;
  let individual = 0;
  const raw = {
    prepare(sql) {
      return {
        sql,
        params: [],
        bind(...params) { this.params = params; return this; },
        async all() { individual += 1; return { results: [{ n: 99 }] }; },
        async first() { individual += 1; return { n: 99 }; },
      };
    },
    async batch(prepared) {
      batches += 1;
      return prepared.map((statement, index) => ({ results: [{ n: index + 1, sql: statement.sql }] }));
    },
  };
  const db = createD1Database(raw, { name: 'synthetic' });
  const rows = await db.readBatch([
    { sql: 'SELECT 1 AS n', params: [] },
    { sql: 'SELECT 2 AS n', params: [] },
  ]);
  assert.deepEqual(rows, [
    [{ n: 1, sql: 'SELECT 1 AS n' }],
    [{ n: 2, sql: 'SELECT 2 AS n' }],
  ]);
  assert.equal(batches, 1);
  assert.equal(individual, 0);
  await assert.rejects(db.readBatch([{ sql: 'UPDATE sales SET total = 0', params: [] }]), /SELECT\/WITH/);
});

test('local SQLite read batch is row-for-row compatible with all and first', async () => {
  const raw = {
    prepare(sql) {
      return {
        all(...params) { return [{ sql, n: params[0] }]; },
        get(...params) { return { sql, n: params[0] }; },
      };
    },
  };
  const db = wrap(raw, { location: ':memory:' });
  const direct = await db.all('SELECT ? AS n', [7]);
  const rows = await db.readBatch([{ sql: 'SELECT ? AS n', params: [7] }]);
  assert.deepEqual(rows[0], direct);
  assert.deepEqual(rows[0][0], await db.first('SELECT ? AS n', [7]));
  assert.throws(() => db.readBatch([{ sql: 'INSERT INTO sales (id) VALUES (?)', params: [1] }]), /SELECT\/WITH/);
});
