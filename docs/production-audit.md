# StockRidge development memory

Written 2026-10-21. This is the guide for the next change. Read the matching row before touching sign-in, the shop proxy, the online flag, or the screen cache. Do not repeat a change whose outcome is already known.

Outcome words used below:

- **Success** — the reported symptom stopped, and the till that was opened was the build that contained the change.
- **Partial** — the code does the intended thing on that one path. A later symptom showed the till was still wrong, or the opened program was not confirmed.
- **Not confirmed** — pushed, not proven on the Windows till they open.
- **Failed** — the symptom was still there after the change.
- **Worse** — the change removed one symptom and created another.

On 2026-10-27 they asked again, so both PWAs were deployed and the unpacked Windows till was built. Sample stamp `ridge-20261027-1243-2ab07aa`. Office stamp `ridge-20261027-1244-2ab07aa`. Stockridge `2ab07aa`. Destop `797743a`. The PIN was not changed. Do not tell anyone a row is Success until they open the new unpacked `StockRidge.exe` and the symptom is gone. Do not open the portable exe.
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
- **Functions:** `paintSafe` and `mirroredSafe` in `public/js/views/dashboard.js`. `loadSafe`, `mirroredSafe`, `renderCurrent`, and `renderNoOpenTill` in `public/js/views/till.js`. `safeBalance` and `GET /api/tills/current` in `server/routes/till.js`. `PULLABLE.branch_safe_ledger` in `server/routes/sync.js`. The client pull groups in `public/js/sync.js`.
- **Files this fix touches:**
  - `stockridge/public/js/views/dashboard.js` — paints the branch safe beside the drawer for every drawer state. Offline, `mirroredSafe` sums `branch_safe_ledger` for the active branch only.
  - `stockridge/public/js/views/till.js` — the drawer card and the no-till card show `safeBalance`. The Safe tab reads `GET /api/safe`, and if that read is offline it sums the same ledger. Do not close the drawer KPI with five parentheses; four is the working close.
  - `stockridge/server/routes/till.js` — `GET /api/tills/current` returns `safeBalance` when the drawer is somebody else's, when it is this person's, and when no drawer is open. Staff still do not receive another user's till. `MANAGER` and above do. `safeBalance` is `SUM(branch_safe_ledger.amount)` for that branch.
  - `stockridge/server/routes/sync.js` — `branch_safe_ledger` is in `PULLABLE` and in the default pull list. It is business-scoped and branch-scoped.
  - `stockridge/public/js/sync.js` — the client asks for `branch_safe_ledger` in the pull groups. Dropping it here blanks the offline safe even if the server still offers the table.
- **Files that depend on those:**
  - `GET /api/dashboard` in `server/routes/dashboard.js` already returned `cash.safeBalance` from the ledger. The screen was what hid it. `paintSafe` reads `cash.safeBalance`. It does not read `myTill`.
  - `GET /api/safe` is the Safe tab. It uses the same `safeBalance` sum. A failure there must not remove the figure beside the drawer.
  - Safe deposit, safe withdraw, till open, and till close write `branch_safe_ledger`. The painted figure is that sum. It is not `opening_cash`, not `expectedCashNow`, and not the drawer float.
  - A pinned cashier's mirror is already limited to their shop. `mirroredSafe` also filters `branch_id` to `activeBranchId`. Both limits have to stay.
  - `docs/till-fixes.md` rule 17. Do not paint the safe only for the person who opened the drawer.
- **Why it was fixed:** a general manager opened a till and deposited into the safe. Staff saw that till. The dashboard painted the safe only when `myTill` was set, so a cashier with no drawer of their own, or a cashier looking at somebody else's drawer, was shown the till and not the safe. The till page did the same. An empty current-till answer omitted `safeBalance` entirely. The offline copy did not include `branch_safe_ledger`, so a dropped line showed the drawer and a blank safe.
- **What breaks if this is altered:**
  - Gating `paintSafe` on `myTill`, or painting it only inside the "own till is open" branch, brings the symptom back. Staff see the till and not the safe.
  - Omitting `safeBalance` from the no-till `GET /api/tills/current` answer hides the safe on an empty drawer.
  - Using the till float, `opening_cash`, or `expectedCashNow` as the safe figure mixes the drawer with the safe. ElecRidge's till float and the safe deposit are different amounts.
  - Removing `branch_safe_ledger` from `PULLABLE`, from the server default pull list, or from the client pull groups makes the offline safe blank after the line drops.
  - Removing the `branch_id` filter in `mirroredSafe` shows another shop's cash on a device that once stood there. A pinned cashier must still see only their shop.
  - Showing another user's till to a cashier who is not `MANAGER` or above is not part of this fix. Do not widen that to make the safe visible.
  - Opening cash that was saved only on the branch row, before a safe ledger row existed, is not backfilled. Do not invent an `OPENING` row to make the safe match that float.
