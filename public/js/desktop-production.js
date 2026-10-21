'use strict';
// Loaded only by the desktop window. A browser that opens the hosted site
// does not get this file. It does not store a PIN and it does not talk to Turso.
(function (global) {
  const native = global.stockridgeNative;
  if (!native || !native.store) return;

  // The website keeps Download and Install. This window is already the app.
  if (!document.getElementById('sr-native-install')) {
    const style = document.createElement('style');
    style.id = 'sr-native-install';
    style.textContent = '#install-btn,#nav-install,#login-install{display:none!important}';
    (document.head || document.documentElement).appendChild(style);
  }

  function whenReady(fn) {
    if (global.SR && global.SR.api && global.SR.print && global.SR.sync && global.SR.store) fn();
    else setTimeout(() => whenReady(fn), 30);
  }

  // One till, one device id. localStorage can be empty on a new window origin
  // while SQLite still has the id the shop already bound. A second id, or a
  // missing id, makes the shop say this computer was signed out.
  let pinnedDevice = null;
  // A saved till is open because the shop login did not stick. A later refusal
  // of the old token must not sign that till out or show the other-device notice.
  let localSessionOnly = false;
  const deviceReady = (async function pinDevice() {
    let id = null;
    let label = 'Windows till';
    // The open session was bound to the id this window already sent, which
    // lives in localStorage. Keep that. SQLite is only the fallback when the
    // window has no id yet, so a new origin does not invent a second one.
    try {
      const ls = localStorage.getItem('sr.deviceId');
      if (ls && ls !== 'SR-UNKNOWN') id = ls;
    } catch (err) { /* SQLite is the copy that survives */ }
    if (!id) {
      try { id = await native.store.metaGet('device_id'); } catch (err) { id = null; }
    }
    try {
      const savedLabel = await native.store.metaGet('device_label');
      if (savedLabel) label = String(savedLabel);
    } catch (err) { /* the id is what the shop checks */ }
    if (!id || id === 'SR-UNKNOWN') {
      const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
      const block = (n) => Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
      id = `SR-${block(4)}-${block(4)}`;
    }
    pinnedDevice = { id: String(id), label };
    try {
      localStorage.setItem('sr.deviceId', pinnedDevice.id);
      localStorage.setItem('sr.deviceLabel', pinnedDevice.label);
    } catch (err) { /* the shop still gets the header below */ }
    try {
      await native.store.metaSet('device_id', pinnedDevice.id);
      await native.store.metaSet('device_label', pinnedDevice.label);
    } catch (err) { /* localStorage still holds it for this window */ }
    return pinnedDevice;
  })();
  const SRDevice = global.SR = global.SR || {};
  SRDevice.device = SRDevice.device || {};
  SRDevice.device.current = () => pinnedDevice || { id: deviceIdNow() || 'SR-UNKNOWN', label: 'Windows till' };
  SRDevice.device.get = () => deviceReady;

  function deviceIdNow() {
    if (pinnedDevice && pinnedDevice.id) return pinnedDevice.id;
    try {
      const ls = localStorage.getItem('sr.deviceId');
      if (ls && ls !== 'SR-UNKNOWN') return ls;
    } catch (err) { /* not ready yet */ }
    return '';
  }

  if (global.fetch && !global.__srDeviceFetch) {
    global.__srDeviceFetch = true;
    const origFetch = global.fetch.bind(global);
    global.fetch = function (input, init) {
      const url = String((input && input.url) || input || '');
      const localApi = url.indexOf('/api/') !== -1;
      if (!localApi) return origFetch(input, init);
      const id = deviceIdNow();
      const headers = new Headers((init && init.headers) || {});
      if (id) headers.set('X-Device-Id', id);
      else headers.delete('X-Device-Id');
      const next = Object.assign({}, init || {}, { headers });
      return origFetch(input, next).then(async (res) => {
        if (!res || res.status !== 401) return res;
        const copy = res.clone();
        const text = await copy.text().catch(() => '');
        let final = res;
        if (text.includes('SESSION_SUPERSEDED')) {
          const againId = deviceIdNow();
          if (againId) {
            const retryHeaders = new Headers(headers);
            retryHeaders.set('X-Device-Id', againId);
            final = await origFetch(input, Object.assign({}, next, { headers: retryHeaders }));
          }
        }
        if (localSessionOnly && final && final.status === 401 && url.indexOf('/api/auth/login') === -1) {
          return new Response(JSON.stringify({
            error: 'The shop server could not be reached.',
            code: 'UPSTREAM_UNREACHABLE',
          }), { status: 502, headers: { 'Content-Type': 'application/json' } });
        }
        return final;
      });
    };
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

  function shopUnreachable(err) {
    if (!err) return false;
    const payload = err.payload && typeof err.payload === 'object' ? err.payload : null;
    const code = String(err.code || (payload && payload.code) || '');
    if (code === 'UPSTREAM_UNREACHABLE' || code === 'OFFLINE') return true;
    if (/shop server could not be reached|did not answer from this window|failed to fetch/i.test(String(err.message || ''))) return true;
    if (err.isOffline) return true;
    return Number(err.status) === 0;
  }

  async function signInOffline(creds) {
    const name = usernameOf(creds && creds.username);
    const pin = creds && creds.pin;
    let verified = null;
    try {
      if (native.store.checkVerifier) verified = await native.store.checkVerifier(name, pin);
    } catch (err) { verified = null; }
    let known = false;
    try {
      if (!verified && native.store.hasVerifier) known = Boolean(await native.store.hasVerifier(name));
    } catch (err) { known = false; }
    if (!verified && known) {
      throw new Error('That PIN does not match the sign-in saved on this till.');
    }
    const saved = (await readUsers())[name] || {};
    const cachedMe = await native.store.metaGet('me');
    const savedName = cachedMe && cachedMe.user ? usernameOf(cachedMe.user.username) : '';
    if (!verified && savedName !== name && !(saved.me && saved.me.user && usernameOf(saved.me.user.username) === name)) {
      throw new Error('The shop did not answer from this window. Try the same username and PIN again.');
    }
    let me = saved.me && saved.me.user ? saved.me : null;
    if (!me && savedName === name && cachedMe && cachedMe.user) me = cachedMe;
    if (!me || !me.user) {
      me = {
        user: userFromProfile(verified, name),
        scope: null,
        settings: {},
        featureLabels: {},
        vertical: null,
      };
    }
    await native.store.metaSet('me', me);
    const token = tokenUsable(saved.token) ? saved.token : null;
    if (token && global.SR && global.SR.api && global.SR.api.setToken) {
      global.SR.api.setToken(token, { remember: true });
    }
    if (global.SR && global.SR.state) global.SR.state.user = me.user;
    return {
      ok: true,
      offline: true,
      token,
      user: me.user,
      profile: { fullName: me.user.fullName, username: me.user.username },
    };
  }

  function installOfflineLogin() {
    const SR = global.SR;
    if (!SR || !SR.api || !SR.api.login || SR.api.login.offlineWrapped) return;
    const online = SR.api.login.bind(SR.api);
    async function sessionHeld(token) {
      await deviceReady;
      const id = deviceIdNow();
      try {
        const res = await fetch('/api/auth/me', {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            ...(id ? { 'X-Device-Id': id } : {}),
          },
          cache: 'no-store',
        });
        if (res.ok) return true;
        const text = await res.text().catch(() => '');
        if (text.includes('SESSION_SUPERSEDED') || text.includes('SESSION_REVOKED') || text.includes('NO_TOKEN') || text.includes('BAD_TOKEN')) return false;
        return null;
      } catch (err) {
        return null;
      }
    }
    async function clearSavedToken(username) {
      await writeUser(username, { token: null, expiresAt: 0 }).catch(() => {});
    }
    async function takeLive(creds) {
      try {
        let out = await online(creds);
        if (!out || out.offline || !out.token) return null;
        await rememberOnline(creds, out);
        if ((await sessionHeld(out.token)) !== false) return out;
        out = await online(creds);
        if (!out || out.offline || !out.token) return null;
        await rememberOnline(creds, out);
        return out;
      } catch (err) {
        if (!shopUnreachable(err)) throw err;
        return null;
      }
    }
    async function login(creds) {
      localSessionOnly = false;
      await deviceReady;
      const live = await takeLive(creds);
      if (live) return live;
      const offline = await signInOffline(creds);
      // The saved token is not this sign-in. If the shop still accepts it,
      // stay on that session. If the shop says it was replaced, sign in there
      // instead of showing that notice over the saved till. The PIN stays in
      // this call only.
      const held = offline && offline.token ? await sessionHeld(offline.token) : null;
      if (held === true) return Object.assign({}, offline, { offline: false });
      if (held === false && offline && offline.token) {
        if (SR.api.setToken) SR.api.setToken(null);
        await clearSavedToken(creds && creds.username);
        const again = await takeLive(creds);
        if (again) return again;
        offline.token = null;
      }
      localSessionOnly = true;
      if (SR.api.emit) SR.api.emit('net', { online: false });
      return offline;
    }
    login.offlineWrapped = true;
    SR.api.login = login;
  }

  installOfflineLogin();
  const loginWait = setInterval(() => {
    installOfflineLogin();
    if (global.SR && global.SR.api && global.SR.api.login && global.SR.api.login.offlineWrapped) clearInterval(loginWait);
  }, 30);

  whenReady(() => {
    const SR = global.SR;
    const hint = document.getElementById('login-offline-hint');
    if (hint) {
      hint.textContent = 'You are offline. Enter the same username and PIN you used on this till while connected. The PIN is not stored. Sales use the stock already saved here, and they sync when the line returns.';
    }

    if (SR.api.login && !SR.api.login.offlineWrapped) {
      installOfflineLogin();
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
          if (!shopUnreachable(err)) throw err;
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

    installSaveIndicator(SR);
  });

  function installSaveIndicator(SR) {
    if (!document.getElementById('sr-save-style')) {
      const style = document.createElement('style');
      style.id = 'sr-save-style';
      style.textContent = [
        '#save-chip { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 10px; border-radius: 20px; border: 1px solid var(--line-strong, #c9c3b8); background: var(--surface-2, #f4f1ea); font-size: .78rem; font-weight: 700; cursor: pointer; white-space: nowrap; }',
        '#save-chip .net-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }',
        '#save-chip[data-state="saved"] { background: #e7f6ee; border-color: #1f8a4c; color: #146c3a; }',
        '#save-chip[data-state="saving"], #save-chip[data-state="waiting"] { background: #e8f1fb; border-color: #2f6fad; color: #1d4f82; }',
        '#save-chip[data-state="held"], #save-chip[data-state="partial"], #save-chip[data-state="empty"] { background: #fff4df; border-color: #b7791f; color: #8a5a10; }',
        '#save-chip[data-state="attention"] { background: #fde8e4; border-color: #c23a2a; color: #8d2418; }',
        '#save-status-card { margin: 0 0 16px; border: 1px solid var(--line-strong, #c9c3b8); border-radius: 14px; background: var(--surface, #fff); }',
        '#save-status-card .card-body { padding: 16px 18px; }',
        '#save-status-card h2 { margin: 0 0 6px; font-size: 1.15rem; }',
        '#save-status-card p { margin: 0; }',
        '#save-status-card[data-state="saved"] { border-color: #1f8a4c; }',
        '#save-status-card[data-state="attention"] { border-color: #c23a2a; }',
      ].join('\n');
      document.head.appendChild(style);
    }
    const net = document.getElementById('net-chip');
    let chip = document.getElementById('save-chip');
    if (net && !chip) {
      chip = document.createElement('button');
      chip.type = 'button';
      chip.id = 'save-chip';
      chip.className = 'chip chip-save';
      chip.hidden = true;
      chip.innerHTML = '<span class="net-dot" aria-hidden="true"></span><span id="save-chip-label">Checking…</span>';
      net.insertAdjacentElement('afterend', chip);
    }
    if (chip && !chip.dataset.bound) {
      chip.dataset.bound = '1';
      chip.addEventListener('click', () => {
        if (SR.app && SR.app.navigate) SR.app.navigate('/sync');
      });
    }
    let painting = false;
    let paintAgain = false;
    function esc(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
    async function paint() {
      if (painting) { paintAgain = true; return; }
      if (!SR.saveStatus || !SR.sync || !SR.store) return;
      painting = true;
      try {
        const status = SR.sync.status();
        const stats = await SR.sync.queueStats().catch(() => ({ pending: 0, failed: 0 }));
        const lastPullAt = await SR.store.metaGet('last_pull_at').catch(() => null);
        const truncated = await SR.store.metaGet('sync_truncated').catch(() => []);
        const incomplete = await SR.store.metaGet('sync_incomplete_since').catch(() => null);
        const stock = await SR.store.all('stock_batches').catch(() => []);
        const products = await SR.store.all('products').catch(() => []);
        const report = SR.saveStatus.decide({
          running: status.running,
          online: SR.api.isOnline(),
          pending: stats.pending,
          failed: stats.failed,
          lastPullAt,
          truncated,
          incomplete,
          stockRows: stock.length,
          productRows: products.length,
        });
        const chip = document.getElementById('save-chip');
        const label = document.getElementById('save-chip-label');
        if (chip && label && SR.state && SR.state.user) {
          chip.hidden = false;
          chip.dataset.state = report.state;
          label.textContent = report.label;
          chip.title = report.detail;
          chip.setAttribute('aria-label', report.label + '. ' + report.detail);
        } else if (chip) {
          chip.hidden = true;
        }
        paintPage(report, { lastPullAt, stock: stock.length, products: products.length, pending: stats.pending, failed: stats.failed });
      } finally {
        painting = false;
        if (paintAgain) { paintAgain = false; paint(); }
      }
    }
    function paintPage(report, counts) {
      if (!location.pathname.startsWith('/sync')) return;
      const view = document.getElementById('view');
      if (!view) return;
      const cards = document.querySelectorAll('[id="save-status-card"]');
      let card = cards[0];
      for (let i = 1; i < cards.length; i += 1) cards[i].remove();
      if (!card) {
        card = document.createElement('section');
        card.id = 'save-status-card';
        card.className = 'card';
        view.prepend(card);
      }
      card.dataset.state = report.state;
      const when = counts.lastPullAt ? String(counts.lastPullAt).replace('T', ' ').slice(0, 16) : 'not yet';
      card.innerHTML = '<div class="card-body"><h2>' + esc(report.label) + '</h2><p>' + esc(report.detail) + '</p><p class="sub" style="margin-top:8px">Catalogue saved: ' + esc(when) + ' · ' + counts.products + ' products · ' + counts.stock + ' stock rows · ' + counts.pending + ' waiting · ' + counts.failed + ' refused</p></div>';
    }
    paint();
    if (SR.sync.on) SR.sync.on('change', () => { paint(); });
    if (SR.api.on) {
      SR.api.on('net', () => { paint(); });
      SR.api.on('queue', () => { paint(); });
    }
    if (SR.state && SR.state.on) {
      SR.state.on('loaded', () => { paint(); });
      SR.state.on('cleared', () => { paint(); });
    }
    if (!history.pushState.saveStatusWrapped) {
      const push = history.pushState.bind(history);
      const replace = history.replaceState.bind(history);
      history.pushState = function () {
        const out = push.apply(history, arguments);
        setTimeout(paint, 80);
        return out;
      };
      history.replaceState = function () {
        const out = replace.apply(history, arguments);
        setTimeout(paint, 80);
        return out;
      };
      history.pushState.saveStatusWrapped = true;
    }
    const view = document.getElementById('view');
    if (view && window.MutationObserver) {
      const observer = new MutationObserver(() => {
        if (location.pathname.startsWith('/sync') && !document.getElementById('save-status-card')) paint();
      });
      observer.observe(view, { childList: true });
    }
    setInterval(paint, 4000);
    window.addEventListener('popstate', () => { setTimeout(paint, 50); });
  }
}(window));
