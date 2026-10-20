'use strict';
// Local origin for the desktop window. Static files come from the StockRidge
// checkout. /api is forwarded to the Worker. The Turso token never comes here.

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
});

const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade', 'host']);

function publicDir(root) {
  return path.resolve(root, 'public');
}

function safeFile(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const file = path.resolve(publicDir(root), rel);
  const base = publicDir(root);
  if (file !== base && !file.startsWith(base + path.sep)) return null;
  return file;
}

function desktopIndex(html) {
  const injected = html.includes('store-native.js')
    ? html
    : html.replace(
      /(<script src="\/js\/store\.js[^"]*"><\/script>)/,
      '$1\n<script src="/js/store-native.js"></script>',
    );
  const withProduction = injected.includes('desktop-production.js')
    ? injected
    : injected.replace('</body>', '<script src="/js/desktop-production.js"></script>\n</body>');
  return withProduction.replace(
    /if \('serviceWorker' in navigator\) \{[\s\S]*?\}\s*\n\s*<\/script>/,
    `if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      regs.forEach(function (reg) { reg.unregister(); });
    });
  }
</script>`,
  );
}

function startServer({ root, origin, host = '127.0.0.1', port = 0 } = {}) {
  if (!root) throw new Error('The desktop shell needs STOCKRIDGE_ROOT, the folder that contains public/.');
  if (!fs.existsSync(path.join(publicDir(root), 'index.html'))) {
    throw new Error(`No StockRidge UI at ${publicDir(root)}. Set STOCKRIDGE_ROOT to the checkout.`);
  }
  const target = new URL(origin || 'https://sample.stockridge.workers.dev');
  const transport = target.protocol === 'http:' ? http : https;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    if (url.pathname === '/__desktop/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, engine: 'sqlite', origin: target.origin }));
      return;
    }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      proxy(req, res, target, transport, url);
      return;
    }
    serveStatic(root, url.pathname, res);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve({
        server,
        url: `http://${host}:${address.port}/`,
        port: address.port,
        origin: target.origin,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

function bridgeScript() {
  return path.join(__dirname, '..', 'public', 'js', 'store-native.js');
}

function productionScript() {
  return path.join(__dirname, '..', 'public', 'js', 'desktop-production.js');
}

function serveStatic(root, urlPath, res) {
  const pathname = urlPath.split('?')[0];
  if (pathname === '/js/store-native.js' || pathname === '/js/desktop-production.js') {
    const bundled = pathname === '/js/store-native.js' ? bridgeScript() : productionScript();
    if (fs.existsSync(bundled)) {
      res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
      fs.createReadStream(bundled).pipe(res);
      return;
    }
  }
  const file = safeFile(root, urlPath);
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Not found');
    return;
  }
  fs.stat(file, (err, stat) => {
    const target = (!err && stat.isDirectory()) ? path.join(file, 'index.html') : file;
    fs.readFile(target, (readErr, buf) => {
      if (readErr) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end('Not found');
        return;
      }
      const ext = path.extname(target).toLowerCase();
      let body = buf;
      if (path.basename(target) === 'index.html') body = Buffer.from(desktopIndex(buf.toString('utf8')), 'utf8');
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    });
  });
}

function proxy(req, res, target, transport, url) {
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (HOP.has(key.toLowerCase())) continue;
    headers[key] = value;
  }
  headers.host = target.host;
  const upstream = transport.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    method: req.method,
    path: url.pathname + url.search,
    headers,
    timeout: 60000,
  }, (pres) => {
    const out = {};
    for (const [key, value] of Object.entries(pres.headers)) {
      if (HOP.has(key.toLowerCase())) continue;
      out[key] = value;
    }
    res.writeHead(pres.statusCode || 502, out);
    pres.pipe(res);
  });
  upstream.on('timeout', () => upstream.destroy(new Error('The Worker did not answer in time.')));
  upstream.on('error', () => {
    if (res.headersSent) { res.end(); return; }
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'The shop server could not be reached.', code: 'UPSTREAM_UNREACHABLE' }));
  });
  req.pipe(upstream);
}

module.exports = { startServer, desktopIndex, safeFile };