- **Outcome:** **Not confirmed.** PWA deployed 2026-10-23. Sample stamp `ridge-20261023-0840-b3da1ea`. Office stamp `ridge-20261023-0841-b3da1ea`. Stockridge `b3da1ea`. The unpacked till was not rebuilt from here. Do not show another branch's safe to a pinned cashier. Do not treat the till float as the safe. Opening cash saved only on the branch row, before the safe ledger was written, is not backfilled by this change. Do not redeploy this fix unless asked. Do not mark this Success until staff see the safe on a screen that contains `paintSafe`.

### 16. Raising a purchase order says Invalid token signature, and the order is still raised

- **Symptom:** raising a purchase order shows `Invalid token signature`. The order is still raised. On 2026-10-27 ElecRidge got six identical orders, in two groups of three, about four to five seconds apart. Five were cancelled as wrong. One stayed pending.
- **Routes:** `POST /api/purchase-orders`. The refusal string is only `TOKEN_BAD_SIGNATURE` from `verifyToken` in `domain/crypto.js`.
- **From:** the till proxy treated that post like a screen read. It tried several paths, a few seconds each, and then the other host. Each path that reached the shop inserted an order. The other host signs with its own secret, so it answered `Invalid token signature`. That refusal was what the window showed. The create route was not idempotent. The screen also read `result.po_number` while the route returned `poNumber`.
- **To:** a write other than login and catalogue pull or push is sent once, with one 18 second wait, and is not sent to the other host. The create route accepts an `Idempotency-Key` and, for a till that does not send one, returns the open order this person already raised in the last two minutes when the supplier, shop, and lines match. A cancelled order is not that match. The response includes both `poNumber` and `po_number`. The screen keeps one key for the same raise and waits if that raise is still in progress.
- **Why:** a lost answer is not proof the shop refused the order. Asking the other host turns a slow raise into a signature error, and asking again inserts another order.
- **Functions:** `isOneShotWrite` and `readBudgets` in `electron/server.js`. `idempotent` in `server/lib/idempotency.js`. `openOrderJustRaised` in `server/routes/finance.js`. The raise handler in `public/js/views/purchase-orders.js`.
- **What breaks if this is altered:** sending a purchase-order post down a second path, or to the other host, creates another order and can show `Invalid token signature` again. Cutting the one write back to 4.5 seconds aborts it after the shop has kept it. Reusing an idempotency key for a different body is refused. A second identical raise inside two minutes returns the open order; it does not insert another. Do not treat that window as a reason to block a cancelled order from being raised again.
- **Outcome:** **Not confirmed.** PWA deployed 2026-10-27 because they asked. Sample stamp `ridge-20261027-1243-2ab07aa`. Office stamp `ridge-20261027-1244-2ab07aa`. Stockridge `2ab07aa`, stamp commit `b9f25bd`. Destop `797743a`. PIN unchanged. Readiness ready, 7 businesses. The unpacked Windows till was built here as `dist\\win-unpacked\\StockRidge.exe` (Windows x64, the SQLite module is a Windows DLL, not a Linux file). It contains `isOneShotWrite`. Do not mark this Success until a raise on that exe shows the order number and does not show `Invalid token signature`. Do not open `dist\\StockRidge-0.1.0-win-x64.exe`. Do not pass `--reset-pin`.
- **Data, 2026-10-27:** ElecRidge only. `PO-ELECRI-7BAJE` was received and paid, and none of those units had been sold. That receipt was reversed: 22 units off the shelf, 12 serials released, bank and inventory journals reversed (`JE-REV-MVQM4S1J`), supplier balance back to zero. `PO-ELECRI-L7DDP`, the duplicate still pending, was cancelled. Withholding rows for those practice orders had not been remitted and were removed. The product names were kept. Businesses and owners were not wiped. Do not run that reversal again.

