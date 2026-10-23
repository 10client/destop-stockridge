# StockRidge development memory

Written 2026-10-21. This is the guide for the next change. Read the matching row before touching sign-in, the shop proxy, the online flag, or the screen cache. Do not repeat a change whose outcome is already known.

Outcome words used below:

- **Success** — the reported symptom stopped, and the till that was opened was the build that contained the change.
- **Partial** — the code does the intended thing on that one path. A later symptom showed the till was still wrong, or the opened program was not confirmed.
- **Not confirmed** — pushed, not proven on the Windows till they open.
- **Failed** — the symptom was still there after the change.
- **Worse** — the change removed one symptom and created another.

On 2026-10-23 the PWA was deployed because they asked. Sample stamp `ridge-20261023-0812-fe1a821`. Office stamp `ridge-20261023-0813-fe1a821`. Both serve stockridge `fe1a821`. That deploy does not update the Windows exe. Do not deploy again unless asked. Do not tell anyone a row is Success until they open `dist\win-unpacked\StockRidge.exe` built from the commit that contains this file, after `node .\tools\stage-ui.js`.

## How to use this file

1. Find the symptom in the record. Read **From**, **To**, and **Do not**.
2. If the outcome is Failed or Worse, do not patch the sentence. Find the route that still writes the wrong state.
3. A shop answer is the only online signal. A status from 1 to 499 is an answer, including 401 and 404, unless the body is the proxy-miss sentence, an HTML block, or `"offline": true`.
4. One account, one device still stands. The PIN is not stored. The window never calls `https://*.stockridge.workers.dev` itself.
5. Build only `--win dir`. Open `dist\win-unpacked\StockRidge.exe`. Do not open `dist\StockRidge-0.1.0-win-x64.exe`.

## Standing rules

- Do not store the PIN. Do not pass `--reset-pin`. Do not invent a username the shop has never accepted on this till.
- Do not restore `sr-shop-direct` or a window `Promise.any` race against the Worker.
- Do not put a Turso token, or Turso Sync, on the till. Do not split the shared database.
- Do not edit applied migrations `0001`–`0022`. Do not recreate deleted `0023`. Do not wipe sample businesses. Do not add a fifth stored role or use `job_title`.
- Do not deploy unless asked. Do not `git pull` in `C:\Users\Mohammed Hayatudeen\StockRidge`.
- Do not spawn `electron-builder` through `shell: true`. Do not add `"postinstall": "electron-builder install-app-deps"`.
- Do not set `webSecurity` to false. Do not call `rekey` while opening the till file. Do not delete `stockridge.db`, its `-wal` or `-shm`, `stockridge.key`, or a file set aside as unreadable.
- Do not commit the staff sign-in sheet, a GitHub token, a Cloudflare token, or R2 keys.
- A missing device id, or `SR-UNKNOWN`, is not a second device. A different real device still takes the account.

## Record

### 1. Failed to fetch, the window called the Worker

- **Symptom:** the screen said **Failed to fetch**.
- **Routes:** the window `fetch` to `https://*.stockridge.workers.dev/api/...`.
- **From:** the page called the Worker. Cloudflare error 1010, no CORS header. The browser reports that as a network failure.
- **To:** every shop call is same-origin `/api/...`. `electron/server.js` `proxy` adds a Chrome user agent and forwards `x-device-id`.
- **Why:** a window request has no browser signature Cloudflare accepts.
- **Functions:** `localApiUrl` in `desktop-production.js` turns a Worker URL back into `/api/...`. `browserHeaders` and `nodeUpstream` set the signature.
- **Outcome:** **Partial.** The direct call was the first cause. Later **Failed to fetch** came from a mislabelled gzip body, not from this race. Do not put the race back.

### 2. That failed. on the dashboard

- **Symptom:** after the proxy change, the dashboard said **That failed.**
- **Routes:** `GET /api/dashboard`.
- **From:** a missing or unreadable body was thrown as a hard error. `ui.errorBlock` prefixed **That failed.**
- **To:** a shop miss uses the figures already saved on the till. The sentence is not **That failed.** and not **Failed to fetch**.
- **Why:** a dead read is not a bug in the figures the till already holds.
- **Functions:** `errorBlock` in `public/js/ui.js`, patched by `patchErrorBlock` in `desktop-production.js`. Dashboard `refresh` in `public/js/views/dashboard.js`.
- **Outcome:** **Partial.** The hard sentence went away. The screen then said Offline instead. Rewording was not the fix.

