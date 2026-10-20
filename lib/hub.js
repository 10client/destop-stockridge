'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

// A LAN hub shares the last mirror this till pulled from the Worker, and
// the quantities other tills have queued but the Worker has not accepted.
// It does not validate a sale and it does not open Turso. The Worker remains
// the only writer of the cloud books.

const SECRET_HEADER = 'x-stockridge-hub';
const MAX_BODY = 2 * 1024 * 1024;

function sameSecret(got, expected) {
  const a = Buffer.from(String(got || ''));
  const b = Buffer.from(String(expected || ''));
  if (!b.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('That hub request is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve(null);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (err) { reject(new Error('The hub could not read that request.')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

function forbidden(body) {
  const text = JSON.stringify(body || {});
  return /pin_hash|turso|authToken|authorization|password/i.test(text);
}

function mirrorPayload(store) {
  const tables = {};
  for (const item of store.tableStats().tables) {
    tables[item.table] = { rows: store.all(item.table) };
  }
  return {
    ok: true,
    fromHub: true,
    tables,
    reservations: store.reservedByProduct(),
  };
}

function startHub({ store, secret, host = '0.0.0.0', port = 0 } = {}) {
  if (!store) throw new Error('The LAN hub needs this till\'s database.');
  if (!secret || String(secret).length < 16) throw new Error('The LAN hub needs a secret of at least 16 characters.');

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (!sameSecret(req.headers[SECRET_HEADER], secret)) {
        send(res, 401, { error: 'This LAN hub refused the request.' });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/hub/v1/health') {
        send(res, 200, { ok: true, engine: 'sqlite', reservations: store.reservedByProduct() });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/hub/v1/mirror') {
        send(res, 200, mirrorPayload(store));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/hub/v1/reservations') {
        send(res, 200, { ok: true, holds: store.reservedByProduct() });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/hub/v1/reservations') {
        const body = await readBody(req);
        if (forbidden(body)) {
          send(res, 400, { error: 'The hub does not accept a PIN, a token, or a Turso secret.' });
          return;
        }
        const saved = store.reserve(body || {});
        send(res, 200, { ok: true, client_id: saved.client_id });
        return;
      }
      if (req.method === 'DELETE' && url.pathname.startsWith('/hub/v1/reservations/')) {
        const clientId = decodeURIComponent(url.pathname.slice('/hub/v1/reservations/'.length));
        store.dropReservation(clientId);
        send(res, 200, { ok: true });
        return;
      }
      send(res, 404, { error: 'That hub path is not served.' });
    } catch (err) {
      if (!res.headersSent) send(res, 400, { error: err.message || 'The hub refused that request.' });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve({
        server,
        port: address.port,
        url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${address.port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

module.exports = { startHub, SECRET_HEADER };
