# StockRidge Android

A WebView around the same Worker the browser uses. Chrome on the phone still shows Download and Install. This app removes those buttons from the page it loads.

It does not hold a Turso token, a Cloudflare token, or a PIN. It does not open Turso. It does not open the Windows till file, `stockridge.db` or `stockridge.key`. Sales still sync through the Worker.

The PWA at `https://sample.stockridge.workers.dev`, the office host `https://stockridge.stockridge.workers.dev`, this APK, and the desktop till all use one Turso database, `stockridge-10client.aws-eu-north-1.turso.io`, at the same time. This app does not open Turso. A sale syncs through the Worker.

The machine that already builds the unpacked exe builds this APK with `tools/android-from-electron.ps1`. The paper for that path is `docs/android-from-the-electron-machine.pdf`. JDK 17 and Android SDK Platform 35 are required. Node 22 stays installed for the exe. Do not compile the ciphered SQL library for the phone.

Before building a client copy, pass `-Origin` with that client's Worker, or change `app/src/main/res/values/strings.xml` and restore the demonstration address before committing. The value in the repository is the demonstration, which is the same books as the office host. Do not ship the demonstration address to a different client, and do not create a second database for the phone.

The script writes a debug APK. Rename the file with the client name before it can be mixed up. A shop release needs a signing key that stays with that client. Do not commit the key, and do not commit the APK.

Offline SQLite on Android, a Play Store listing, and a signed release are not in this folder yet. Do not delete the Windows till file to make the phone start. Do not pass `--reset-pin`. Signing in on the phone is another device.