### 3. Signed out as another device

- **Symptom:** **This account is signed in on another device, so this one has been signed out.**
- **Routes:** `POST /api/auth/login`, then `GET /api/auth/me` and `POST /api/sync/push`. Shop code `SESSION_SUPERSEDED`.
- **From:** the window did not always send the same device id it had just signed in with. A missing id was treated as a second device. Chromium's path can drop `x-device-id` and still return an answer.
- **To:** one pinned id on every shop call, including the login body. If Chromium says another device and this till did send an id, ask again through Node. A different real device id still takes over.
- **Why:** the shop allows one device. A missing id is not another device.
- **Functions:** `pinDevice` and the fetch wrapper in `desktop-production.js`. `electronLostDevice` in `electron/server.js`. `handleAuthFailure` in `public/js/app.js`.
- **Commits:** destop `3f777ad`, `1628bc4`. Stockridge `0f3c6cb`.
- **Outcome:** **Partial.** The false second device on a missing id was the bug. One account, one device is still the product rule. Do not allow two live sessions to silence a real takeover.

### 4. Offline sign-in, then the other-device notice twice

- **Symptom:** **Signed in offline from the stock saved on this till**, then the other-device notice twice, then signed out.
- **Routes:** `POST /api/auth/login`, then sync and the next read with the old token.
- **From:** the shop login did not stick. The till opened the saved stock and sent an old token. The shop rejected it. Both callers showed the notice.
- **To:** if the shop is up, the sign-in in hand takes the account. If the shop is down, the saved till stays open and a rejected old token does not show that notice.
- **Why:** an old token is not a second sign-in. The PIN is only in the sign-in call.
- **Functions:** `installOfflineLogin`, `sessionHeld`, `localSessionOnly` in `desktop-production.js`. `answerWhenShopDown` in `lib/offline-door.js`.
- **Commit:** destop `2c2c3e8`.
- **Outcome:** **Partial.** The double notice was the bug. Do not expose `saveAcceptedLogin` on IPC. Do not store the PIN to skip the shop.

### 5. Failed to fetch after a successful sign-in

- **Symptom:** sign-in worked. The next screen said **That failed. Failed to fetch.**
- **Routes:** any `/api/` whose body Chromium had already decoded.
- **From:** Chromium decoded gzip and still reported `content-encoding: gzip`. The proxy forwarded that label with the decoded body. The window could not read it. The old PWA screen cache could also hide a till fix.
- **To:** the proxy describes the bytes it actually sends. A shipped file wins over the screen cache. A window call aimed at the Worker is turned back into `/api/...`.
- **Why:** a label that does not match the body is a network failure to the browser, even when the shop answered.
- **Functions:** `decodeUpstream`, `responseForWindow`, `chooseStaticFile` in `electron/server.js`.
- **Commit:** destop `2fbc028`. Stockridge `6aaffea`.
- **Outcome:** **Partial.** Do not strip `content-encoding` from a body that still starts with gzip magic `1f 8b`. A rebuild that does not change the screen is the cache, not a reason to call the Worker from the window.

### 6. A different person could not sign in

- **Symptom:** a different username got **The shop did not answer from this window. Try the same username and PIN again.**
- **Routes:** `POST /api/auth/login`.
- **From:** the till kept one check per username but used it only for the last person, and only after the window itself read the login. The window gave up while the proxy was still asking. A failed login fetch was turned into a fake miss.
- **To:** a login waits for a real shop answer. When the shop accepts a person, that person is saved before the window reads the answer. Any saved person can sign in when the shop is down.
- **Why:** the shop had already accepted them. The till had refused to remember anyone but the last person.
- **Functions:** `loginUpstream`, `acceptedLogin` in `electron/server.js`. `signInOffline`, `checkVerifier` in `desktop-production.js` and `lib/device-store.js`.
- **Commits:** destop `8c63574`. Stockridge `3c5f35d`.
- **Outcome:** **Not confirmed.** Do not store the PIN. Do not invent a username the shop has never accepted on this till. Do not keep only the last person.

### 7. Online login said the saved sign-in had expired

