# StockRidge production audit

Written 2026-10-21. This is the reference for what has already broken, what was changed, and what must not be undone while the till is brought to a production-ready state.

The running Windows program is not confirmed on this file. Do not tell anyone the till is fixed until they open `dist\win-unpacked\StockRidge.exe` built from the commit that contains this file, after `node .\tools\stage-ui.js`. The live shop hosts were last confirmed on worker stamp `ea33075`. These till commits are not deployed. Do not deploy unless asked.

## Standing rules

- One account, one device. Do not keep the PWA and this till signed in together. A missing device id, or `SR-UNKNOWN`, is not a second device. A different real device still takes the account.
- Do not store the PIN. Do not pass `--reset-pin`. A person the shop has never accepted on this till is not invented.
- The window never calls `https://*.stockridge.workers.dev` itself. Every shop call is same-origin `/api/...`. Do not restore `sr-shop-direct` or a window `Promise.any` race against the Worker.
- Do not put a Turso token, or Turso Sync, on the till. Do not split the shared database. The token is a secret and does not belong in git.
- Do not edit applied migrations `0001`–`0022`. Do not recreate deleted `0023`. Do not wipe sample businesses. Do not add a fifth stored role or use `job_title`.
- Do not deploy unless asked. Do not put the data copy on the every-deploy path.
- Do not `git pull` in `C:\Users\Mohammed Hayatudeen\StockRidge`. Pull each repo in its own folder.
- Do not build `dist\StockRidge-0.1.0-win-x64.exe`. That portable file stays locked. Build `--win dir` and open `dist\win-unpacked\StockRidge.exe`.
- Do not spawn `electron-builder` through `shell: true`. Do not add `"postinstall": "electron-builder install-app-deps"`.
- Do not set `webSecurity` to false. Do not call `rekey` while opening the till file. Do not delete `stockridge.db`, its `-wal` or `-shm`, `stockridge.key`, or a file set aside as unreadable.
- Do not commit the staff sign-in sheet, a GitHub token, a Cloudflare token, or R2 keys.

## How the till decides it is online

This is the rule the last false Offline broke.

| Signal | What it means | What the till must do |
| --- | --- | --- |
| Shop status 1–499, and the body is not the proxy-miss sentence | The shop answered. 401 and 404 count. | Online. Clear the miss count. |
| Proxy `502` `UPSTREAM_UNREACHABLE`, or window `502` `OFFLINE` | This computer did not get a shop answer. | A miss. Not proof by itself. |
| `navigator.onLine === false`, or the browser `offline` event | The browser's network flag. Electron can report this while the proxy is answering. | Ask `/api/health`. Do not flip the chip. |
| One timed-out screen | That screen missed. | Probe, then retry the screen once. Do not paint Offline. |
| `/api/health` misses twice in a row | The shop is not answering. | Then, and only then, the chip may say Offline. |

A sale the shop did not take is still saved on this till and counted in today's figures. It uploads when the line returns. The PIN is not stored to make that work.

## Problems and fixes

### 1. Failed to fetch, first time

The window called the Worker directly. Cloudflare refuses a request with no browser signature (error 1010) and sends no CORS header. The browser reports that as **Failed to fetch**.

Fix, in the desktop proxy: the page stays on this computer. The proxy adds a Chrome signature and forwards `x-device-id`. Do not race the window against the Worker.

### 2. That failed. on the dashboard

After the proxy change, a missing or unreadable shop answer was shown as a hard failure.

Fix: a shop miss uses the figures already saved on the till. The sentence is not **That failed.** and not **Failed to fetch**.

### 3. Signed out as another device

The shop allows one device. This window was not always presenting the same device id it had just signed in with. A missing id was treated as a second device. Chromium's network path can drop `x-device-id` and still return an answer.

Fix: one pinned device id on every shop call, including the login body. If Chromium answers "another device" and this till did send an id, ask again through Node, which keeps the header. A different real device id still takes over.

### 4. Offline sign-in, then the other-device notice twice

The shop login did not stick, so the till opened the saved stock and sent an old token. The shop rejected that token. Sync and the next read both showed the notice and signed the till out.

Fix: if the shop is up, the sign-in in hand takes the account. If the shop is down, the saved till stays open and a rejected old token does not show that notice. The PIN is only in the sign-in call. Do not expose `saveAcceptedLogin` on IPC.

### 5. Failed to fetch after a successful sign-in

Chromium's shop path decodes gzip and can still report `content-encoding: gzip`. The proxy forwarded that label with the decoded body. The window could not read the answer. The old PWA screen cache could also hide a till fix, so a rebuild did not change the screen.

Fix: the proxy describes the bytes it actually sends. Do not strip `content-encoding` from a body that still starts with gzip magic `1f 8b`. A file shipped in this program wins over the screen cache. A window call aimed at the Worker is turned back into `/api/...`.

### 6. A different person could not sign in

The till kept one check per username, but used it only for the last person saved, and only after the window itself read the shop login. The window gave up while the proxy was still asking. Any failed login fetch was turned into a fake miss. A person the shop had never accepted here had nothing to check, so they were refused.