### 17. The sell shows one price and the receipt shows another

- **Symptom:** the sell shows, for example, 58000, and the receipt shows 50000. That stops the sale. On 2026-10-27 the Binatone Standing Fan 18" catalogue price was 58500 and the goods receipt stored 50000. The Scanfrost cooker was 368000 on the sell and 300000 on the receipt. The Silver Crest blender was 29500 on the sell and 20000 on the receipt. No sale had been completed.
- **Routes:** `POST /api/sales`, `POST /api/sales/preview`, `POST /api/purchase-orders/:id/receive`, `POST /api/stock/receipts`.
- **From:** the sell screen quotes `products.selling_price`. The receipt prints the price the server stored on the sale line. `resolveUnitPrice` charged `stock_batches.selling_price_per_unit` ahead of the catalogue price. The cashier collected the quoted amount. The server totalled the batch amount and refused the payment as too much or too little. The receive form said a later delivery does not change a price already set, then stored the typed figure as the price the till charges.
- **To:** a catalogue selling price above zero is the price on the receipt. A goods receipt stores that price on the new batch. A typed figure is used only when the catalogue has no price yet. Before payment, the cart takes the preview price, so the amount collected is the amount printed. A price typed at the counter is left alone. The sale-line `price_source` stays `BATCH`. Do not add a new source. That check is in migration `0001`.
- **Why:** two prices for one item refuse the sale at the counter. The price the sell screen shows is the price the customer was quoted.
- **Functions:** `resolveUnitPrice` in `domain/pricing.js`. The receive handler in `server/routes/finance.js`. The direct receipt in `server/routes/stock.js`. `alignReceiptPrices` and `showPreviewWarnings` in `public/js/views/pos.js`.
- **What breaks if this is altered:** charging the batch price ahead of a catalogue price brings the split back. The receipt shows the delivery figure and the payment is refused. Leaving the cart on the quoted price while the server charges another figure does the same. Do not rewrite `purchase_order_receipts.selling_price`. That row is what was typed. Do not reverse `JE-REV-MVQM4S1J`.
- **Outcome:** **Not confirmed.** Not deployed. The three active ElecRidge batches were aligned to the catalogue selling price so the shop that is already open charges that price: fan 58500, cooker 368000, blender 29500. Cost and quantity were not changed. Do not mark this Success until a sale of one of those items prints the sell price and completes. Do not deploy unless asked. If 50000 was the price they meant to charge, change the product selling price. The receipt follows that. Do not pass `--reset-pin`.

### 18. Complete sale says applyLocalSale is not defined, and a bill has no payment code

- **Symptom:** clicking Complete sale says `applyLocalSale is not defined`. The sale is already in Sales history. A bill printed for a named customer has no code to bring back, and the staff name does not show on the bill or the receipt.
- **Routes:** `POST /api/sales`, `POST /api/bills`, `GET /api/bills/lookup`, `POST /api/bills/:id/pay`.
- **From:** `completeSale` called `applyLocalSale` after the shop had recorded the sale. That function was never defined. The error is thrown before `.catch` can see it, so the till shows a failure and does not show the receipt. A bill held the goods and printed a number, but the cashier had to hunt the open-bills list. The printed bill did not name the staff who raised it. The receipt used `fullName` only, so a profile with a username and no full name printed a blank cashier.
- **To:** `applyLocalSale` is defined and cannot fail a recorded sale. The receipt still opens. A bill gets a payment code from the hour and minute it was printed, mixed with the bill number, the total, and the shop. The code is printed on the bill. On Sell, Pay a printed bill takes that code, shows the customer, the staff, and the lines, and marks those goods paid. Payment goes through the same sale engine as every other sale, so the receipt and the books use the bill total. If the sale would record a different total, the payment is refused before it is taken. The staff who raised the bill and the staff who took the payment are named on the paper.
- **Why:** a sale that is already in the book must not look failed. A customer coming back with a bill needs one code, not a search. The bill, the receipt, and the books have to be the same figure, and the paper has to name the staff.
- **Functions:** `applyLocalSale`, `findPrintedBill`, and `showPaidDocument` in `public/js/views/pos.js`. `paymentCode` in `domain/billing.js`. `raise` and `findByCode` in `server/services/billService.js`. The pay handler in `server/routes/bills.js`.
- **What breaks if this is altered:** removing `applyLocalSale`, or calling it before it exists, brings the error back after the sale is saved. Charging a different total from the bill splits the receipt from the books. Do not store the sign-in PIN in the payment code. Do not take a second payment for a bill that is already paid.
- **Outcome:** **Not confirmed.** Not deployed. The till they rebuild from this commit stops the `applyLocalSale` error and shows the payment-code box. The live shop does not know the code until they ask for a deploy. Do not mark this Success until Complete sale shows the receipt, and a bill paid by its code prints that total with the staff name. Do not pass `--reset-pin`.

