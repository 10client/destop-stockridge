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

## Before the next change

- If the screen says **Failed to fetch** or **That failed.**, the window called the wrong host, or the proxy mislabelled the body. Do not add a direct Worker fetch to "fix" it.
- If the screen says the account is on another device right after sign-in on this till, check the device id and the old token. Do not allow two live sessions to silence it.
- If a rebuild does not change what the window runs, the screen cache is hiding the shipped file. The shipped file must win.