- **Symptom:** **Signed in offline. The saved sign-in has expired, so these sales stay on this till until you sign in while connected.**
- **Routes:** `POST /api/auth/login`.
- **From:** Node left the shop login compressed. The till could not read the token, treated a live answer as a miss, and opened the old saved sign-in. The build also waited on the locked portable exe and was cancelled.
- **To:** decode gzip before judging the login. Do not show that expired sentence when `isOnline()` is already true. Build unpacked `dir` only.
- **Why:** a compressed token is still a token. A locked exe is not a new program.
- **Functions:** `decodeUpstream`, `loginAnswer` in `electron/server.js`. `doLogin` in `public/js/app.js`. `tools/archive.js`.
- **Commits:** destop `44d413e`. Stockridge `f00ba62`.
- **Outcome:** **Not confirmed.** Packaging `dist\win-unpacked` is not proof they launched it. Do not write `dist\StockRidge-0.1.0-win-x64.exe` again.

### 8. Online login, then the offline dashboard

- **Symptom:** **Offline — these figures are computed from this device's last sync, not from the office. Sales made here are counted in the queue below.**
- **Routes:** `POST /api/auth/login` succeeded. `GET /api/dashboard` was still running when the window gave up.
- **From:** the dashboard read gave up at 20 seconds. The proxy was still trying. The miss was painted as offline. Sales saved on the till were not in the figures.
- **To:** a live token calls `noteReachable(true)`. Non-login proxy reads were capped. The dashboard retried once before `fromMirror()`. Today's unsynced sales are counted.
- **Why:** a slow read is not proof the shop is down. A sale the shop did not take must still be on the till.
- **Functions:** `noteReachable` in `public/js/api.js`. `readDashboard` and `paint` in `public/js/views/dashboard.js`. `lib/local-sales.js`. `queueOffline` in `public/js/views/pos.js`.
- **Commits:** destop `08d5fda`. Stockridge `0112e15`.
- **Outcome:** **Failed.** The till was still Offline while the person was online. Do not treat these hashes as the online fix. Do not fix it by rewording the banner.

### 9. Still Offline while the person is online

- **Symptom:** the chip and the dashboard still said Offline after a connected sign-in.
- **Routes:** browser `offline` event. `navigator.onLine`. Any thrown `/api/` call. `GET /api/health/ping`. A saved-session `401` rewritten to `502` `OFFLINE`.
- **From:** one miss, the browser flag, or a shop refusal each flipped the whole till. The probe used `/api/health/ping`, which the live shop answers as 404, and it only ran after the chip was already false. The health check skipped IPv4 and the antivirus certificate. Chromium was set to `direct`, so a computer that reaches the internet through a proxy looked offline inside this window. The first gateway 502 was kept, so the next path was never asked.
- **To:** `shopAnswered` / `shopSpoke` is the only online signal. `/api/health` is the probe. The chip moves only after two probe misses. IPv4, then the inspected certificate, then Chromium on the system proxy, then the other host of the same books. A 401 stays a 401. A saved-till `offline: true` is not the shop.
- **Why:** the person being online means the shop answered, not that the browser has a network icon.
- **Functions:** `shouldMarkOffline` and `probe` in `public/js/reachability.js` and `public/js/api.js`. `askShopRead` and `readBudgets` in `electron/server.js`. `setProxy({ mode: 'system' })` and `siblingOrigin` in `electron/main.js` and `electron/paths.js`. `updateNetChrome` in `public/js/app.js` only reads the flag.
- **Commits:** destop `f421672`, `377048e`, `4f5790e`. Stockridge `ca9b475`, `4d9d675`.
- **Outcome:** **Not confirmed**, and the next row is **Worse** if they launched `4f5790e`. The shop hosts themselves answered `GET /api/health` with 200 from outside the till. That does not prove the opened exe contained this rule.

### 10. Welcome toast, login page did not change

- **Symptom:** after the previous fix, sign-in showed a popup confirming they were logged in. The login page did not change.
- **Routes:** `POST /api/auth/login`, then `GET /api/auth/me`, then `POST /api/sync/push` or the dashboard read. The toast is `ui.ok` in `doLogin`. The page is `#login-screen`.
- **From:** `doLogin` called `navigate('/dashboard')` and then `ui.ok('Welcome…')`. `render` hides the login page only when `SR.state.user` is set. Two things put the form back, or left it up:
  1. `SR.state.load` ran a sync before returning. A 401 from that sync called `handleAuthFailure`, which calls `showLogin()`, while the welcome toast still fired.
  2. `.login-screen { display: grid }` can beat the `hidden` attribute, so `showShell` set `hidden` and the form stayed on screen.