### 19. After a sale the screen stays on the cart, and Take payment says add something to the bill

- **Symptom:** an item is put in the cart. After it is cancelled or completed, the screen stays on the card that shows the selected products. It does not return to the card that shows Take payment. Clicking Take payment then says "Add something to the bill first."
- **Routes:** none. This is the Sell screen in `public/js/views/pos.js`. The same file is served by the PWA and staged into the unpacked till.
- **From:** Find, the cart, and Take payment were all on one page. On a narrow screen the cart stayed in view after the sale. The Take payment button called `raiseBill` even when the cart was empty, and that function warned instead of moving to a card that could take a payment.
- **To:** Sell has three cards: Find goods, Cart, and Take payment. Adding a product opens Cart. Cancelling or completing a sale clears the cart and opens Take payment. An empty Take payment card does not print a bill. It pays a printed bill, or opens Find goods.
- **Why:** the cashier has to know which card they are on. A finished sale must not look like the goods are still selected, and Take payment must not refuse an empty cart with a bill warning.
- **Functions:** `showStep`, `resetTill`, and `primaryAction` in `public/js/views/pos.js`. The step bar is `.sell-nav` in `public/css/app.css`.
- **What breaks if this is altered:** putting Find, Cart, and Take payment back on one scrolling page brings the stuck cart card back on a phone. Calling `raiseBill` when the cart is empty brings the warning back. Do not hide the step bar.
- **Outcome:** **Not confirmed.** PWA deployed 2026-10-28 because they asked for it on the PWA. Sample stamp `ridge-20261028-0905-4a9e95e`. Office stamp `ridge-20261028-0906-4a9e95e`. Stockridge `4a9e95e`. PIN unchanged. Not marked Success until they open Sell, add a product, cancel or complete it, and land on Take payment without the bill warning. The unpacked till does not have this until they build it. Do not open the portable exe. Do not pass `--reset-pin`.

### 20. Offline sign-in says the shop is up and the page did not load

- **Symptom:** offline on the PWA, sign-in pops up "The shop is up, but this screen did not load. Try again." The saved page does not open.
- **Routes:** `POST /api/auth/login`, then `GET /api/dashboard`. The same screens are staged into the unpacked till.
- **From:** one missed call was worded as if the shop had answered, before the health probe had answered. The dashboard then refused the saved figures while the chip still said online.
- **To:** "The shop is up" is used only after `/api/health` answers. If the shop does not answer, sign-in opens the saved till and the dashboard paints the saved figures. A phone with no network does not wait on a dead sign-in. Electron does not trust that browser flag.
- **Why:** an offline cashier has to get into the till they already saved. A sentence that the shop is up, with Try again, blocks that.
- **Functions:** `settleMiss` and `shopConfirmed` in `public/js/api.js`, `doLogin` in `public/js/app.js`, `refresh` in `public/js/views/dashboard.js`. The till window also softens that sentence in `desktop-production.js` when the shop has not answered.
- **What breaks if this is altered:** putting the "shop is up" sentence back on a failed probe brings the popup back. Trusting the browser offline flag inside Electron marks a working proxy offline. Opening the saved till after a probe has answered brings back the expired-session sign-in.
- **Outcome:** **Not confirmed.** PWA deployed 2026-10-28. Sample and office stamp `ridge-20261028-0933-a211d23`. Stockridge `a211d23`. PIN unchanged. Not marked Success until they sign in on the PWA with no connection and the saved page opens, without that sentence. The unpacked till needs a build from this commit. Do not open the portable exe. Do not pass `--reset-pin`. Do not store the PIN.

