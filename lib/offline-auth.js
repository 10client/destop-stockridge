'use strict';

const crypto = require('node:crypto');

const SCRYPT = Object.freeze({ N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

function seal(pin, salt) {
  const bytes = salt && salt.length ? salt : crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pin), bytes, 32, SCRYPT);
  return { salt: bytes.toString('hex'), hash: hash.toString('hex') };
}

function matches(pin, record) {
  if (!record || !record.salt || !record.hash) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(record.salt, 'hex');
    expected = Buffer.from(record.hash, 'hex');
  } catch (err) {
    return false;
  }
  if (salt.length < 8 || expected.length !== 32) return false;
  const got = crypto.scryptSync(String(pin), salt, 32, SCRYPT);
  return crypto.timingSafeEqual(got, expected);
}

function publicUser(user) {
  if (!user || typeof user !== 'object') return null;
  const copy = Object.assign({}, user);
  for (const field of ['pin', 'pin_hash', 'password', 'password_hash', 'secret', 'token']) delete copy[field];
  return copy;
}

module.exports = { seal, matches, publicUser };
