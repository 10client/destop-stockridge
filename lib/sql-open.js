'use strict';

// The till's stock file must open even when an older program saved it as
// ordinary SQLite. Setting SQLCipher before reading that file makes SQLite
// say "file is not a database" and the window never starts. A plain file is
// read first. Encryption uses the library's default cipher, and only after a
// copy of the file is kept. The stock file is never deleted.

const fs = require('node:fs');
const crypto = require('node:crypto');

function openHandle(file) {
  const Database = require('better-sqlite3-multiple-ciphers');
  return new Database(file);
}

const ENCRYPTED_ATTEMPTS = ['sqlcipher-raw', 'sqlcipher', 'sqleet', 'sqleet-raw'];

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

function cipherMarkPath(file) {
  return `${file}.cipher`;
}

function readCipherMark(file) {
  try {
    const text = fs.readFileSync(cipherMarkPath(file), 'utf8').trim();
    return ENCRYPTED_ATTEMPTS.includes(text) || text === 'sqleet' ? text : null;
  } catch (err) {
    return null;
  }
}

function writeCipherMark(file, scheme) {
  try { fs.writeFileSync(cipherMarkPath(file), `${scheme}\n`, { mode: 0o600 }); } catch (err) { /* the key file is the secret; this is only a hint */ }
}

function openSteps(plain, marked) {
  if (plain) return ['plain-read', 'sqleet-rekey'];
  const steps = [];
  if (marked && !steps.includes(marked)) steps.push(marked);
  for (const id of ENCRYPTED_ATTEMPTS) {
    if (!steps.includes(id)) steps.push(id);
  }
  return steps;
}

function tune(db) {
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  try { db.pragma('journal_mode = WAL'); } catch (err) { /* a memory database has no WAL file */ }
  try { db.pragma('synchronous = NORMAL'); } catch (err) { /* keep the default */ }
  try { db.pragma('cache_size = -20000'); } catch (err) { /* 20 MB page cache when the build allows it */ }
  try { db.pragma('temp_store = MEMORY'); } catch (err) { /* keep the default */ }
}

function assertReadable(db) {
  db.prepare('SELECT count(*) AS n FROM sqlite_master').get();
}

function closeQuiet(db) {
  try { if (db) db.close(); } catch (err) { /* the failed attempt is already unusable */ }
}

function applyScheme(db, scheme, hex) {
  if (scheme === 'sqlcipher' || scheme === 'sqlcipher-raw') {
    db.pragma(`cipher = 'sqlcipher'`);
    db.pragma(`legacy = 4`);
  }
  if (scheme === 'sqlcipher-raw') db.pragma(`key = "x'${hex}'"`);
  else if (scheme === 'sqleet-raw') db.pragma(`key = 'raw:${hex}'`);
  else db.pragma(`key = '${hex}'`);
}

function backupOnce(file) {
  const dest = `${file}.before-encrypt`;
  if (!fs.existsSync(dest)) fs.copyFileSync(file, dest);
  for (const ext of ['-wal', '-shm']) {
    const side = `${file}${ext}`;
    const copy = `${dest}${ext}`;
    if (fs.existsSync(side) && !fs.existsSync(copy)) {
      try { fs.copyFileSync(side, copy); } catch (err) { /* the main file is the stock */ }
    }
  }
  return dest;
}

function restoreBackup(file) {
  const dest = `${file}.before-encrypt`;
  if (!fs.existsSync(dest)) return false;
  fs.copyFileSync(dest, file);
  for (const ext of ['-wal', '-shm']) {
    const copy = `${dest}${ext}`;
    const side = `${file}${ext}`;
    if (fs.existsSync(copy)) fs.copyFileSync(copy, side);
    else if (fs.existsSync(side)) {
      try { fs.rmSync(side); } catch (err) { /* a leftover wal can be ignored if the main file was restored */ }
    }
  }
  return true;
}

function parkSidecars(file) {
  for (const ext of ['-wal', '-shm']) {
    const side = `${file}${ext}`;
    if (!fs.existsSync(side)) continue;
    const parked = `${side}.parked`;
    try {
      if (!fs.existsSync(parked)) fs.renameSync(side, parked);
      else fs.rmSync(side);
    } catch (err) { /* a locked sidecar is left for the next open */ }
  }
}

function openPlain(file) {
  try {
    const db = openHandle(file);
    assertReadable(db);
    return db;
  } catch (err) {
    if (!isPlainSqlite(file)) throw err;
    parkSidecars(file);
    const db = openHandle(file);
    assertReadable(db);
    return db;
  }
}

function sealPlain(file, hex) {
  backupOnce(file);
  const db = openPlain(file);
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (err) { /* the stock is still readable without a checkpoint */ }
  // Do not set cipher='sqlcipher' here. On a plain file that read fails with
  // "file is not a database". The default cipher's rekey is the supported path.
  db.pragma(`rekey = '${hex}'`);
  assertReadable(db);
  db.close();
  const sealed = openHandle(file);
  try {
    applyScheme(sealed, 'sqleet', hex);
    assertReadable(sealed);
    writeCipherMark(file, 'sqleet');
    return sealed;
  } catch (err) {
    closeQuiet(sealed);
    throw err;
  }
}

function openEncrypted(file, hex, marked) {
  let last = null;
  for (const scheme of openSteps(false, marked)) {
    const db = openHandle(file);
    try {
      applyScheme(db, scheme, hex);
      assertReadable(db);
      writeCipherMark(file, scheme);
      return db;
    } catch (err) {
      last = err;
      closeQuiet(db);
    }
  }
  const message = last && last.message ? last.message : 'file is not a database';
  const error = new Error(`This till's saved stock could not be opened (${message}). The database file was not deleted.`);
  error.cause = last;
  throw error;
}

function openDatabase(file, key) {
  const existed = fs.existsSync(file) && fs.statSync(file).size > 0;
  const plain = existed && isPlainSqlite(file);
  const hex = key ? normalizeKey(key) : null;

  if (!existed) {
    const db = openHandle(file);
    if (hex) {
      db.pragma(`rekey = '${hex}'`);
      writeCipherMark(file, 'sqleet');
    }
    tune(db);
    return db;
  }

  if (plain || !hex) {
    if (!hex) {
      const db = openPlain(file);
      tune(db);
      return db;
    }
    try {
      const sealed = sealPlain(file, hex);
      tune(sealed);
      return sealed;
    } catch (err) {
      if (!isPlainSqlite(file)) restoreBackup(file);
      if (isPlainSqlite(file)) {
        const db = openPlain(file);
        tune(db);
        return db;
      }
      return openEncrypted(file, hex, readCipherMark(file));
    }
  }

  try {
    const db = openEncrypted(file, hex, readCipherMark(file));
    tune(db);
    return db;
  } catch (err) {
    if (restoreBackup(file) && isPlainSqlite(file)) {
      const db = openPlain(file);
      tune(db);
      return db;
    }
    throw err;
  }
}

module.exports = {
  openDatabase,
  isPlainSqlite,
  normalizeKey,
  openSteps,
  ENCRYPTED_ATTEMPTS,
};