### 21. Offline remaining stock shows, then the products disappear

- **Symptom:** an offline sale saves, and once it reaches the shop the figures are right. While it is still on the till, the remaining stock count is wrong. It shows some stock at the start, then stops showing those products.
- **Routes:** none for the count. The sale is still `POST /api/sales` when the line returns. The count on the Windows till is `shelf_batches` in the device file.
- **From:** the browser shelf cut was not the till they sell on. The Windows till stored stock as JSON and also held every queued sale. Every stock read added that hold on top of a quantity the same sale had already cut. Available went to zero, so Sell stopped offering the product. A download could put the shop's old count back, or cut the sale again. The hold used the sell quantity, not base units.
- **To:** the device file runs the shop's guarded stock `UPDATE`. That is the only cut on this till. Free stock, soonest expiry, then the oldest receipt, in base units. A hire does not leave the shelf. This till's own sale is not held on top of that cut. Other tills may still reduce what this till offers. A download replays each unsynced sale once. A second replay without a new download does nothing. A thrown local update does not fail a recorded sale.
- **Why:** the cashier has to see what is left before the line returns. The shop already records the sale correctly. Hiding the product is not a count.
- **Functions:** `applyLines` in `destop-stockridge/lib/stock-sql.js`. `applySale` and `replayShelf` in `lib/device-store.js`. `applyLocalSale` in `public/js/views/pos.js` calls that statement when the engine is sqlite. `replayShelf` in `public/js/sync.js` after a stock download.
- **What breaks if this is altered:** putting this till's own hold back on the shelf read hides the product again. Cutting in JavaScript and also in SQL takes the units twice. A download that does not replay the outbox puts the old count back. Replaying on every stock-screen open takes the sale twice.
- **Outcome:** **Not confirmed.** Not deployed. Not marked Success until they sell offline and the remaining count stays visible and drops by that sale. Destop `f7f7c4c`. Stockridge `069431a`. The unpacked till needs a build from those commits. Do not open the portable exe. Do not pass `--reset-pin`. Do not treat stockridge `00445b6` or destop `52f591c` as this fix.

### 22. Offline details are invalid, and stock in hand is off

- **Symptom:** after Saving finishes, the offline details do not match the shop. Stock in hand is the example.
- **Routes:** none for the offline figure. The download is still `POST /api/sync/pull`. The shop figure is `GET /api/stock`.
- **From:** the saved download stayed a JSON blob. The till added that blob up, and a partial shelf table did not keep the product, the cost, or the branch the shop joins. That total is not stock in hand.
- **To:** when the save has saved, the usable rows are written into the shop's tables on the device file: products, categories, units, batches, customers, prices, purchase orders, and the other catalogue tables this till already pulls. Stock in hand is the shop's sum of `stock_batches.quantity` for that shop, joined to the saved product, excluding quarantine and expired. Available is quantity minus reserved. A sale cuts the cloned batch, so the next read is the new sum. The PIN is not stored.
- **Why:** offline and online have to be the same rows. A second total from JSON will not stay in step with the shop.
- **Functions:** `upsert` and `stockOnHand` in `destop-stockridge/lib/shop-clone.js`. `putMany` in `lib/device-store.js` writes those tables in the same save. `fromMirror` in `public/js/views/stock.js` reads that sum.
- **What breaks if this is altered:** reading the JSON blob again makes stock in hand drift. Dropping the product join makes the sum zero. Putting a secret column on the device file stores something the till must not keep.
- **Outcome:** **Not confirmed.** Not deployed. Not marked Success until they save and the offline stock in hand matches the shop. Do not open the portable exe. Do not pass `--reset-pin`. Do not treat `f7f7c4c` or `069431a` as this fix.

