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

12. A page change is not a sign-out. Do not clear the token because one `/api/` call returned 401. A dropped token or a device mismatch on one proxy path is not the last answer; ask the next path. Sign out only when the session is revoked, expired, or gone, or when `/api/auth/me` confirms it was replaced. Do not rewrite that 401 as `502 OFFLINE`.

13. Write the sale on this till before asking the shop. **Saving…** means a sync cycle is still running. When that cycle ends, including a failed pull, the chip must leave **Saving…**. A sale the shop did not take stays in the outbox. A sale the shop refused is not kept. A sale the shop took is marked synced so it is not sent twice.

14. Do not cut `POST /api/sync/pull` with the 4.5 second screen budget. That abort is how **Saving…** finished as **Not saved** with nothing written. **Not saved** is legitimate only when nothing is on the till, and the detail must say why: the shop has no products or stock, or the shop did not finish sending the catalogue. If products or stock are already stored, the label is **Part saved** or **Saved**, not **Not saved**.

15. Opening money is recorded once, in the safe and in Owner's Capital. A zero float writes nothing. Do not post it as income, and do not post it again when the branch is saved later. A mirror download stores every branch the person can reach. A pinned cashier still gets only their branch. Clearing browser data deletes the local copy. The next online sign-in is what fills it.

16. A general manager clock-in names the shop they picked. Do not post `/api/attendance/clock-in` or `/api/attendance/clock-out` without that `branch_id`. Do not guess a shop when several are reachable. All shops is not a clock-in. A pinned cashier is not offered another shop.

17. The safe is shown beside the till, including when the open till belongs to somebody else. Do not paint the safe only for the person who opened the drawer. A pinned cashier still sees only their shop's safe. Do not treat the till float as the safe balance. The files are `paintSafe` and `mirroredSafe` in `dashboard.js`, the drawer and Safe tab in `till.js`, `safeBalance` on `GET /api/tills/current`, and `branch_safe_ledger` in both pull lists. Dropping any of those hides the safe again, or shows another shop's cash.

18. A purchase order, and any other write that is not login or a catalogue pull or push, is sent once. Do not try a second path, and do not ask the other host. The other host signs with its own secret and answers `Invalid token signature` after this host has already kept the order. A lost answer is not proof the order was refused. The screen keeps one idempotency key for the same raise.

12. The shop's own answer is the only online signal. A status from 1 to 499 is an answer, including 401 and 404, unless the body is the proxy-miss sentence or the saved-till door (`offline: true`). Do not mark the till offline from `navigator.onLine`, the browser `offline` event, one missed screen, or a shop 401 rewritten as `OFFLINE`. Probe `/api/health`. The chip moves to Offline only after that probe misses twice. The dashboard must not show the Offline banner while `isOnline()` is true. The POS must not consult `navigator.onLine`.

13. A gateway 502 is not the last word. Try IPv4, then the certificate an antivirus inserted, then Chromium on the computer's proxy, then the other host of the same books. Do not set the session proxy to `direct`. Do not count the saved-till door as the shop. Do not paint **You are offline** or **Offline —** on a screen while the shop has answered.

14. A welcome toast is not a sign-in. `showShell` must hide `#login-screen` before `ui.ok`. Do not sync inside `state.load`. A 401 in the 12 seconds after that sign-in must not call `showLogin`. After those 12 seconds, one account, one device still stands. `.login-screen { display: grid }` must not beat `hidden`.

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

Fix: a shop answer is the only online signal. Ask `/api/health` and retry the screen before painting Offline. Two probe misses are required. A 401 is kept as a 401. The dashboard does not show the Offline banner while the chip says the shop answered. A sale the shop did not take is still saved on this till.

### Still Offline after that rule

The rule was not enough while the proxy could still fail a shop that was up. A first gateway 502 was kept, so the next path was never asked. The health check skipped IPv4 and the antivirus certificate. Chromium was set to `direct`, so a computer that reaches the internet through a proxy looked offline inside this window. The saved-till door answers `GET /api/auth/me` and `POST /api/auth/login` with `200` and `offline: true` when the proxy misses. That was counted as a session, then the dashboard missed and painted Offline. Every screen that saw an `OFFLINE` error painted its own **Offline —** banner without asking whether the shop had answered.

Fix: keep going until the shop itself speaks. IPv4 first, then the inspected certificate, then Chromium on the system proxy, then the other host of the same books (`sample` and `stockridge`). A saved-till body is not a shop answer. A screen does not get an `OFFLINE` error, and does not say **You are offline**, unless the shop has missed twice. If a shop answer is already in hand, the chip and the **Offline —** alerts are put back.

This is not confirmed until the unpacked program built from the commit that contains this rule is the program they open.

### Login page changed, then Saving never finished and a page signed them out

They confirmed the login form now leaves. The next report was that an offline save showed **Saving…** and did not save, and opening another page signed them out.

The 12 second grace ended. Any 401, including a page read, still cleared the token. One proxy path could return `NO_TOKEN` or `SESSION_SUPERSEDED` when Chromium dropped a header, and that 401 was kept, so the next path was never asked. The save chip shows **Saving…** while a sync cycle is running. If the pull failed, the chip was not told the cycle had stopped. The sale was posted to the shop before it was written on this till, so a miss that was not already called offline threw the sale away.

Fix: ask the next path when one path says the token is missing or the device does not match. Do not sign out unless the session itself is dead, and confirm a replaced session with `/api/auth/me` before leaving the shell. Write the sale to the outbox first. Clear **Saving…** when the cycle ends. One account, one device still stands when that confirmation says the session was replaced.

### Not saved after a save had started

The chip said **Not saved** after **Saving…**. The catalogue pull used the same 4.5 second budget as a screen read. The shop was still building the copy. The proxy destroyed the request. No row was stored, and a missing download stamp was treated as an empty till even when rows were already there.

Fix: give the catalogue download 55 seconds, write products first, and keep a group that already arrived. **Not saved** now means nothing is on the till, and the sentence says which true reason it is. Rows on the till are not called **Not saved**.

## Before the next change

- If the screen says **Failed to fetch** or **That failed.**, the window called the wrong host, or the proxy mislabelled the body. Do not add a direct Worker fetch to "fix" it.
- If the screen says the account is on another device right after sign-in on this till, check the device id and the old token. Do not allow two live sessions to silence it.
- If a rebuild does not change what the window runs, the screen cache is hiding the shipped file. The shipped file must win.
- If a different person sees the shop-did-not-answer sentence, they have not been saved on this till yet. Save them when the shop accepts them. Do not keep only the last person, and do not store the PIN to skip the shop.
- If a connected sign-in says the saved sign-in has expired, the shop answer was not read. Do not open the expired saved till while the shop is up.
- If the build says the output file is locked, do not wait on the portable exe. Build the unpacked program and open `dist\win-unpacked\StockRidge.exe`.
- If a connected sign-in shows the offline dashboard, the read gave up too soon, or a browser offline flag was treated as the shop. Do not leave that banner up when the shop answers. Do not flip the chip from one miss. A sale made while the shop is down must stay saved on this till.
