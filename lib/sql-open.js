'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const Database = require('better-sqlite3-multiple-ciphers');

function isPlainSqlite(file) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch (err) { return false; }
  try {
    const buf = Buffer.alloc(16);
    const n = fs.readSync(fd, buf, 0, 16, 0);
    return n >= 16 && buf.toString('utf8') === 'SQLite format 3\0';
  } finally {
    fs.closeSync(fd);
  }
}

function normalizeKey(key) {
  const text = String(key || '').trim().toLowerCase();
  if (/^[0-9a-f]{64}$/.test(text)) return text;
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

function tune(db) {
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  try { db.pragma('journal_mode = WAL'); } catch (err) { /* a memory database has no WAL file */ }
  try { db.pragma('synchronous = NORMAL'); } catch (err) { /* keep the default */ }
  try { db.pragma('cache_size = -20000'); } catch (err) { /* 20 MB page cache when the build allows it */ }
  try { db.pragma('temp_store = MEMORY'); } catch (err) { /* keep the default */ }
}

function openDatabase(file, key) {
  const existed = fs.existsSync(file) && fs.statSync(file).size > 0;
  const plain = existed && isPlainSqlite(file);
  const db = new Database(file);
  if (key) {
    const hex = normalizeKey(key);
    db.pragma("cipher = 'sqlcipher'");
    if (plain) db.pragma(`rekey = "x'${hex}'"`);
    else db.pragma(`key = "x'${hex}'"`);
  }
  tune(db);
  return db;
}

module.exports = { openDatabase, isPlainSqlite, normalizeKey };
