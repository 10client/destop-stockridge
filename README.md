# StockRidge desktop

The shop screen stays the web app. This program is the window around it, and the offline books on this computer are a SQLite file instead of IndexedDB.

The cloud database stays where it is. This app does **not** sync a till straight to Turso. Turso Sync keeps the last push and drops the other, which is the wrong rule for stock and money. Each till keeps an outbox. The existing Worker endpoints (`/api/sync/push` and the pull) are the only door into Turso. Validation stays on the Worker.

## Run it

From this folder, on the shop computer:

```
npm install
npm test
npm run rebuild
npm start
```

`npm run rebuild` compiles SQLite for Electron's own Node build. Skip it and the window will refuse to open the database. After a rebuild, `npm test` needs `npm rebuild better-sqlite3` first, because the two Node builds are not the same.

`npm start` opens the window. The UI is read from the StockRidge checkout next to this folder (`../stockridge`). Point elsewhere with `STOCKRIDGE_ROOT`.

API calls go to `STOCKRIDGE_ORIGIN`. The default is the sample Worker, `https://sample.stockridge.workers.dev`. That is the PWA, and that Worker is the door into Turso. Water packing, bakery and the other verticals come from that Worker, not from a second list inside Electron. On each launch the window copies the live PWA screens, so the two stay on the same version. A client's own Worker URL replaces the default. Do not put a Turso token in this app.

## Archive a standalone app

`npm start` is the development window. It still needs the checkout beside this folder. The archive is the program you copy to a shop computer. It carries the shop screens inside it. It does not deploy the website.

From this folder, after `npm install`:

```
npm run archive
```

That builds for the operating system you are on. With no origin set, it signs in against the same Turso books as the PWA, `https://sample.stockridge.workers.dev`. The file lands in `dist/`.

The office host `https://stockridge.stockridge.workers.dev` is the same Turso books as the sample PWA. Either address shows water packing, bakery and the other verticals. A later client's own Worker still replaces the default.

A later client's own Worker replaces the default:

```
STOCKRIDGE_ORIGIN=https://client.example.workers.dev npm run archive
```

You cannot build a Windows program on a Mac, or a Mac program on Windows. Run the command on the kind of computer the shop will use. The Windows file is not code-signed unless `CSC_LINK` points at your `.pfx` and `CSC_KEY_PASSWORD` is set. Without that certificate, Windows SmartScreen can warn, and the archive skips the signing tools on purpose.

## Production till

The database file is SQLCipher. The key is created on first launch and kept in the Windows credential store. A copied database file does not open on another computer. File → Save a copy of this till still writes an encrypted copy. Do not delete `stockridge.key`.

Sign in once while the internet works. The till keeps a verifier, not the PIN. The same PIN then opens the saved session when the Worker cannot be reached. A person who has never signed in on this computer still needs the internet once.

Other tills on the same shop network can use one computer as the LAN hub. On that computer, File → Start the LAN hub. On the others, set `STOCKRIDGE_HUB` to that address and `STOCKRIDGE_HUB_SECRET` to the secret stored on the hub. The hub shares the last mirror and the quantities already queued. It does not accept a sale in place of the Worker, and it does not hold a Turso token.

A named Windows printer, or a network receipt printer on port 9100, is chosen in the printer prefs (`deviceName` or `host`). If that printer does not answer, the usual print window still opens. Cash-drawer kick is the ESC/POS pulse, only when `drawer` is set and `host` is set.

Program updates are off until `STOCKRIDGE_UPDATE_URL` is set. `npm run publish-update` writes `dist/latest.json` with a hash. The till deletes a download that does not match. It does not replace the running program by itself.

The database file lives in the operating system's app-data folder, named `stockridge.db`, in WAL mode. File → Save a copy of this till writes a backup. That file may be the only copy of sales that have not synced yet. The window always opens on `127.0.0.1:47321`, so a saved sign-in survives the next launch. Set `STOCKRIDGE_PORT` only if that port is already taken.

A till that has been selling in Chrome on the hosted site does not hand its queue over automatically. Chrome's IndexedDB belongs to that site, and this window cannot read it. On that Chrome till, open Sync and choose Back up this device. In the desktop window, open Sync and choose Restore from a backup. Do that before abandoning the browser, or unsynced sales stay in Chrome.

If Electron says it cannot open the native SQLite module, run `npm run rebuild` again. A C++ compiler and Python are required for that step (`build-essential` and `python3` on Ubuntu).

## What the window changes

- `window.stockridgeNative.store` is the same calls the screens already make (`SR.store`).
- The first launch copies an existing IndexedDB mirror and outbox into SQLite, once.
- The service worker is not used here. The file on disk is the cache.
- A second window is refused, so two processes cannot write the same file.

## What this is not

Android is the same bridge, later: Capacitor plus a SQLite plugin that sets `window.stockridgeNative.store` to these methods. It is not in this folder. A Play Store build, code signing, and auto-update are not in this folder either.

The till file is SQLCipher. The LAN hub, a named receipt printer, and a hash-checked program download are in this folder. None of them opens Turso. The books the PWA and this window share are the Turso database behind the Worker.