- **To:** the shell is opened before the toast. A 401 in the 12 seconds after that sign-in does not pull the login page back. Sync starts after the shell is open, not inside `load`. `#login-screen[hidden]` is `display: none !important`, and `showShell` also sets that inline.
- **Why:** a confirmed sign-in that does not leave the form is not a sign-in. One account, one device still applies after those 12 seconds.
- **Functions:** `doLogin`, `showShell`, `showLogin`, `handleAuthFailure` in `public/js/app.js`. `wrappedLoad` in `desktop-production.js` no longer syncs inside load. `leaveLoginIfEntered` hides the form if the welcome toast is up and a user is set.
- **Outcome:** **Partial.** They confirmed the login page now changes and they enter the application. The opened program was not checked against the hash. After those 12 seconds, a page change still signed them out, and the save chip stayed on **Saving…**. That is row 11. Do not show **Welcome** if `SR.state.user` was not set. Do not lengthen the 12 seconds into a second live session.

### 11. Saving stays on Saving, and a page change signs them out

- **Symptom:** after the login page finally changed, an offline save showed **Saving…** and did not finish, and opening another page signed them out.
- **Routes:** `POST /api/sales`, `POST /api/sync/pull`, and every page `GET /api/...`. A 401 `NO_TOKEN` or `SESSION_SUPERSEDED` on one proxy path was kept, so the next path was never asked. `api.request` then emitted `auth` for every 401. After the 12 second grace, `handleAuthFailure` cleared the token and called `showLogin`. `runOnce` set `running` and, if the pull threw, never told the chip it had stopped. `completeSale` waited on the shop before writing the outbox, so a miss that was not classified as offline threw the sale away.
- **From:** any 401 signed the till out. A sale was written only after the shop post failed in a way the till already called offline.
- **To:** a dropped token or a device mismatch on one path is not the last answer. The next path is asked. The shell signs out only for a revoked, expired, or gone session, or a superseded session that `/api/auth/me` confirms. A page 401 does not clear the token. The sale is written to the outbox before the shop is asked. If the shop takes it, that row is marked synced. If the shop refuses the sale itself, the row is removed and the cashier sees the refusal. If the shop does not answer, the row stays and the offline receipt is shown. `runOnce` always clears **Saving…** when the cycle ends, including when the pull fails.
- **Why:** a page change is not a second device. A sale the cashier has already taken must exist on this till before the shop is asked. One account, one device still signs this till out when `/api/auth/me` confirms the session was replaced.
- **Functions:** `sessionBlip` and `askShopRead` in `electron/server.js`. `handleAuthFailure` and `render` in `public/js/app.js`. `request` in `public/js/api.js`. `runOnce` in `public/js/sync.js`. `completeSale` in `public/js/views/pos.js`.
- **Outcome:** **Not confirmed.** Do not treat a page 401 as a sign-out. Do not restore rewriting a shop 401 as `502 OFFLINE`. Do not leave the chip on **Saving…** after the cycle has stopped.

### 12. Saving finishes as Not saved

- **Symptom:** a save starts, then the chip says **Not saved** and the offline catalogue is not on the till.
- **Routes:** `POST /api/sync/pull`. The screen-read budget cut that call at 4.5 seconds. The shop was still building the catalogue. The proxy destroyed the request. No row was written. `last_pull_at` stayed empty, so the chip said **Not saved** even though the person was signed in and connected.
- **From:** one pull of every table, abandoned at the screen budget. **Not saved** also appeared when rows were already on the till but the download stamp was missing.
- **To:** a catalogue download gets 55 seconds on the first path. Products are written first, then the shelf, then the rest. A later miss keeps what already landed. **Not saved** is used only when nothing is on the till, and the detail says which of the two true reasons it is: the shop has no products or stock to copy, or the shop did not finish sending the catalogue. Rows already on the till say **Part saved**, not **Not saved**.
- **Why:** a save that starts must write the copy, or say why it could not. A missing stamp is not an empty till.
- **Functions:** `readBudgets` in `electron/server.js`. `pull` in `public/js/sync.js`. `decideSaveStatus` in `lib/save-status.js`.
- **Outcome:** **Not confirmed.** Do not put the catalogue download back on the 4.5 second screen budget. Do not show **Not saved** when products or stock are already on the till.

### 13. Opening money, and a cleared browser that only kept the first branch