### 23. Saved, then offline sales data is incomplete and products stop displaying

- **Symptom:** the chip says Saved, so the till looks ready for a full offline day. After an offline sign-in the figures are incomplete and inaccurate. On Sell, a product starts to count and then stops displaying.
- **Routes:** the sales book is still `GET /api/sales` and `GET /api/sales/:id` on the shop that is already live. The table pull is `POST /api/sync/pull` once that shop is updated. The till does not open Turso.
- **From:** Saved meant the catalogue was present and the outbox was empty. Receipts, lines, and payments were not stored. The sell list dropped a product when a hold or a missing purchase-order link made the free count zero.
- **To:** the device file has the sales tables: sales, sale items, payments, serials, returns, bills, bill holds, sale issues, change owed, till sessions, and serial numbers. A save copies that book. Saved is not shown until the copy has finished. A product with units still on the shelf stays on the sell list.
- **Why:** offline has to show the same sales facts the shop holds. A chip that says Saved before those rows are stored is a false ready.
- **Functions:** `copySalesBook` in `public/js/sync.js`. `upsert` in `destop-stockridge/lib/shop-clone.js`. `decideSaveStatus` in `lib/save-status.js`. `sellableIndex` in `public/js/views/pos.js`.
- **What breaks if this is altered:** saying Saved after the catalogue alone brings back the false ready. Dropping a product because its free count is zero brings back the blank sell list. Putting a Turso token on the till is not the copy.
- **Outcome:** **Not confirmed.** Not deployed. Not marked Success until they leave the till connected until it says Saved, sign in offline, and the sales list and the sell products stay. Do not open the portable exe. Do not pass `--reset-pin`. Do not treat `5882d81` as this fix. Do not treat the sales-book push as the false-Saved fix in the next row.

### 24. Saved while the shop refused the session, and 20 products against 50

- **Symptom:** Last error was cut to "The shop did not accept this session, so the catalogue was n." The card said Saved, "The catalogue and the sales book are on this till. You can disconnect." Stamp `Catalogue saved: 2026-10-28 19:01 · 20 products · 11 stock rows`. The shop has 50 products. The same screen sometimes said Part saved.
- **Routes:** the chip and the Sync card both have to use one decision. The count is `GET /api/products` paging total against the products stored on the till. The till does not open Turso.
- **From:** the error was sliced to 60 characters. An old `last_pull_at` and `sales_copy_at` still meant Saved after the shop refused the session. The Sync card omitted the sales-book fact, so it flipped to Part saved. The product count was the rows stored here, not the shop total.
- **To:** a refused session is not Saved, and the sentence is shown in full. A till that has fewer products than the shop is Part saved, and it downloads the names again before anyone is told to disconnect. Both painters use the same facts.
- **Why:** Saved is a promise that this copy is the shop. A refused session, or 20 stored against 50 at the shop, is not that promise.
- **Functions:** `decideSaveStatus` in `lib/save-status.js`. `ensureCatalogue` and `saveFacts` in `public/js/sync.js`. `paintFinishedSaving` in `public/js/views/sync.js`. `installSaveIndicator` in `public/js/desktop-production.js`.
- **What breaks if this is altered:** slicing the error, or trusting an old stamp after a refused session, brings the false Saved back. Counting only the rows on the till hides a short catalogue.
- **Outcome:** **Not confirmed.** Not deployed. Not marked Success until the chip matches the shop: no Saved after a refused session, and no Saved while the till has fewer products than the shop. Do not open the portable exe. Do not pass `--reset-pin`. Do not treat destop `5a23ab1` or stockridge `bb11e81` as this fix.

### 25. The line returns and the till signs the person out

