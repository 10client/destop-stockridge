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
    style.textContent = '#install-btn,#nav-install,#login-install{display:none!important}#login-screen[hidden],#shell[hidden]{display:none!important}';
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
  // null until the shop itself answers or misses twice. The browser flag is not this.
  let shopUp = null;
  let healthMisses = 0;
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

  // The window must not call the Worker itself. That call has no browser
  // signature, Cloudflare refuses it, and the screen says "Failed to fetch".
  // Shop calls stay on this computer and the proxy forwards them.
  function localApiUrl(input) {
    const raw = String((input && input.url) || input || '');
    const shop = raw.match(/^https?:\/\/[^/]*stockridge\.workers\.dev(\/api\/[^?#]*)(.*)$/i);
    if (shop) return shop[1] + (shop[2] || '');
    return raw;
  }

  function shopBodyAnswered(status, text) {
    if (global.SRReach && global.SRReach.shopAnswered) return global.SRReach.shopAnswered(status, text);
    const code = Number(status);
    const body = String(text || '');
    if (!Number.isFinite(code) || code <= 0 || code >= 500) return false;
    if (/UPSTREAM_UNREACHABLE|shop server could not be reached|did not answer from this window/i.test(body)) return false;
    if (/"offline"\s*:\s*true/.test(body)) return false;
    return true;
  }

  function leaveLoginIfEntered() {
    const root = document.getElementById('toasts');
    const login = document.getElementById('login-screen');
    const shell = document.getElementById('shell');
    const user = global.SR && global.SR.state && global.SR.state.user;
    if (!user || !login || !root) return;
    const text = String(root.textContent || '');
    if (!/Welcome,|Welcome\.|Signed in offline|Opened the stock saved/.test(text)) return;
    if (login.hidden && login.style.display === 'none') return;
    login.hidden = true;
    login.style.setProperty('display', 'none', 'important');
    if (shell) {
      shell.hidden = false;
      shell.style.removeProperty('display');
    }
  }

  function correctOfflineChrome() {
    if (shopUp !== true) return;
    const chip = document.getElementById('net-chip');
    const text = document.getElementById('net-chip-text');
    if (chip) chip.dataset.state = 'online';
    if (text && text.textContent === 'Offline') text.textContent = 'Online';
    const bar = document.getElementById('offline-bar');
    if (bar) bar.hidden = true;
    const loginNet = document.getElementById('login-net');
    if (loginNet && loginNet.textContent === 'No connection') loginNet.textContent = 'Connected';
    document.querySelectorAll('.alert-warn, .alert-danger').forEach((el) => {
      const sentence = String(el.textContent || '');
      if (/^Offline —/.test(sentence) || /^You are offline\./.test(sentence)) el.remove();
    });
  }

  function installOnlineWrap() {
    const api = global.SR && global.SR.api;
    if (!api || !api.isOnline || api.isOnline.shopWrapped) return;
    const orig = api.isOnline.bind(api);
    function isOnline() {
      if (shopUp === true) return true;
      if (shopUp === false) return false;
      return orig();
    }
    isOnline.shopWrapped = true;
    api.isOnline = isOnline;
  }

  function noteShopResponse(status, text, url) {
    const answered = shopBodyAnswered(status, text);
    if (answered) {
      shopUp = true;
      healthMisses = 0;
      if (global.SR && global.SR.api && global.SR.api.noteReachable) global.SR.api.noteReachable(true);
      installOnlineWrap();
      correctOfflineChrome();
      return;
    }
    if (String(url || '').indexOf('/api/health') === -1) return;
    healthMisses += 1;
    if (healthMisses >= 2) {
      shopUp = false;
      installOnlineWrap();
    }
  }

  function shopMissResponse() {
    return new Response(JSON.stringify({
      error: 'The shop did not answer from this window. Try again.',
      code: 'OFFLINE',
    }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }

  if (global.fetch && !global.__srDeviceFetch) {
    global.__srDeviceFetch = true;
    const origFetch = global.fetch.bind(global);
    global.fetch = function (input, init) {
      const url = localApiUrl(input);
      const localApi = url.indexOf('/api/') !== -1;
      if (!localApi) return origFetch(input, init);
      const target = url === String((input && input.url) || input || '') ? input : url;
      const id = deviceIdNow();
      const headers = new Headers((init && init.headers) || {});
      if (id) headers.set('X-Device-Id', id);
      else headers.delete('X-Device-Id');
      const next = Object.assign({}, init || {}, { headers });
      const isLogin = String(url).indexOf('/api/auth/login') !== -1;
      return origFetch(target, next).then(async (res) => {
        if (!res) return res;
        const copy = res.clone();
        const text = await copy.text().catch(() => '');
        noteShopResponse(res.status, text, url);
        if (res.status !== 401) return res;
        let final = res;
        if (text.includes('SESSION_SUPERSEDED')) {
          const againId = deviceIdNow();
          if (againId) {
            const retryHeaders = new Headers(headers);
            retryHeaders.set('X-Device-Id', againId);
            final = await origFetch(target, Object.assign({}, next, { headers: retryHeaders }));
            const againText = await final.clone().text().catch(() => '');
            noteShopResponse(final.status, againText, url);
          }
        }
        // A 401 is the shop answering. Do not rewrite it as a miss. That made a
        // connected till say Offline. A saved session is kept by ignoring the
        // sign-out event, not by pretending the shop is down.
        return final;
      }).catch(async (err) => {
        // A login must reach the proxy. A fake miss here means a new person is
        // never stored, and the screen then says the shop did not answer.
        if (isLogin) throw err;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        try {
          return await origFetch(target, Object.assign({}, next, { signal: controller.signal }));
        } catch (again) {
          noteShopResponse(502, '{"code":"OFFLINE"}', url);
          return shopMissResponse();
        } finally {
          clearTimeout(timer);
        }
      });
    };
  }

  function patchErrorBlock() {
    const ui = global.SR && global.SR.ui;
    if (!ui || !ui.errorBlock || ui.errorBlock.desktopWrapped) return;
    const orig = ui.errorBlock.bind(ui);
      function errorBlock(err, opts) {
      const message = String((err && err.message) || '');
      if (shopUp !== true && /shop is up/i.test(message)) {
        const soft = new Error('The shop did not answer from this window. Figures saved on this till are still here.');
        soft.code = 'OFFLINE';
        soft.isOffline = true;
        return orig(soft, opts);
      }
      if (shopUp === true) {
        const up = new Error(message || 'This screen did not load. Try again.');
        up.code = 'SHOP_READ_FAILED';
        return orig(up, opts);
      }
      const missed = /failed to fetch/i.test(message)
        || (err && (err.isOffline || err.code === 'OFFLINE' || err.code === 'UPSTREAM_UNREACHABLE'));
      if (!missed) return orig(err, opts);
      const soft = new Error('The shop did not answer from this window. Figures saved on this till are still here.');
      soft.code = 'OFFLINE';
      soft.isOffline = true;
      return orig(soft, opts);
    }
    errorBlock.desktopWrapped = true;
    ui.errorBlock = errorBlock;
  }
  patchErrorBlock();

  function saleLines(record) {
    const lines = record && record.payload && record.payload.lines;
    if (!Array.isArray(lines)) return [];
    return lines.filter((line) => line && line.product_id && Number(line.quantity) > 0);
  }

  async function hubQty(line) {
    const qty = Number(line && line.quantity);
    if (!(qty > 0)) return 0;
    const code = String((line && (line.unit_code || line.unitCode)) || '').trim().toUpperCase();
    const named = Number(line && (line.unit_factor || line.unitFactor));
    const store = global.SR && global.SR.store;
    if (store && store.all && line.product_id) {
      const units = await store.all('product_units', {
        where: (row) => !Number(row.is_deleted) && String(row.product_id) === String(line.product_id),
      }).catch(() => []);
      const hit = (units || []).find((row) => String(row.code || '').toUpperCase() === code)
        || (units || []).find((row) => String(row.name || '').toUpperCase() === code);
      if (hit && Number(hit.quantity_in_base) > 0) return qty * Number(hit.quantity_in_base);
    }
    return qty * (named > 0 ? named : 1);
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
    const existing = (await readUsers())[name] || {};
    const patch = {
      token: out.token,
      expiresAt: tokenExpiryMs(out.token),
      profile,
    };
    if (!existing.me) {
      patch.me = {
        user: userFromProfile(profile, name),
        scope: out.scope || null,
        settings: {},
        featureLabels: {},
        vertical: null,
      };
    }
    await writeUser(name, patch);
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
    if (!verified && !known) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        if (native.store.checkVerifier) verified = await native.store.checkVerifier(name, pin);
      } catch (err) { verified = verified || null; }
    }
    const saved = (await readUsers())[name] || {};
    const cachedMe = await native.store.metaGet('me');
    const savedName = cachedMe && cachedMe.user ? usernameOf(cachedMe.user.username) : '';
    if (!verified && savedName !== name && !(saved.me && saved.me.user && usernameOf(saved.me.user.username) === name)) {
      const missed = new Error('This person has not signed in on this till while the shop answered. Sign in once while the shop answers, and this till will remember them. The PIN is not stored.');
      missed.code = 'OFFLINE_UNKNOWN_USER';
      throw missed;
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
    if (global.SR && global.SR.api && global.SR.api.setToken) {
      global.SR.api.setToken(token || null, { remember: Boolean(token) });
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
        const text = await res.text().catch(() => '');
        let body = {};
        try { body = text ? JSON.parse(text) : {}; } catch (err) { body = {}; }
        // The saved-till door answers 200 offline:true when the proxy missed.
        // That is not the shop holding this session.
        if (body && body.offline) return null;
        if (res.ok) return true;
        if (text.includes('SESSION_SUPERSEDED') || text.includes('SESSION_REVOKED') || text.includes('NO_TOKEN') || text.includes('BAD_TOKEN')) return false;
        return null;
      } catch (err) {
        return null;
      }
    }
    async function clearSavedToken(username) {
      await writeUser(username, { token: null, expiresAt: 0 }).catch(() => {});
    }
    async function askShop(creds) {
      const id = deviceIdNow();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 40000);
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(id ? { 'X-Device-Id': id } : {}),
          },
          body: JSON.stringify({
            username: creds && creds.username,
            pin: creds && creds.pin,
            remember: !creds || creds.remember !== false,
            deviceId: id || undefined,
          }),
          signal: controller.signal,
          cache: 'no-store',
        });
        const text = await res.text();
        let body = {};
        try { body = text ? JSON.parse(text) : {}; } catch (err) { body = {}; }
        if (!res.ok) {
          const err = new Error((body && body.error) || 'Sign-in failed.');
          err.status = res.status;
          err.code = (body && body.code) || `HTTP_${res.status}`;
          err.payload = body;
          err.isOffline = res.status >= 500 || err.code === 'OFFLINE' || err.code === 'UPSTREAM_UNREACHABLE'
            || /shop server could not be reached|did not answer from this window|failed to fetch/i.test(err.message);
          throw err;
        }
        if (body.token && SR.api.setToken) SR.api.setToken(body.token, { remember: !creds || creds.remember !== false });
        return body;
      } catch (err) {
        if (err && err.code) throw err;
        const wrapped = new Error(err && err.name === 'AbortError'
          ? 'The server did not answer in time. Check the connection and try again.'
          : 'The shop did not answer from this window. Try again.');
        wrapped.code = 'OFFLINE';
        wrapped.isOffline = true;
        wrapped.status = 0;
        throw wrapped;
      } finally {
        clearTimeout(timer);
      }
    }
    async function takeLive(creds) {
      try {
        let out = await askShop(creds);
        if (!out || out.offline || !out.token) return null;
        await rememberOnline(creds, out);
        if ((await sessionHeld(out.token)) !== false) return out;
        out = await askShop(creds);
        if (!out || out.offline || !out.token) return null;
        await rememberOnline(creds, out);
        return out;
      } catch (err) {
        if (!shopUnreachable(err)) throw err;
        return null;
      }
    }
    async function shopAnswers() {
      try {
        const res = await fetch('/api/health', { method: 'GET', cache: 'no-store' });
        const text = await res.text().catch(() => '');
        if (global.SRReach && global.SRReach.shopAnswered) return global.SRReach.shopAnswered(res.status, text);
        return res.status > 0 && res.status < 500
          && !/UPSTREAM_UNREACHABLE|shop server could not be reached|did not answer/i.test(text);
      } catch (err) {
        return false;
      }
    }
    async function login(creds) {
      localSessionOnly = false;
      await deviceReady;
      let live = await takeLive(creds);
      if (!live && await shopAnswers()) live = await takeLive(creds);
      if (live && live.token && !live.offline) {
        localSessionOnly = false;
        if (SR.api.noteReachable) SR.api.noteReachable(true);
        else if (SR.api.emit) SR.api.emit('net', { online: true });
        return live;
      }
      if (await shopAnswers()) {
        const stuck = new Error('The shop is up, but this sign-in did not finish. Try again.');
        stuck.code = 'LOGIN_NOT_STUCK';
        throw stuck;
      }
      const offline = await signInOffline(creds);
      // The saved token is not this sign-in. If the shop still accepts it,
      // stay on that session. If the shop says it was replaced, sign in there
      // instead of showing that notice over the saved till. The PIN stays in
      // this call only.
      const held = offline && offline.token ? await sessionHeld(offline.token) : null;
      if (held === true) {
        localSessionOnly = false;
        if (SR.api.noteReachable) SR.api.noteReachable(true);
        return Object.assign({}, offline, { offline: false });
      }
      if (held === false && offline && offline.token) {
        if (SR.api.setToken) SR.api.setToken(null);
        await clearSavedToken(creds && creds.username);
        const again = await takeLive(creds);
        if (again) {
          localSessionOnly = false;
          if (SR.api.noteReachable) SR.api.noteReachable(true);
          return again;
        }
        offline.token = null;
      }
      localSessionOnly = true;
      // Do not force the chip to Offline. A browser miss is not the shop.
      // The probe moves the chip only after the shop has missed twice.
      if (SR.api.probe) SR.api.probe({ force: true }).catch(() => {});
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
    patchErrorBlock();
    installOnlineWrap();
    setInterval(() => { installOnlineWrap(); correctOfflineChrome(); leaveLoginIfEntered(); }, 1000);
    if (global.SR && global.SR.api && global.SR.api.emit && !global.SR.api.emit.desktopWrapped) {
      const emit = global.SR.api.emit.bind(global.SR.api);
      function wrappedEmit(event, detail) {
        // The shop answered with a rejected old token. Keep the saved till open.
        // Do not turn that answer into Offline.
        if (localSessionOnly && event === 'auth') return;
        return emit(event, detail);
      }
      wrappedEmit.desktopWrapped = true;
      global.SR.api.emit = wrappedEmit;
    }
    const SR = global.SR;
    const hint = document.getElementById('login-offline-hint');
    if (hint) {
      const saved = native.store.listVerifiers ? native.store.listVerifiers() : Promise.resolve([]);
      Promise.resolve(saved).then((names) => {
        const people = Array.isArray(names) ? names.filter(Boolean) : [];
        hint.textContent = people.length
          ? `People saved on this till: ${people.join(', ')}. Each can sign in here when the shop does not answer. The PIN is not stored. A new person is saved the first time the shop accepts them.`
          : 'Sign in once while the shop answers. This till then remembers that person, and they can sign in again when the shop does not answer. The PIN is not stored.';
      }).catch(() => {
        hint.textContent = 'Sign in once while the shop answers. This till then remembers that person, and they can sign in again when the shop does not answer. The PIN is not stored.';
      });
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
          // Do not sync inside load. A 401 from that sync was signing the till
          // out before the login page had been left, so the welcome toast sat
          // on the sign-in form. The shell starts the sync after it is open.
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
        if (record && String(record.type).toUpperCase() === 'SALE' && native.hub) {
          // Do not reserveFromSale on this till. The shelf statement is the
          // count. A hold on top of that cut hides the product. Other tills
          // still hear the sale, in base units when the ladder is here.
          for (const line of saleLines(record)) {
            const qty = await hubQty(line);
            native.hub.reserve({
              client_id: `${record.client_id}:${line.product_id}`,
              product_id: String(line.product_id),
              qty,
              till_id: record.device_id || null,
            }).catch(() => {});
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
          if (table === 'stock_batches' && native.store.replayShelf) await native.store.replayShelf().catch(() => {});
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
        const pullError = await SR.store.metaGet('sync_pull_error').catch(() => null);
        const catalogueEmpty = await SR.store.metaGet('catalogue_empty').catch(() => null);
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
          pullError,
          catalogueEmpty,
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