- **Symptom:** the first money entered when a business or a branch opened was not in the books. After browser data was cleared, an offline sign-in only had the first branch and its data.
- **Routes:** `POST /api/businesses`, `POST /api/branches`, `POST /api/sync/pull`, `GET /api/auth/me`, `GET /api/dashboard`.
- **From:** the screen stored the float on the branch row and stopped. The seed path wrote the safe and Owner's Capital. The screen path did not. The dashboard then looked for entry types the schema does not allow, and subtracted every other row, so an opening that did exist was hidden. A mirror pull named the shop the shell was standing in. After a clear, that shop is the first branch, and the pull was cut to that branch's business. A co-owner created inside the first branch never received the other branch ids, because the scope query skipped the branch list when the user row had a pin.
- **To:** opening money above zero is written once to the safe as `OPENING` and to the journal as debit Cash in Safe, credit Owner's Capital (`OPENING_BALANCE`, source `opening-{branchId}`). Zero writes nothing. A second save does not post it again. The dashboard safe balance is the sum of the amounts. A mirror pull stores every business and branch the person can reach. A cashier pinned to one branch still gets only that branch. Clearing the browser deletes the local copy. The next online sign-in is what stores the full mirror. An offline sign-in then restores that copy, not only the first branch.
- **Why:** cash the owner put in on day one is capital, not income, and not a number that only the branch row remembers. A cleared browser must not quietly keep one shop and drop the rest.
- **Functions:** `recordOpeningFloat` in `server/services/provisioningService.js`. `resolveScope` in `server/middleware/auth.js`. The pull filter in `server/routes/sync.js`. `pullRequest` in `public/js/sync.js`.
- **Outcome:** **Not confirmed.** The PWA deploy of 2026-10-23 includes this code. The unpacked till has not been rebuilt, so the shop computer does not have it yet. Do not post the opening float as income. Do not post it twice. Do not give a pinned cashier another branch's shelf to make the mirror look full.

### 14. General manager clock-in still says no branch is selected

- **Symptom:** a general manager picks a shop, then clock-in keeps showing that a branch is still not selected.
- **Routes:** `POST /api/attendance/clock-in`, `POST /api/attendance/clock-out`. The picker is `openBranchPicker` in `public/js/app.js`.
- **From:** the shell stored the picked shop on `activeBranchId`. The clock-in and clock-out posts did not send `branch_id`. A general manager has no shop pin and reaches more than one shop, so `resolveBranch` answered `BRANCH_REQUIRED`: "Choose which branch this applies to." Selecting the shop again did not change the post. All shops is a group, not a shop, and must not be guessed.
- **To:** clock-in and clock-out send the selected shop as `branch_id` in the body and on the query. If none is selected, the picker opens and All shops is refused for that action. After a shop is picked, the clock-in or clock-out continues with that shop. A pinned cashier is not offered another shop. The server still refuses a named shop outside scope.
- **Why:** the hours belong to the shop they are standing in. The screen already knew which shop. The post did not say so.
- **Functions:** `clockIn`, `clockOut`, `selectedShop` in `public/js/views/attendance.js`. `openBranchPicker` in `public/js/app.js`. `resolveBranch` in `server/lib/respond.js` already reads a named branch.
- **Outcome:** **Not confirmed.** PWA deployed 2026-10-23. Sample stamp `ridge-20261023-0812-fe1a821`. Office stamp `ridge-20261023-0813-fe1a821`. Stockridge `fe1a821`. The unpacked till was not rebuilt from here, so Electron does not have this fix until that program is built and opened. Do not mark this Success until a general manager clocks in on that build. Do not guess a shop. Do not pass `--reset-pin`. Do not open `dist\\StockRidge-0.1.0-win-x64.exe`.

### 15. Staff see the till, and not the safe