Fix, destop `8c63574` and stockridge `3c5f35d`: a login waits for a real shop answer. When the shop accepts a person, that person is saved before the window reads the answer. Other saved people stay. Either can sign in when the shop is down. Do not store the PIN. Do not invent a username the shop has never accepted on this till.

### 7. Online login said the saved sign-in had expired

The sentence was **Signed in offline. The saved sign-in has expired, so these sales stay on this till until you sign in while connected.** Node left the shop login compressed. The till could not read the token, treated a live answer as a miss, and opened the old saved sign-in.

The build also waited on the locked portable exe and was cancelled three times. Packaging `dist\win-unpacked` is not proof they launched the new program.

Fix, destop `44d413e` and stockridge `f00ba62`: decode a gzip shop login before judging it. Do not show that expired sentence when `isOnline()` is already true. The Windows target is `dir` only. `signAndEditExecutable` is false. `tools/archive.js` spawns `electron-builder` with `--win dir` and `shell: false`.

### 8. Online login, then the offline dashboard

The banner was **Offline — these figures are computed from this device's last sync, not from the office. Sales made here are counted in the queue below.** Sign-in had reached the shop. The dashboard read gave up while the proxy was still trying. Sales saved on the till were not in those figures.

Fix, destop `08d5fda` and stockridge `0112e15`: a live token calls `noteReachable(true)`. Non-login proxy reads are capped so they answer before the window gives up. The dashboard probes and retries once before `fromMirror()`. Today's unsynced sales are counted from the till file. A shop-miss sale is queued. This did not stop the symptom. Do not treat those hashes as the complete online fix.

### 9. Still Offline while the person is online

`08d5fda` / `0112e15` left the structural cause in place:

- `api.js` started from `navigator.onLine` and set the chip offline on the browser `offline` event.
- One fetch throw in `desktop-production.js` became `502` `OFFLINE`. `api.request` then set the chip offline.
- A saved-session 401 was rewritten to that same miss, so a shop refusal looked like a dead shop.
- `pos.js` treated `navigator.onLine === false` as offline.
- The probe used `/api/health/ping`, which the live worker answers as 404, and it only ran while the chip was already false.
- The dashboard could still paint the Offline banner from a miss even after the shop had answered.

Fix in the commit that contains this file:

- `public/js/reachability.js` is the testable rule. `shopAnswered` is status 1–499 without the proxy-miss sentence. `shouldMarkOffline` is false until a probe has missed twice.
- The chip starts online. A browser offline event asks the shop. It does not flip the chip.
- A miss probes `/api/health`, then retries the screen once. The chip moves only after two probe misses. A 401 stays a 401 and marks the shop as having answered.
- The dashboard does not show the Offline banner while `isOnline()` is true. It offers Try again instead.
- The POS ignores `navigator.onLine`. A sale still queues when the call is a miss or retryable, including when the chip has not moved yet.
- The proxy gives `/api/health` 12 seconds, then 10 seconds on the Node path. A normal screen read stays at 5 + 5 + 4 + 4 seconds so it does not outlive the window. Do not raise the global `api.js` 20 second timeout.
- A saved till is no longer forced offline by `emit('net', { online: false })` when the live sign-in did not finish. The probe owns the chip.

Not confirmed until the new unpacked exe is the one they launch.

## What the till already does for an offline sale

The browser outbox is `public/js/store.js`. The desktop till replaces it with `public/js/store-native.js`, which writes the sale through `native.outboxPut`. `public/js/save-status.js` shows **Saved here** when a sale is pending and the line is down. That file is display only. `lib/local-sales.js` counts today's unsynced sales so the dashboard does not drop them. `sync.js` pushes when the chip is online. A false Offline chip also stops that push, which is why the chip rule matters.

## What is not production-ready

- The Windows till the person is opening may still be an older unpacked build, or the locked portable exe from 20 Oct 2026 4:37:44 PM. Length of that old file was 77304820. Do not describe that file as a new build.
- The live workers are not running `0112e15` or this commit. A PWA refresh will not pick up the till fix. Do not deploy to make the till match.
- The exe is unsigned. Turning signing on without `CSC_LINK` fails the build. Leave `signAndEditExecutable` false.
- Antivirus TLS inspection is a known way Node HTTPS fails while a browser works. It is not proven on this till. Do not set `webSecurity` to false to chase it. The proxy already has one insecure Node retry for a normal read, not for the health check.
- Offline sign-in only works for a username the shop has already accepted on this till. That is intentional.
- One account, one device will keep signing the other session out. That is the product rule, not a bug to remove.
- The shop database is Turso, shared, not a copy on the till. A free-plan quota failure comes back as `BLOCKED`. Do not split the database to get past it.

## How to continue