- **Symptom:** the till is open offline. When the network returns, the person is signed out. That is wrong.
- **Routes:** `GET /api/auth/me` and `POST /api/sync/push` when the browser `online` event fires. The other host of the same books can answer `Invalid token signature`. The till does not open Turso.
- **From:** the session check and the sync cycle ran in the same breath as the line returning. A refusal, or the other host's signature, cleared the token and showed the login page.
- **To:** the saved till stays open. This computer's SQL is the follower. Turso, behind the Worker, is the leader. The follower pushes its outbox, then copies the leader's catalogue. A signature from the other host is dropped. Another device signs this till out only when the same shop confirms it twice after the line has settled.
- **Why:** a counter that was selling offline must still be that person when the line returns. The shop is the leader of the books, not a reason to throw the session away.
- **Functions:** `decideSessionHold` in `lib/session-hold.js`. `handleAuthFailure` in `public/js/app.js`. `resumeAfterLine` in `public/js/sync.js`. `foreignSignature` in `electron/server.js`.
- **What breaks if this is altered:** treating the first answer after the line returns as a dead session brings the logout back. Putting a Turso token on the till is not the follower. Signing out on one `SESSION_SUPERSEDED` before the line has settled breaks one account, one device in the other direction.
- **Outcome:** **Not confirmed.** Not deployed. Not marked Success until they sell offline, the line returns, and they are still signed in, with the queued sale uploading. Do not open the portable exe. Do not pass `--reset-pin`. Do not put a Turso token on the till.

### 26. Offline sign-in says no till is open, and a page change signs the person out

- **Symptom:** a till was opened online. After logout, offline sign-in, the dashboard said "No till is open". Moving between pages as the line returned signed the person out. Offline should offer only Sell, Sales, Stock, Till, Attendance, and Change owed, with those books on the till.
- **Routes:** `POST /api/tills/open`, `GET /api/tills`, `GET /api/tills/current`, `GET /api/attendance`, `GET /api/change-owed`. The till does not open Turso.
- **From:** the open drawer lived only on the shop. The offline dashboard invented an empty drawer. A page request that the shop refused was treated as the end of the session.
- **To:** opening a till writes that session into this computer's SQL before anyone logs out. The follower copies tills, attendance, and change owed through the shop routes that are already live. Offline navigation is those six screens. A page change, or the line returning during one, keeps the saved session.
- **Why:** the drawer the person opened is the drawer they must count. A page change is not a sign-out.
- **Functions:** `copyCounterBooks` in `public/js/sync.js`. `fromMirror` in `public/js/views/dashboard.js`. `decideSessionHold` in `lib/session-hold.js`. `staff_attendance` in `lib/shop-clone.js`.
- **What breaks if this is altered:** leaving the open till only on the shop brings back the empty drawer. Signing out on a page 401 brings back the logout. Putting a Turso token on the till is not the copy.
- **Outcome:** **Not confirmed.** Not deployed. Not marked Success until they open a till, sign out, sign in offline, and still see that drawer, and a page change as the line returns leaves them signed in. Do not open the portable exe. Do not pass `--reset-pin`.

### 27. Part saved from a missing till column

- **Symptom:** the chip said Part saved, and the detail was `SqliteError: table till_sessions has no column named cash_sales_total`. The same card already had 20 of 20 products.
- **From:** the open-drawer copy named `cash_sales_total`. The till file had been created before that column. `CREATE TABLE IF NOT EXISTS` does not add a column to a table that already exists. The failed write was stored as a catalogue error.
- **To:** the next open adds any missing clone column, then the write uses it. That SQL sentence is cleared from the chip. The catalogue count is unchanged.
- **Why:** a missing drawer column is not a short product list. Deleting the till file would throw away the books already saved.
- **Functions:** `align` in `lib/shop-clone.js`. `_clearSchemaSaveError` in `lib/device-store.js`.
- **What breaks if this is altered:** naming a new column without adding it to the existing file brings the same SQLite error back, and the chip says Part saved again.
- **Outcome:** **Not confirmed.** Not deployed. Do not delete `stockridge.db`. Do not pass `--reset-pin`.

### 28. Sending queued sales signs the till out

