'use strict';
// Loaded only by the desktop window. A browser that opens the hosted site
// does not get this file. It does not store a PIN and it does not talk to Turso.
(function (global) {
  const native = global.stockridgeNative;
  if (!native || !native.store) return;

  function whenReady(fn) {
    if (global.SR && global.SR.api && global.SR.print && global.SR.sync && global.SR.store) fn();
    else setTimeout(() => whenReady(fn), 30);
  }

  function saleLines(record) {
    const lines = record && record.payload && record.payload.lines;
    if (!Array.isArray(lines)) return [];
    return lines.filter((line) => line && line.product_id && Number(line.quantity) > 0);
  }

  function usernameOf(value) {
    return String(value || '').trim().toLowerCase();
  }

  function tokenExpiryMs(token) {
    try {
      const part = String(token || '').split('.')[1];
      if (!part) return 0;
      const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
      const exp = Number(json.exp);
      return Number.isFinite(exp) && exp > 0 ? exp * 1000 : 0;
    } catch (err) {
      return 0;
    }
  }

  function tokenUsable(token) {
    const exp = tokenExpiryMs(token);
    return Boolean(exp && exp > Date.now() + 60 * 1000);
  }

  function userFromProfile(profile, username) {
    const row = profile || {};
    return {
      id: row.id || null,
      username: row.username || username,
      fullName: row.fullName || row.full_name || username,
      role: row.role || null,
      roleLabel: row.roleLabel || null,
      branch: row.branch || (row.branchId ? { id: row.branchId, name: row.branchName || '' } : null),
      business: row.business || (row.businessId ? { id: row.businessId, name: row.businessName || '' } : null),
    };
  }

  async function readUsers() {
    const saved = await native.store.metaGet('offline_users');
    return saved && typeof saved === 'object' ? saved : {};
  }

  async function writeUser(username, patch) {
    const name = usernameOf(username);
    if (!name) return;
    const all = await readUsers();
    const current = all[name] && typeof all[name] === 'object' ? all[name] : {};
    all[name] = Object.assign({}, current, patch, { savedAt: new Date().toISOString() });
    delete all[name].pin;
    delete all[name].pin_hash;
    await native.store.metaSet('offline_users', all);
  }

  async function rememberOnline(creds, out) {
    const name = usernameOf(creds && creds.username);
    if (!name || !creds || creds.pin == null || creds.pin === '' || !out || !out.token) return;
    const profile = out.profile || out.user || { username: name };
    await native.store.rememberVerifier(name, creds.pin, profile);
    await writeUser(name, {
      token: out.token,
      expiresAt: tokenExpiryMs(out.token),
      profile,
    });
  }

  async function persistMirror(username) {
    const name = usernameOf(username || (SRUser() && SRUser().username));
    if (!name) return;
    const me = await native.store.metaGet('me');
    if (!me || !me.user) return;
    await writeUser(name, { me });
  }

  function SRUser() {
    return global.SR && global.SR.state && global.SR.state.user;
  }

  whenReady(() => {
    const SR = global.SR;
    const hint = document.getElementById('login-offline-hint');
    if (hint) {
      hint.textContent = 'You are offline. Enter the same username and PIN you used on this till while connected. The PIN is not stored. Sales use the stock already saved here, and they sync when the line returns.';
    }

    if (SR.api.login && !SR.api.login.offlineWrapped) {
      const online = SR.api.login.bind(SR.api);
      async function login(creds) {
        const name = usernameOf(creds && creds.username);
        try {
          const out = await online(creds);
          await rememberOnline(creds, out);
          return out;
        } catch (err) {
          const offline = err && (err.isOffline || err.retryable || err.status === 0 || err.status >= 500);
          if (!offline) throw err;
          const verified = await native.store.checkVerifier(name, creds && creds.pin);
          if (!verified) {
            throw new Error('This till has not signed that person in while online, or the PIN does not match the one saved on this computer. Connect once, then the same PIN works without the internet.');
          }
          const saved = (await readUsers())[name] || {};
          const me = saved.me && saved.me.user ? saved.me : {
            user: userFromProfile(verified, name),
            scope: null,
            settings: {},
            featureLabels: {},
            vertical: null,
          };
          await native.store.metaSet('me', me);
          const token = tokenUsable(saved.token) ? saved.token : null;
          if (token) SR.api.setToken(token, { remember: true });
          SR.state.user = me.user;
          if (!token) {
            setTimeout(() => {
              if (SR.ui && SR.ui.warn) SR.ui.warn('Signed in offline. The saved sign-in has expired, so these sales stay on this till until you sign in while connected.');
            }, 700);
          }
          setTimeout(() => {
            SR.store.all('stock_batches').then((rows) => {
              if (rows && rows.length) return;
              if (SR.ui && SR.ui.warn) SR.ui.warn('This till has no saved stock yet. Connect once and leave it open until the catalogue finishes saving.');
            }).catch(() => {});
          }, 400);
          return {
            ok: true,
            offline: true,
            token,
            user: me.user,
            profile: { fullName: me.user.fullName, username: me.user.username },
          };
        }
      }
      login.offlineWrapped = true;
      SR.api.login = login;
    }

    if (SR.state.load && !SR.state.load.offlineWrapped) {
      const load = SR.state.load.bind(SR.state);
      async function wrappedLoad(opts) {
        try {
          const state = await load(opts);
          const token = SR.api.loadToken();
          const name = state && state.user && state.user.username;
          if (name && token) await writeUser(name, { token, expiresAt: tokenExpiryMs(token) });
          await persistMirror(name);
          if (opts && opts.force && SR.sync && SR.api.isOnline()) {
            const cursor = await SR.store.metaGet('sync_cursor').catch(() => null);
            await SR.sync.runOnce({ full: !cursor, silent: true }).catch(() => {});
          }
          return state;
        } catch (err) {
          if (err && err.isAuth) throw err;
          if (!(err && (err.isOffline || err.retryable || err.status === 0))) throw err;
          const mirrored = await SR.state.loadFromMirror();
          if (!mirrored) throw err;
          return mirrored;
        }
      }
      wrappedLoad.offlineWrapped = true;
      SR.state.load = wrappedLoad;
    }

    if (SR.print.printText && !SR.print.printText.nativeWrapped) {
      const browserPrint = SR.print.printText.bind(SR.print);
      async function printText(text, opts) {
        const prefs = SR.print.prefs ? SR.print.prefs() : {};
        if (native.printers && (prefs.deviceName || prefs.host)) {
          try {
            await native.printers.print({
              text,
              deviceName: prefs.deviceName || '',
              host: prefs.host || '',
              port: prefs.port || 9100,
              drawer: Boolean(prefs.drawer),
            });
            return;
          } catch (err) {
            if (SR.ui && SR.ui.warn) SR.ui.warn(err.message || 'The named printer did not answer. The usual print window will open.');
          }
        }
        return browserPrint(text, opts || {});
      }
      printText.nativeWrapped = true;
      SR.print.printText = printText;
    }

    if (SR.store.enqueue && !SR.store.enqueue.reserveWrapped) {
      const enqueue = SR.store.enqueue.bind(SR.store);
      async function wrappedEnqueue(op) {
        const record = await enqueue(op);
        if (record && String(record.type).toUpperCase() === 'SALE') {
          await native.store.reserveFromSale(record).catch(() => {});
          if (native.hub) {
            for (const line of saleLines(record)) {
              native.hub.reserve({
                client_id: `${record.client_id}:${line.product_id}`,
                product_id: String(line.product_id),
                qty: Number(line.quantity),
                till_id: record.device_id || null,
              }).catch(() => {});
            }
          }
        }
        return record;
      }
      wrappedEnqueue.reserveWrapped = true;
      SR.store.enqueue = wrappedEnqueue;
    }

    if (SR.sync.pull && !SR.sync.pull.hubWrapped) {
      const pull = SR.sync.pull.bind(SR.sync);
      async function wrappedPull(opts) {
        const result = await pull(opts);
        if (result && result.ok) return result;
        if (!native.hub || !(result && result.offline)) return result;
        const body = await native.hub.mirror().catch(() => null);
        if (!body || !body.tables) return result;
        let rows = 0;
        for (const [table, payload] of Object.entries(body.tables)) {
          if (!payload || !Array.isArray(payload.rows) || !payload.rows.length) continue;
          await SR.store.putMany(table, payload.rows);
          rows += payload.rows.length;
        }
        if (body.reservations) await SR.store.metaSet('hub_reservations', body.reservations);
        await SR.store.log({ kind: 'PULL', status: 'OK', count: rows, message: `LAN hub: ${rows} rows` });
        return { ok: true, rows, fromHub: true };
      }
      wrappedPull.hubWrapped = true;
      SR.sync.pull = wrappedPull;
    }
  });
}(window));
