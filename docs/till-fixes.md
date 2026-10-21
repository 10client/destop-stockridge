# Till fixes — do not circle

This file is the record of what broke on the Windows till, why, and the rule that stops the same break coming back. Read it before changing sign-in, the shop proxy, or the screen cache.

The till is one computer, one account, one device. The PIN is not stored. The shop database is not on this computer. Do not deploy unless asked. Do not delete `stockridge.db`, `stockridge.key`, or a file set aside as unreadable.

## Rules that must stay

1. The window never calls `https://*.stockridge.workers.dev` itself. Every shop call is same-origin `/api/...`. The proxy on this computer adds a Chrome signature and forwards `x-device-id`. A window call to the Worker is refused by Cloudflare and the screen says **Failed to fetch**. Do not put that race back. The name to refuse is `sr-shop-direct`.

2. Do not show the browser sentence **Failed to fetch**, and do not show **That failed.** for a shop miss. A miss means the saved till, or the sentence "The shop did not answer from this window."

3. The proxy must describe the bytes it actually sends. If Chromium already decoded gzip, do not forward `content-encoding: gzip` or the old length. That mismatch is **Failed to fetch** on the screen after sign-in.

4. A file shipped in this program wins over the screen cache. The cache is the last PWA deploy. It must not hide a till fix. Do not prefer the cache again for a file this program already has.

5. One account, one device. The same device id stays signed in. A different real device id still takes the account over. A missing id, or `SR-UNKNOWN`, is not another device. Do not keep the PWA and this till signed in together.

6. Do not sign this till out with the other-device notice just because an old saved token was rejected. If the shop is up, the sign-in in hand takes the account. If the shop is down, the saved till stays open and that notice is not shown. The PIN is not written down to make either path work.

7. Do not store the PIN. Do not set `webSecurity` to false. Do not call `rekey` while opening the till file.

8. Save every person the shop accepts on this till. Do not keep only the last person. Do not invent a person the shop has never accepted here. Offline sign-in checks any saved person, not only the last one.

9. A login must get a real shop answer before the window gives up. Do not turn that call into a fake miss. Do not race the window against the Worker. One login request at a time, so the same account is not signed out of itself. A gzip shop answer is still a shop answer. Decode it before deciding the sign-in failed.

10. Do not build the portable exe over `dist\StockRidge-0.1.0-win-x64.exe`. That file stays locked by the open program or the virus scanner, and the build waits until it is cancelled. Build the unpacked program. Open `dist\win-unpacked\StockRidge.exe`. Do not open the old portable exe.

11. A connected sign-in is online. Do not paint the offline dashboard because one read gave up before the shop answered. A sale made while the shop is down is saved on this till and counted there. It uploads when the line returns.

12. The shop's own answer is the only online signal. A status from 1 to 499 is an answer, including 401 and 404, unless the body is the proxy-miss sentence. Do not mark the till offline from `navigator.onLine`, the browser `offline` event, one missed screen, or a shop 401 rewritten as `OFFLINE`. Probe `/api/health`. The chip moves to Offline only after that probe misses twice. The dashboard must not show the Offline banner while `isOnline()` is true. The POS must not consult `navigator.onLine`.

## What happened, in order

### Failed to fetch, first time

The window called the Worker directly. Cloudflare refuses a request with no browser signature (error 1010) and sends no CORS header. The browser reports that as **Failed to fetch**.

Fix: the page stays on this computer. The proxy asks the shop with a Chrome signature. Do not race the window against the proxy.

### That failed. on the dashboard

After the proxy change, the dashboard still said **That failed.** The shop answer was either missing or unreadable, and the screen treated that as a hard failure instead of the figures already saved on the till.

Fix: a shop miss uses the saved figures. The sentence is not **That failed.** and not **Failed to fetch**.

### Signed out as another device

Sign-in on this till was followed by **This account is signed in on another device, so this one has been signed out.** The shop allows one device. This window was not always presenting the same device id it had just signed in with. A missing id was treated as a second device. Chromium's network path can also drop `x-device-id` while still returning an answer; the next call then looks like another device.

Fix: one pinned device id, sent on every shop call, including the login body. If Chromium's path answers "another device" and this till did send an id, ask again through Node, which keeps the header. A different real device id still takes over.

### Offline sign-in, then the other-device notice twice

Sign-in showed **Signed in offline from the stock saved on this till**, then the long other-device notice twice. The shop login did not stick, so the till opened the saved stock and sent an old token. The shop rejected that token. Sync and the next read both showed the notice and signed the till out.