- **Symptom:** the line returned, queued sales showed Sending, then the till signed the person out. Before they signed in again the chip went Saving, then Saved.
- **From:** the upload, and the page reload after it, were read as the session ending. The hold lasted twenty seconds and was cleared when the cycle ended, even if the sale was still waiting. A second confirmation then signed the till out. After a new sign-in the same queue uploaded, so the chip moved Sending, then Saving, then Saved.
- **To:** one cycle pushes the outbox first. A refusal of that upload does not open the rest of the shop and does not sign the till out. Sales still waiting on this till block the sign-out, including a second confirmation. The hold stays until those sales have uploaded. The page reloads only when a row was stored and the person is still signed in. A real same-host refusal after the queue is empty still signs out.
- **Why:** a sale saved on this till is not a reason to sign the person out. The screen they are looking at has to show the count after the upload.
- **Functions:** `decideSessionHold` in `lib/session-hold.js`. `holdCatchUp` in `public/js/api.js`. `resumeAfterLine` in `public/js/sync.js`. `handleAuthFailure` in `public/js/app.js`.
- **What breaks if this is altered:** treating the upload's refusal as a sign-out brings the logout back. Clearing the hold while the queue still has sales brings it back too. Skipping the reload leaves yesterday's count on screen.
- **Outcome:** **Not confirmed.** Not deployed. Not marked Success until an offline sale, then the line returning, stays on the same sign-in and the chip moves Sending, then Saving, then Saved. Do not pass `--reset-pin`.

### 29. Vertical books were not on the till

- **Symptom:** an electronics, hire, pharmacy, water-packing, or bakery business could sign in offline and not find the books that vertical uses.
- **From:** the till SQL held the retail catalogue and the sales book. Warranty, agreements, vehicles, machines, the controlled register, and the prescription on a sale were only on the shop.
- **To:** those tables are created on the existing till file. The copy uses the shop routes that are already live and stores the full row. A feature that business does not use does not mark the catalogue Part saved.
- **Why:** each vertical's books are the thing the person has to count and sell from when the line is down.
- **Functions:** `copyVerticalBooks` in `public/js/sync.js`. The table list in `lib/shop-clone.js`.
- **What breaks if this is altered:** leaving a vertical's rows only on the shop brings back an empty hire book, an empty fleet, and a warranty list that says it lives on the server. Putting a Turso token on the till is not the copy.
- **Outcome:** **Not confirmed.** Not deployed. Do not delete `stockridge.db`. Do not pass `--reset-pin`.

### 30. The catch-up read the whole shop every few minutes

- **Symptom:** coming back online, and the quiet 3-minute pass, asked the shop for whole books and wrote those rows again even when nothing had changed.
- **From:** sales started at 2020 on every pass and then opened up to 120 receipts. Hire, fleet, warranty, and the other vertical books were listed on every pass, and each parent was opened again. The shelf was pulled in full every pass. The till wrote the row even when `updated_at` was the one it already held.
- **To:** the first copy is still the full book. Later copies follow a watermark. A child is opened only when that parent changed. The shelf is read in full the first time and about every 15 minutes. A short reconnect uses the cursor. An unchanged stamp is not written. The open page reloads only when a row was stored.
- **Why:** a till that is already caught up should not keep reading and writing the same books. The line returning is one catch-up, not a reason to copy the shop again on every blip.
- **Functions:** `copySalesBook`, `copyVerticalBooks`, `copyCounterBooks`, and `pullRequest` in `public/js/sync.js`. `putMany` in `lib/device-store.js`.
- **What breaks if this is altered:** copying from 2020 on every pass brings the read storm back. Skipping the first copy leaves the offline book empty. Advancing the watermark before the write commits hides rows. Putting Turso on the till is not this cut.
- **Outcome:** **Not confirmed.** Not deployed. A refused upload must not start this book copy, and must not sign the till out. Do not pass `--reset-pin`.

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
- The PWA hosts are on the purchase-order stamps: sample `ridge-20261027-1243-2ab07aa`, office `ridge-20261027-1244-2ab07aa`, stockridge `2ab07aa`. A refresh of the browser picks that up. The Windows till does not, until they close the old window and open the unpacked `StockRidge.exe` built on 2026-10-27. A file shipped in that exe wins over the PWA. Do not open the locked portable exe. Do not pass `--reset-pin`.
- The exe is unsigned. Leave `signAndEditExecutable` false until `CSC_LINK` exists.
- Offline sign-in only works for a username the shop has already accepted on this till. That is intentional.
- One account, one device will keep signing the other session out after the 12 second sign-in window. That is the product rule.
- The shop database is Turso, shared, not a copy on the till. A quota failure comes back as `BLOCKED`. Do not split the database to get past it.
