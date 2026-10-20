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

API calls go to `STOCKRIDGE_ORIGIN`. The default is the sample Worker, `https://sample.stockridge.workers.dev`. A client's own Worker URL replaces that. Do not put a Turso token in this app.

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

Printers, the cash drawer, and scanners still use the web paths. Native ESC/POS and vendor card SDKs are a separate piece of work.

SQLCipher is not turned on. The file is local to this user account. Encrypting it is the next safety step, not a claim this build already makes.

Several tills in one shop, with no internet, need one machine as a LAN hub. That is not this app. With internet, each till syncs through the Worker on its own.
