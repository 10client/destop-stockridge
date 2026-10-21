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
  if (plain) return ['plain-read'];
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
  const setups = [
    (db) => {},
    (db) => { db.pragma(`cipher = 'none'`); },
    (db) => { db.pragma(`key = ''`); },
  ];
  let last = null;
  const passes = [() => {}, () => parkSidecars(file)];
  for (const prepare of passes) {
    prepare();
    for (const setup of setups) {
      const db = openHandle(file);
      try {
        setup(db);
        assertReadable(db);
        return db;
      } catch (err) {
        last = err;
        closeQuiet(db);
      }
    }
    if (!isPlainSqlite(file)) break;
  }
  throw last || new Error('file is not a database');
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

function quarantine(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const aside = `${file}.unreadable-${stamp}`;
  try { fs.renameSync(file, aside); }
  catch (err) {
    try {
      fs.copyFileSync(file, aside);
      fs.rmSync(file, { force: true });
    } catch (copyErr) { /* the next open still must not use this path if it is unreadable */ }
  }
  for (const ext of ['-wal', '-shm']) {
    const side = `${file}${ext}`;
    if (!fs.existsSync(side)) continue;
    try { fs.renameSync(side, `${aside}${ext}`); } catch (err) { /* leave the sidecar; the main file is already aside */ }
  }
  return aside;
}

function startFresh(file) {
  const db = openHandle(file);
  try { db.pragma(`cipher = 'none'`); } catch (err) { /* a plain new file does not need a cipher */ }
  tune(db);
  return db;
}

function openDatabase(file, key) {
  const existed = fs.existsSync(file) && fs.statSync(file).size > 0;
  const plain = existed && isPlainSqlite(file);
  const hex = key ? normalizeKey(key) : null;

  if (!existed) {
    return startFresh(file);
  }

  // The older program saved a normal SQLite file. Do not rekey it on startup.
  // That rekey is what made SQLite say the file is not a database.
  if (plain) {
    try {
      const db = openPlain(file);
      tune(db);
      return db;
    } catch (err) {
      const aside = quarantine(file);
      const db = startFresh(file);
      writeCipherMark(file, 'plain');
      try {
        fs.writeFileSync(`${file}.recovered`, `Set aside ${aside}\n${err && err.message ? err.message : err}\n`);
      } catch (writeErr) { /* the new file is already open */ }
      return db;
    }
  }

  if (hex) {
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
      const aside = quarantine(file);
      const db = startFresh(file);
      try {
        fs.writeFileSync(`${file}.recovered`, `Set aside ${aside}\n${err && err.message ? err.message : err}\n`);
      } catch (writeErr) { /* the new file is already open */ }
      return db;
    }
  }

  const db = openPlain(file);
  tune(db);
  return db;
}

module.exports = {
  openDatabase,
  isPlainSqlite,
  normalizeKey,
  openSteps,
  ENCRYPTED_ATTEMPTS,
};