1. Build the unpacked till from the commit that contains this file. Pull destop and stockridge in their own folders. Run `node .\tools\stage-ui.js` in the desktop repo so the new `reachability.js`, `api.js`, `dashboard.js`, and `pos.js` are the files the exe serves. Then `node .\node_modules\electron-builder\cli.js --win dir --config.win.signAndEditExecutable=false`. Open `dist\win-unpacked\StockRidge.exe`. Do not open the portable exe.
2. Sign in on a connection. The chip must say Online. The dashboard must not say Offline. If it still does, the opened program is not this commit. Check that the served `api.js` contains "Do not start from navigator.onLine".
3. Take a sale with the shop unreachable. It must save on this till, show **Saved here**, and be counted. It must upload after the chip returns to Online. Do not store the PIN to test this.
4. Sign in as a second saved person on the same till while the shop is down. That must work. A username the shop has never accepted here must be refused.
5. Do not deploy, do not reset a PIN, and do not pull from the parent folder, until those four checks pass on the unpacked exe.

## Commits already pushed, and what they did not finish

| Repo | Commit | What it changed | Confirmed on the till? |
| --- | --- | --- | --- |
| destop | `8c63574` | Save each person the shop accepts | No |
| stockridge | `3c5f35d` | Any saved person can sign in when the shop is down | No |
| destop | `44d413e` | Decode a gzip login; build unpacked `dir` only | No |
| stockridge | `f00ba62` | Do not say the saved sign-in expired when the shop is up | No |
| destop | `08d5fda` | Live token marks online; count sales saved on the till | No. The Offline symptom remained |
| stockridge | `0112e15` | Retry the dashboard once; export `noteReachable` | No. The Offline symptom remained |

The screen rule that stopped a single miss flipping the chip is stockridge `ca9b475`, plus the later screen commit that contains `reachability.js` rejecting a saved-till `offline: true` body. The desktop rule is the commit that contains this file. The rebuild must contain both. Do not rebuild from `08d5fda`, `0112e15`, `377048e`, or `ca9b475` alone.

## Every place that can say Offline

The person being online means the shop answered. It does not mean the browser has a network icon. These are the only writers and the only sentences.

| What you see | Route or event | Function | What it represents | Correct when |
| --- | --- | --- | --- | --- |
| Chip text **Offline** | none; it reads the flag | `updateNetChrome` in `public/js/app.js` | `SR.api.isOnline()` is false | The shop has missed `/api/health` twice |
| Yellow bar under the chip | same flag | `updateNetChrome` | Work will be saved on this till | Same as the chip |
| Login label **No connection** | same flag | `updateNetChrome` | The sign-in form thinks the shop is down | Same as the chip |
| Dashboard **Offline —** | `GET /api/dashboard` failed | `refresh` then `paint` in `public/js/views/dashboard.js` | That screen used the saved figures | `isOnline()` is false. If the shop answered, this banner must not be there |
| **You are offline.** | any failed `/api/` call | `errorBlock` in `public/js/ui.js`, patched by `patchErrorBlock` in `desktop-production.js` | The error was classified as a miss | The shop has missed twice. A shop answer must not keep this sentence |
| Screen banners **Offline —** on stock, sales, customers, and the other lists | that screen's `GET /api/...` | each view's `load` / `render` catching `err.isOffline` | That one call was classified as a miss | Same. `api.request` must not throw `OFFLINE` after one miss |
| POS **Offline. Sales completed here are stored on this device** | `GET` search and checkout | `public/js/views/pos.js` | `isOnline()` is false, or the sale call was a miss | A sale the shop did not take is still saved. The sentence must not show while the shop is answering |
| Sync does not upload | `POST /api/sync` | `push` and `pull` in `public/js/sync.js` | They return immediately when `isOnline()` is false | The flag must be true after a shop answer, or a saved sale never leaves the till |
| Sign-in sentence **Signed in offline** | `POST /api/auth/login` | `login` → `signInOffline` in `desktop-production.js` | The shop login did not return a token, and `/api/health` also missed | Only when both hosts miss. A saved person can still open the till. The PIN is not stored |
| Saved-till `200` with `offline: true` | `POST /api/auth/login`, `GET /api/auth/me` | `answerWhenShopDown` in `lib/offline-door.js` | The proxy got no shop answer, so this computer answered from the saved till | Must not be treated as the shop. `sessionHeld` returns null on `body.offline` |
| Proxy `502` `UPSTREAM_UNREACHABLE` | any `/api/` the shop did not answer | `unreachable` in `electron/server.js` | Every path failed: IPv4, default, insecure certificate, Chromium, and the other host | A real shop status, including 401 and 404, must be returned instead |
| Window `502` `OFFLINE` | a window `fetch` that threw | `shopMissResponse` in `desktop-production.js` | The window did not get a response from the proxy on this computer | Not a shop answer. The chip still waits for two health misses |

`navigator.onLine` and the browser `offline` event are not in that table. They are not the shop. `api.js` does not start from them, and `pos.js` does not read them.

A status from 1 to 499 is the shop, except a body that is the proxy-miss sentence, an HTML block, or `"offline": true`. `shopAnswered` in `public/js/reachability.js` and `shopSpoke` in `electron/server.js` are that test. `shouldMarkOffline` requires two probe misses. `setOnline` is the only flag writer. `noteReachable(true)` is how a live sign-in sets it, because desktop login does not go through `api.request`.
