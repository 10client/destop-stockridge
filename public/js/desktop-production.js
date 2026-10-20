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

  whenReady(() => {
    const SR = global.SR;

    if (SR.api.login && !SR.api.login.offlineWrapped) {
      const online = SR.api.login.bind(SR.api);
      async function login(creds) {
        try {
          const out = await online(creds);
          if (out && out.token && creds && creds.username) {
            await native.store.rememberVerifier(creds.username, creds.pin, out.user || SR.state.user || { username: creds.username });
          }
          return out;
        } catch (err) {
          const offline = err && (err.isOffline || err.retryable);
          if (!offline) throw err;
          const user = await native.store.checkVerifier(creds && creds.username, creds && creds.pin);
          if (!user || !SR.api.hasToken()) {
            throw new Error('This till has not signed that person in while online. Connect once, then the same PIN works without the internet.');
          }
          SR.state.user = user;
          return { token: true, user, offline: true };
        }
      }
      login.offlineWrapped = true;
      SR.api.login = login;
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