Fix: if the shop is up, this sign-in takes the account and stays. If the shop is not up, the saved till stays open and a rejected old token does not show that notice. The PIN is only in the sign-in call.

### That failed. Failed to fetch, after sign-in

Sign-in worked. The next screen said **That failed. Failed to fetch.** Chromium's shop path decodes gzip and still reports `content-encoding: gzip`. The proxy forwarded that label with the decoded body. The window could not read the answer and reported **Failed to fetch**. The old PWA screen cache could also hide the till's own fixed screens, so a rebuild did not show the fix.

Fix: the proxy labels the body it actually sends. A shipped screen file wins over the cache. A window call aimed at the Worker is turned back into `/api/...`. The browser sentence is not shown.

### A different person, then "try the same username and PIN again"

A different username showed **The shop did not answer from this window. Try the same username and PIN again.** The till already keeps one check per username. It refused to use that unless the person was the last one saved, and it only saved someone after the window read a shop login. The window gave up while the proxy was still asking, and any failed login fetch was turned into a fake miss. The last saved person could still open the till. A different person had no check yet, so they were refused before they could be saved.

Fix: a login waits for a real shop answer, and a path that returns HTML or a block is not treated as that answer. When the shop accepts a person, that person is saved before the window reads the answer. Other saved people stay saved. Either saved person can sign in when the shop is down. The PIN is not stored. A person the shop has never accepted on this till is not invented.

### Online, then "Signed in offline. The saved sign-in has expired"

A connected sign-in still said **Signed in offline. The saved sign-in has expired, so these sales stay on this till until you sign in while connected.** The shop had answered. Node left the answer compressed. The till could not read the token, treated the call as a miss, and opened the old saved sign-in. That saved token had expired, so the screen said to connect even though the person was already online.

The build did not finish either. It waited because `dist\StockRidge-0.1.0-win-x64.exe` was locked, then it was cancelled. The new program was not what they opened.

Fix: decode a gzip shop answer before judging the login, and do not open an expired saved sign-in when the shop is up. Build the unpacked program. Do not write the locked portable exe again.

### Online login, then the offline dashboard

Sign-in reached the shop. The dashboard still said **Offline — these figures are computed from this device's last sync, not from the office. Sales made here are counted in the queue below.** The dashboard read gives up at 20 seconds. The proxy was still trying the shop, so the miss was painted as offline. The sales saved on the till were not in those figures.

Fix: a shop read answers before that wait. If the first read misses and the shop still answers, read it again before painting the saved figures. A live sign-in marks the till online. A sale the shop did not take is saved here and counted. It uploads when the line returns.

### Still Offline while the person is online

That last fix was not enough. The till still showed Offline after a connected sign-in. Three signals were each allowed to flip the whole till:

- The browser `offline` event, and `navigator.onLine === false`. Electron can report no network while the shop on this computer's proxy is answering.
- One missed `/api/` call. The window wrapper turned that throw, and a saved-session 401, into `502` `OFFLINE`. The screen then treated the shop as down.
- A probe of `/api/health/ping` that only ran after the chip was already Offline. The live shop answers 404 on that path. A 404 is the shop speaking. A proxy 502 is not.

Fix: a shop answer is the only online signal. Ask `/api/health` and retry the screen before painting Offline. Two probe misses are required. A 401 is kept as a 401. The dashboard does not show the Offline banner while the chip says the shop answered. The longer wait is only for that health check, so a slow shop is not called down. A sale the shop did not take is still saved on this till.

This is not confirmed until the unpacked program built from the commit that contains this rule is the program they open.

## Before the next change

- If the screen says **Failed to fetch** or **That failed.**, the window called the wrong host, or the proxy mislabelled the body. Do not add a direct Worker fetch to "fix" it.
- If the screen says the account is on another device right after sign-in on this till, check the device id and the old token. Do not allow two live sessions to silence it.
- If a rebuild does not change what the window runs, the screen cache is hiding the shipped file. The shipped file must win.
- If a different person sees the shop-did-not-answer sentence, they have not been saved on this till yet. Save them when the shop accepts them. Do not keep only the last person, and do not store the PIN to skip the shop.
- If a connected sign-in says the saved sign-in has expired, the shop answer was not read. Do not open the expired saved till while the shop is up.
- If the build says the output file is locked, do not wait on the portable exe. Build the unpacked program and open `dist\win-unpacked\StockRidge.exe`.
- If a connected sign-in shows the offline dashboard, the read gave up too soon, or a browser offline flag was treated as the shop. Do not leave that banner up when the shop answers. Do not flip the chip from one miss. A sale made while the shop is down must stay saved on this till.