- **Symptom:** a general manager opened a till and put money in the safe. Staff signed in, saw the till, and the safe did not show.
- **Routes:** `GET /api/dashboard`, `GET /api/tills/current`, `GET /api/safe`.
- **From:** the safe balance was already on the dashboard payload. The screen painted it only when the signed-in person had their own till open. The general manager's till is not the cashier's till, so staff saw that drawer and the safe figure was dropped. The till page also left `safeBalance` off the drawer card. An empty current-till answer omitted the safe entirely. The offline copy did not include `branch_safe_ledger`, so a dropped line showed the drawer and a blank safe.
- **To:** the branch safe is painted beside the drawer for staff and for a manager, including when the open till belongs to somebody else. The till page shows the same figure on the drawer and on the Safe tab. A pinned cashier still sees only their shop. The safe ledger is copied with the catalogue so the offline screen is not blank.
- **Why:** the safe is not the drawer. Hiding it unless this person opened the till made a funded safe look missing.
- **Functions:** `paintSafe` in `public/js/views/dashboard.js`. `loadSafe` and `renderCurrent` in `public/js/views/till.js`. `GET /api/tills/current` in `server/routes/till.js`. `PULLABLE.branch_safe_ledger` in `server/routes/sync.js`.
- **Outcome:** **Not confirmed.** Do not show another branch's safe to a pinned cashier. Do not treat the till float as the safe. Opening cash saved only on the branch row, before the safe ledger was written, is not backfilled by this change.

## What each screen reads

The chip, the bar, and the login line are not separate checks. They all read `SR.api.isOnline()` in `updateNetChrome`.

| Sentence | Route | Function | When it is honest |
| --- | --- | --- | --- |
| Chip **Offline** | none | `updateNetChrome` | `/api/health` has missed twice |
| Dashboard **Offline —** | `GET /api/dashboard` | `refresh` then `paint` | `isOnline()` is false |
| **You are offline.** | any failed `/api/` | `errorBlock` | the error is still `OFFLINE` after two probe misses |
| List **Offline —** | that screen's `GET /api/...` | the view `load`, catching `err.isOffline` | `api.request` threw `OFFLINE`, which it must not do after one miss |
| POS offline sale | `POST /api/sales` | `completeSale` then `queueOffline` | the shop did not take the sale. It must still be saved |
| Chip **Not saved** | `POST /api/sync/pull` | `decideSaveStatus` | nothing is on the till. The detail must say the shop had nothing to copy, or the shop did not finish sending it. Rows on the till must not use this label |
| Sync does not upload | `POST /api/sync/push` | `push` in `public/js/sync.js` | the flag is false. A false flag strands the sale |
| **Signed in offline** | `POST /api/auth/login` | `signInOffline` | the shop login did not return a token and health also missed |
| Saved-till `200` `offline: true` | `POST /api/auth/login`, `GET /api/auth/me` | `answerWhenShopDown` | the proxy got no shop answer. Not a shop answer |
| Proxy `502` `UPSTREAM_UNREACHABLE` | any `/api/` | `unreachable` | every path failed |
| Window `502` `OFFLINE` | a `fetch` that threw | `shopMissResponse` | the window did not get a proxy response. Not a shop answer |

## How to continue

1. Pull destop and stockridge in their own folders. Confirm the desktop commit contains this file and the stockridge commit contains the login-page change in `public/js/app.js`.
2. `node .\tools\stage-ui.js`, then `node .\node_modules\electron-builder\cli.js --win dir --config.win.signAndEditExecutable=false`.
3. Open `dist\win-unpacked\StockRidge.exe`. Close the old window first.
4. Sign in on a connection. The login form must disappear before the welcome toast. The chip must say Online. The dashboard must not say Offline.
5. If the form remains, the opened program is not this commit. Do not add another toast. Check that the served `app.js` contains `loginGraceUntil`.
6. Take a sale with the shop unreachable. It must save on this till and leave **Saving…** when the write finishes. Opening another page must not return the login form. It must upload after the chip returns to Online.
7. Do not deploy again unless asked. Do not reset a PIN. Do not pull the parent folder. The PWA deploy of 2026-10-23 does not replace the unpacked exe.

## Not production-ready

- The exe they open may still be an older unpacked build, or the locked portable file from 20 Oct 2026 4:37:44 PM. Length of that old file was 77304820.
- The PWA hosts are on stockridge `fe1a821`. A refresh of the browser picks that up. The Windows till does not. A file shipped in the exe wins over that deploy. Rebuild `dist\\win-unpacked\\StockRidge.exe` from this commit, then open that file.
- The exe is unsigned. Leave `signAndEditExecutable` false until `CSC_LINK` exists.
- Offline sign-in only works for a username the shop has already accepted on this till. That is intentional.
- One account, one device will keep signing the other session out after the 12 second sign-in window. That is the product rule.
- The shop database is Turso, shared, not a copy on the till. A quota failure comes back as `BLOCKED`. Do not split the database to get past it.
