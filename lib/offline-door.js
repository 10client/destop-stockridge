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

function idSet(list) {
  const out = new Set();
  for (const id of list || []) {
    if (id != null && id !== '') out.add(String(id));
  }
  return out;
}

function rowsOf(store, table) {
  try {
    const rows = store.all(table);
    return Array.isArray(rows) ? rows.filter((row) => row && row.id != null) : [];
  } catch (err) {
    return [];
  }
}

function roleOf(user) {
  return String((user && user.role) || '').toUpperCase();
}

function businessesFor(me, rows, branches) {
  const scope = (me && me.scope) || {};
  const user = (me && me.user) || {};
  if (scope.allBusinesses) return rows;
  const ids = idSet(scope.businessIds);
  if (user.business && user.business.id) ids.add(String(user.business.id));
  if (scope.pinnedBusinessId) ids.add(String(scope.pinnedBusinessId));
  const pin = user.branch && user.branch.id;
  if (pin) {
    const branch = (branches || []).find((row) => String(row.id) === String(pin));
    if (branch && branch.business_id) ids.add(String(branch.business_id));
  }
  if (!ids.size) {
    if (roleOf(user) === 'OWNER' || roleOf(user) === 'ADMIN') return rows;
    return [];
  }
  return rows.filter((row) => ids.has(String(row.id)));
}

function branchesForAccount(me, rows, businesses) {
  const scope = (me && me.scope) || {};
  const user = (me && me.user) || {};
  if (scope.allBranches) return rows;
  const ids = idSet(scope.branchIds);
  if (user.branch && user.branch.id) ids.add(String(user.branch.id));
  if (scope.pinnedBranchId) ids.add(String(scope.pinnedBranchId));
  if (ids.size) return rows.filter((row) => ids.has(String(row.id)));
  const biz = new Set((businesses || []).map((row) => String(row.id)));
  if (!biz.size) return [];
  return rows.filter((row) => biz.has(String(row.business_id)));
}

function meBody(store, me) {
  const branchRows = rowsOf(store, 'branches');
  const businesses = businessesFor(me, rowsOf(store, 'businesses'), branchRows);
  const branches = branchesForAccount(me, branchRows, businesses);
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
