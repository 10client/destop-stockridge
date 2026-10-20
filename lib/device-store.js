'use strict';
// =====================================================================
// THE DEVICE DATABASE
// =====================================================================
// One SQLite file per computer. It holds the same three things IndexedDB
// held: the mirror of what the server last sent, the outbox of what this
// till has not yet posted, and a few device facts.
//
// It does not talk to Turso. Two tills editing the same row must not
// last-push-win over each other. The outbox is posted to the Worker, and
// the Worker is the only writer of the cloud database.
//
// The shape of a backup matches the browser export, so a till that already
// has IndexedDB rows can be imported once and then left alone.

const fs = require('node:fs');
const { openDatabase } = require('./sql-open');
const { seal, matches, publicUser } = require('./offline-auth');
const { linesFromSale } = require('./stock-hold');

const LOG_CAP = 400;
const OUTBOX_CAP = 20000;
const MIGRATIONS = [
  {
    version: 1,
    name: 'device mirror, outbox, meta, log',
    sql: `
      CREATE TABLE mirror_rows (
        table_name TEXT NOT NULL,
        id         TEXT NOT NULL,
        row_json   TEXT NOT NULL,
        updated_at TEXT,
        PRIMARY KEY (table_name, id)
      );
      CREATE INDEX idx_mirror_table ON mirror_rows(table_name);
      CREATE INDEX idx_mirror_updated ON mirror_rows(updated_at);

      CREATE TABLE outbox (
        client_id   TEXT PRIMARY KEY,
        record_json TEXT NOT NULL,
        status      TEXT NOT NULL,
        at          TEXT NOT NULL
      );
      CREATE INDEX idx_outbox_status_at ON outbox(status, at);

      CREATE TABLE meta (
        key        TEXT PRIMARY KEY,
        value_json TEXT
      );

      CREATE TABLE sync_log (
        at         TEXT PRIMARY KEY,
        entry_json TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: 'reservations and offline sign-in verifier',
    sql: `
      CREATE TABLE reservations (
        client_id  TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        qty        REAL NOT NULL,
        till_id    TEXT,
        at         TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX idx_res_product ON reservations(product_id, expires_at);

      CREATE TABLE offline_auth (
        username  TEXT PRIMARY KEY,
        salt      TEXT NOT NULL,
        hash      TEXT NOT NULL,
        user_json TEXT NOT NULL,
        saved_at  TEXT NOT NULL
      );
    `,
  },
];

const FORBIDDEN = ['pin_hash', 'jwt_secret', 'password', 'password_hash', 'secret'];

function stripSecrets(row) {
  if (!row || typeof row !== 'object') return row;
  let dirty = false;
  for (const field of FORBIDDEN) {
    if (Object.prototype.hasOwnProperty.call(row, field)) { dirty = true; break; }
  }
  if (!dirty) return row;
  const copy = Object.assign({}, row);
  for (const field of FORBIDDEN) delete copy[field];
  return copy;
}

function parseJson(text, label) {
  try { return JSON.parse(text); }
  catch (err) { throw new Error(`The device database has a damaged ${label}.`); }
}

class DeviceStore {
  constructor(file, { key = null } = {}) {
    this.file = file;
    this.keyed = Boolean(key);
    this.db = openDatabase(file, key);
    this.migrate();
    this._prepare();
  }

  migrate() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS device_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`);
    const applied = new Set(this.db.prepare('SELECT version FROM device_migrations').all().map((row) => row.version));
    const insert = this.db.prepare('INSERT INTO device_migrations (version, name, applied_at) VALUES (?, ?, datetime(\'now\'))');
    const apply = this.db.transaction((migration) => {
      this.db.exec(migration.sql);
      insert.run(migration.version, migration.name);
    });
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      apply(migration);
    }
  }

  _prepare() {
    this._putRow = this.db.prepare(`INSERT INTO mirror_rows (table_name, id, row_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(table_name, id) DO UPDATE SET
        row_json = excluded.row_json,
        updated_at = excluded.updated_at`);
    this._rowsFor = this.db.prepare('SELECT row_json FROM mirror_rows WHERE table_name = ?');
    this._oneRow = this.db.prepare('SELECT row_json FROM mirror_rows WHERE table_name = ? AND id = ?');
    this._deleteRow = this.db.prepare('DELETE FROM mirror_rows WHERE table_name = ? AND id = ?');
    this._clearTable = this.db.prepare('DELETE FROM mirror_rows WHERE table_name = ?');
    this._stats = this.db.prepare('SELECT table_name AS table_name, COUNT(*) AS count, MAX(updated_at) AS latest FROM mirror_rows GROUP BY table_name ORDER BY table_name');
    this._putOutbox = this.db.prepare('INSERT INTO outbox (client_id, record_json, status, at) VALUES (?, ?, ?, ?)');
    this._replaceOutbox = this.db.prepare('UPDATE outbox SET record_json = ?, status = ? WHERE client_id = ?');
    this._oneOutbox = this.db.prepare('SELECT record_json FROM outbox WHERE client_id = ?');
    this._allOutbox = this.db.prepare('SELECT record_json FROM outbox ORDER BY at');
    this._deleteOutbox = this.db.prepare('DELETE FROM outbox WHERE client_id = ?');
    this._countPending = this.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE status IN ('PENDING', 'RETRY')");
    this._pending = this.db.prepare("SELECT record_json FROM outbox WHERE status IN ('PENDING', 'RETRY') ORDER BY at");
    this._reserve = this.db.prepare(`INSERT INTO reservations (client_id, product_id, qty, till_id, at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(client_id) DO UPDATE SET
        product_id = excluded.product_id,
        qty = excluded.qty,
        till_id = excluded.till_id,
        at = excluded.at,
        expires_at = excluded.expires_at`);
    this._holds = this.db.prepare('SELECT product_id, qty FROM reservations WHERE expires_at > ?');
    this._dropHold = this.db.prepare('DELETE FROM reservations WHERE client_id = ?');
    this._purgeHolds = this.db.prepare('DELETE FROM reservations WHERE expires_at <= ?');
    this._authGet = this.db.prepare('SELECT salt, hash, user_json FROM offline_auth WHERE username = ?');
    this._authSet = this.db.prepare(`INSERT INTO offline_auth (username, salt, hash, user_json, saved_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        salt = excluded.salt,
        hash = excluded.hash,
        user_json = excluded.user_json,
        saved_at = excluded.saved_at`);
    this._countOutbox = this.db.prepare('SELECT COUNT(*) AS n FROM outbox');
    this._metaGet = this.db.prepare('SELECT value_json FROM meta WHERE key = ?');
    this._metaSet = this.db.prepare(`INSERT INTO meta (key, value_json) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`);
    this._metaAll = this.db.prepare('SELECT key, value_json FROM meta');
    this._logPut = this.db.prepare('INSERT INTO sync_log (at, entry_json) VALUES (?, ?)');
    this._logAll = this.db.prepare('SELECT entry_json FROM sync_log ORDER BY at DESC');
    this._logCount = this.db.prepare('SELECT COUNT(*) AS n FROM sync_log');
    this._logOldest = this.db.prepare('SELECT at FROM sync_log ORDER BY at LIMIT ?');
    this._logDelete = this.db.prepare('DELETE FROM sync_log WHERE at = ?');
  }

  close() {
    this.db.close();
  }

  info() {
    let bytes = 0;
    try { bytes = fs.statSync(this.file).size; } catch (err) { bytes = 0; }
    const version = this.db.prepare('SELECT MAX(version) AS v FROM device_migrations').get();
    return {
      engine: 'sqlite',
      cipher: this.keyed ? 'sqlcipher' : 'none',
      file: this.file,
      bytes,
      migration: version && version.v,
      journal: String(this.db.pragma('journal_mode', { simple: true }) || ''),
    };
  }

  putMany(table, rows) {
    const name = String(table || '');
    if (!name) throw new Error('A mirror write needs a table name.');
    const list = rows || [];
    const write = this.db.transaction((items) => {
      let n = 0;
      for (const raw of items) {
        if (!raw || raw.id == null) continue;
        const row = stripSecrets(raw);
        this._putRow.run(name, String(row.id), JSON.stringify(row), row.updated_at == null ? null : String(row.updated_at));
        n += 1;
      }
      return n;
    });
    return write(list);
  }

  all(table) {
    return this._rowsFor.all(String(table)).map((hit) => parseJson(hit.row_json, 'mirror row'));
  }

  get(table, id) {
    const hit = this._oneRow.get(String(table), String(id));
    return hit ? parseJson(hit.row_json, 'mirror row') : null;
  }

  remove(table, id) {
    return this._deleteRow.run(String(table), String(id)).changes;
  }

  clearTable(table) {
    return this._clearTable.run(String(table)).changes;
  }

  clearAll() {
    const run = this.db.transaction(() => {
      this.db.prepare('DELETE FROM mirror_rows').run();
      this.db.prepare('DELETE FROM outbox').run();
    });
    run();
  }

  tableStats() {
    const tables = this._stats.all().map((row) => ({ table: row.table_name, count: row.count }));
    const latestRow = this.db.prepare('SELECT MAX(updated_at) AS latest FROM mirror_rows').get();
    return {
      total: tables.reduce((sum, row) => sum + row.count, 0),
      tables,
      latestUpdatedAt: latestRow && latestRow.latest ? String(latestRow.latest) : null,
    };
  }

  outboxPut(record) {
    if (!record || !record.client_id) throw new Error('An outbox row needs a client id.');
    const pending = this._countPending.get().n;
    if (pending >= OUTBOX_CAP && (record.status === 'PENDING' || record.status === 'RETRY')) {
      throw new Error('This till has been offline too long. The queue is full. Connect and let it sync before selling more.');
    }
    const existing = this._oneOutbox.get(String(record.client_id));
    if (existing) throw new Error(`Outbox id ${record.client_id} is already stored.`);
    this._putOutbox.run(String(record.client_id), JSON.stringify(record), String(record.status || 'PENDING'), String(record.at || new Date().toISOString()));
    return record;
  }

  outboxGet(clientId) {
    const hit = this._oneOutbox.get(String(clientId));
    return hit ? parseJson(hit.record_json, 'outbox row') : null;
  }

  outboxAll() {
    return this._allOutbox.all().map((hit) => parseJson(hit.record_json, 'outbox row'));
  }

  pending(limit = null) {
    const list = this._pending.all().map((hit) => parseJson(hit.record_json, 'outbox row'));
    return limit ? list.slice(0, limit) : list;
  }

  outboxCount() {
    return this._countPending.get().n;
  }

  outboxUpdate(clientId, patch) {
    const row = this.outboxGet(clientId);
    if (!row) return false;
    const next = Object.assign({}, row, patch || {}, { at: row.at });
    this._replaceOutbox.run(JSON.stringify(next), String(next.status || row.status), String(clientId));
    return true;
  }

  outboxDelete(clientId) {
    return this._deleteOutbox.run(String(clientId)).changes;
  }

  markFailed(clientId, { code, message } = {}) {
    const row = this.outboxGet(clientId);
    if (!row) return false;
    return this.outboxUpdate(clientId, {
      status: 'FAILED',
      last_code: code || 'REJECTED',
      last_error: message || 'The server refused this.',
      attempts: Number(row.attempts || 0) + 1,
    });
  }

  markSynced(clientId, serverRef) {
    this.dropReservation(clientId);
    return this.outboxUpdate(clientId, {
      status: 'SYNCED',
      synced_at: new Date().toISOString(),
      server_ref: serverRef || null,
    });
  }

  purgeSynced(olderThanHours) {
    const hours = olderThanHours == null ? 48 : Number(olderThanHours);
    const cutoff = new Date(Date.now() - hours * 3600000).toISOString();
    const gone = this.outboxAll().filter((row) => row.status === 'SYNCED' && String(row.synced_at || '') < cutoff);
    const run = this.db.transaction((rows) => {
      for (const row of rows) this._deleteOutbox.run(row.client_id);
    });
    run(gone);
    return gone.length;
  }

  requeue(clientId) {
    return this.outboxUpdate(clientId, { status: 'PENDING', attempts: 0, last_error: null, last_code: null });
  }

  metaGet(key) {
    const hit = this._metaGet.get(String(key));
    if (!hit || hit.value_json == null) return null;
    return parseJson(hit.value_json, 'meta value');
  }

  metaSet(key, value) {
    this._metaSet.run(String(key), JSON.stringify(value));
    return value;
  }

  metaAll() {
    return Object.fromEntries(this._metaAll.all().map((row) => [row.key, parseJson(row.value_json, 'meta value')]));
  }

  logPut(entry) {
    let at = (entry && entry.at) || new Date().toISOString();
    const stored = Object.assign({}, entry, { at });
    const write = this.db.transaction(() => {
      while (this.db.prepare('SELECT 1 FROM sync_log WHERE at = ?').get(at)) {
        at = `${at}.${Math.random().toString(16).slice(2, 6)}`;
        stored.at = at;
      }
      this._logPut.run(at, JSON.stringify(stored));
      const extra = this._logCount.get().n - LOG_CAP;
      if (extra > 0) {
        for (const old of this._logOldest.all(extra)) this._logDelete.run(old.at);
      }
    });
    write();
    return stored;
  }

  logAll(limit) {
    const n = Number(limit) > 0 ? Number(limit) : 60;
    return this._logAll.all().slice(0, n).map((row) => parseJson(row.entry_json, 'sync log'));
  }

  logClear() {
    this.db.prepare('DELETE FROM sync_log').run();
  }

  exportAll() {
    return {
      format: 'stockridge-device-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      rows: this.db.prepare('SELECT table_name, id, row_json FROM mirror_rows').all().map((row) => ({
        table: row.table_name,
        id: row.id,
        row: parseJson(row.row_json, 'mirror row'),
      })),
      outbox: this.outboxAll(),
      meta: this._metaAll.all()
        .filter((row) => row.key !== 'hub_secret' && row.key !== 'offline_users')
        .map((row) => ({ key: row.key, value: parseJson(row.value_json, 'meta value') })),
    };
  }

  reserve(record) {
    if (!record || !record.client_id || !record.product_id) throw new Error('A hold needs a sale id and a product.');
    const qty = Number(record.qty);
    if (!(qty > 0)) throw new Error('A hold needs a quantity.');
    const at = new Date().toISOString();
    const expires = record.expires_at || new Date(Date.now() + 12 * 3600000).toISOString();
    this._reserve.run(String(record.client_id), String(record.product_id), qty, record.till_id ? String(record.till_id) : null, at, String(expires));
    return { client_id: String(record.client_id), product_id: String(record.product_id), qty };
  }

  reserveFromSale(record) {
    const lines = linesFromSale(record && record.payload);
    for (const line of lines) {
      this.reserve({
        client_id: `${record.client_id}:${line.product_id}`,
        product_id: line.product_id,
        qty: line.qty,
        till_id: record.device_id || null,
      });
    }
    return lines.length;
  }

  reservedByProduct() {
    this._purgeHolds.run(new Date().toISOString());
    const totals = {};
    for (const row of this._holds.all(new Date().toISOString())) {
      totals[row.product_id] = (totals[row.product_id] || 0) + Number(row.qty);
    }
    return totals;
  }

  dropReservation(clientId) {
    const id = String(clientId || '');
    this._dropHold.run(id);
    this.db.prepare('DELETE FROM reservations WHERE client_id LIKE ?').run(`${id}:%`);
    return true;
  }

  rememberVerifier(username, pin, user) {
    const name = String(username || '').trim().toLowerCase();
    if (!name || pin == null || pin === '') throw new Error('Offline sign-in needs a username and the PIN the Worker just accepted.');
    const sealed = seal(pin);
    const saved = publicUser(user) || { username: name };
    this._authSet.run(name, sealed.salt, sealed.hash, JSON.stringify(saved), new Date().toISOString());
    return { username: name };
  }

  checkVerifier(username, pin) {
    const name = String(username || '').trim().toLowerCase();
    const row = this._authGet.get(name);
    if (!row || !matches(pin, row)) return null;
    return parseJson(row.user_json, 'saved sign-in');
  }

  importAll(backup, { replace = false } = {}) {
    if (!backup || backup.format !== 'stockridge-device-backup') {
      throw new Error('That file is not a StockRidge device backup.');
    }
    const run = this.db.transaction(() => {
      if (replace) {
        this.db.prepare('DELETE FROM mirror_rows').run();
        this.db.prepare('DELETE FROM outbox').run();
        this.db.prepare('DELETE FROM meta').run();
      }
      for (const item of backup.rows || []) {
        if (!item || !item.table || item.id == null || !item.row) continue;
        const row = stripSecrets(item.row);
        this._putRow.run(String(item.table), String(item.id), JSON.stringify(row), row.updated_at == null ? null : String(row.updated_at));
      }
      for (const item of backup.outbox || []) {
        if (!item || !item.client_id) continue;
        const existing = this._oneOutbox.get(String(item.client_id));
        if (existing) this._replaceOutbox.run(JSON.stringify(item), String(item.status || 'PENDING'), String(item.client_id));
        else this._putOutbox.run(String(item.client_id), JSON.stringify(item), String(item.status || 'PENDING'), String(item.at || new Date().toISOString()));
      }
      for (const item of backup.meta || []) {
        if (!item || item.key == null) continue;
        this._metaSet.run(String(item.key), JSON.stringify(item.value));
      }
    });
    run();
    return { rows: (backup.rows || []).length, outbox: (backup.outbox || []).length };
  }

  backupTo(dest) {
    return this.db.backup(dest).then(() => dest);
  }
}

module.exports = { DeviceStore, OUTBOX_CAP, LOG_CAP, stripSecrets };
