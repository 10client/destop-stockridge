'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { refreshScreens, localPath, extractRefs } = require('../lib/screen-sync');
const { startServer } = require('../electron/server');

test('a screen path cannot leave the shop folder', () => {
  assert.equal(localPath('/js/views/admin.js?v=1'), 'js/views/admin.js');
  assert.equal(localPath('/sw.js'), null);
  assert.equal(localPath('/../package.json'), null);
  assert.equal(extractRefs('<script src="/js/views/deliveries.js?v=ridge-1"></script>').length, 1);
});

test('the till takes the PWA screens, including a water-packing page, and ignores another host', async () => {
  const upstream = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><head><link rel="stylesheet" href="/css/app.css?v=ridge-20261019-1632-f9b872b"></head><body><script src="/js/views/admin.js?v=ridge-20261019-1632-f9b872b"></script></body></html>');
      return;
    }
    if (url === '/js/views/admin.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end('hint: water-packing plant and a bakery');
      return;
    }
    if (url === '/css/app.css') {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      res.end('body{color:#07290c} /* bakery */');
      return;
    }
    res.writeHead(404);
    res.end('missing');
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-screens-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-bundled-'));
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public', 'index.html'), '<html><body>old office screens, no water packing</body></html>');
  try {
    const refreshed = await refreshScreens({
      origin: `http://127.0.0.1:${upstream.address().port}`,
      cacheDir: cache,
      timeoutMs: 5000,
    });
    assert.equal(refreshed.stamp, 'ridge-20261019-1632-f9b872b');
    const admin = fs.readFileSync(path.join(cache, 'public', 'js', 'views', 'admin.js'), 'utf8');
    assert.match(admin, /water-packing/);
    assert.match(admin, /bakery/);
    const desktop = await startServer({
      root,
      cacheRoot: cache,
      origin: `http://127.0.0.1:${upstream.address().port}`,
      host: '127.0.0.1',
      port: 0,
    });
    try {
      const page = await fetch(desktop.url);
      const html = await page.text();
      assert.match(html, /admin\.js/);
      assert.doesNotMatch(html, /old office screens/);
      const script = await fetch(desktop.url + 'js/views/admin.js');
      assert.match(await script.text(), /water-packing/);
      const worker = await fetch(desktop.url + 'sw.js');
      assert.equal(worker.status, 404);
    } finally {
      await desktop.close();
    }
  } finally {
    await new Promise((resolve) => upstream.close(resolve));
  }
});
