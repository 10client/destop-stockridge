'use strict';

// When the Worker cannot be reached, the desktop proxy must not hand the
// login form the sentence "The shop server could not be reached." That
// sentence is a dead line. A saved sign-in on this till answers instead.
// A wrong PIN is refused once a verifier exists. The PIN is not stored here.

const { tokenUsable } = require('./offline-auth');

function usernameOf(value) {
  return String(value || '').trim().toLowerCase();
}

function readJson(body) {
  try {
    const parsed = JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body || ''));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    return {};
  }
}

function savedUser(store, username) {
  const me = store.metaGet('me');
  const savedName = me && me.user ? usernameOf(me.user.username) : '';
  if (savedName === username) return me;
  const all = store.metaGet('offline_users');
  const row = all && all[username];
  if (row && row.me && row.me.user && usernameOf(row.me.user.username) === username) return row.me;
  return null;
}

function profileFrom(user, username) {
  const row = user || {};
  return {
    id: row.id || null,
    username: row.username || username,
    fullName: row.fullName || row.full_name || username,
    role: row.role || null,
    roleLabel: row.roleLabel || null,
  };
}

function loginBody(store, username, user, { legacy = false } = {}) {
  const all = store.metaGet('offline_users') || {};
  const saved = all[username] || {};
  const token = !legacy && tokenUsable(saved.token) ? saved.token : null;
  const profile = profileFrom(user, username);
  return {
    ok: true,
    offline: true,
    token,
    user: profile,
    profile,
  };
}

function meBody(store, me) {
  let businesses = [];
  let branches = [];
  try { businesses = store.all('businesses') || []; } catch (err) { businesses = []; }
  try { branches = store.all('branches') || []; } catch (err) { branches = []; }
  return {
    ok: true,
    offline: true,
    user: me.user,
    scope: me.scope || null,
    businesses,
    branches,
    settings: me.settings || {},
    featureLabels: me.featureLabels || {},
    vertical: me.vertical || null,
  };
}

function answerWhenShopDown(store, { method, pathname, body } = {}) {
  if (!store || !pathname) return null;
  const verb = String(method || 'GET').toUpperCase();
  try {
    if (verb === 'POST' && pathname === '/api/auth/login') {
      const parsed = readJson(body);
      const username = usernameOf(parsed.username);
      const pin = parsed.pin == null ? '' : String(parsed.pin);
      if (!username || !pin) {
        return { status: 400, body: { error: 'Enter your username and PIN.', code: 'BAD_REQUEST' } };
      }
      const verified = store.checkVerifier ? store.checkVerifier(username, pin) : null;
      if (verified) {
        const me = savedUser(store, username);
        return { status: 200, body: loginBody(store, username, (me && me.user) || verified) };
      }
      if (store.hasVerifier && store.hasVerifier(username)) {
        return { status: 401, body: { error: 'That PIN does not match the sign-in saved on this till.', code: 'BAD_CREDENTIALS' } };
      }
      const me = savedUser(store, username);
      if (me && me.user) {
        return { status: 200, body: loginBody(store, username, me.user, { legacy: true }) };
      }
      // A fresh till has no saved sign-in. Do not answer here. The shop must
      // accept the username and PIN, the same way the PWA does.
      return null;
    }
    if (verb === 'GET' && pathname === '/api/auth/me') {
      const me = store.metaGet('me');
      if (!me || !me.user) return null;
      return { status: 200, body: meBody(store, me) };
    }
  } catch (err) {
    return {
      status: 503,
      body: { error: 'The saved till could not be opened.', code: 'SAVED_TILL_UNREADABLE' },
    };
  }
  return null;
}

module.exports = { answerWhenShopDown };
