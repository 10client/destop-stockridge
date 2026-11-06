# StockRidge Android

A WebView around the same Worker the browser uses. Chrome on the phone still shows Download and Install. This app removes those buttons from the page it loads.

It does not hold a Turso token, a Cloudflare token, or a PIN. It does not open Turso. It does not open the Windows till file, `stockridge.db` or `stockridge.key`. Sales still sync through the Worker. The PWA, this APK, and the desktop till use the same Worker-backed books; the phone is not a second database or a way around one account, one device.

Build from the `destop-stockridge` checkout on the machine that builds the unpacked exe:

```powershell
& .\tools\android-from-electron.ps1
```

For the current phone flow, do not add `-Install` or `-Origin`. JDK 17 and Android SDK Platform 35 are required. Node 22 stays installed for the exe. Do not compile the ciphered SQL library for the phone, use `sdkmanager`, delete the Windows till file, or pass `--reset-pin`.

The script writes a debug APK. It does not deploy the shared `public/js` application and does not rebuild the Windows exe. A shared-UI change reaches the phone through the Worker; rebuild the APK only for native Android changes. A shop release needs a signing key that stays with that client. Do not commit the key or the APK.

Offline SQLite on Android and a Play Store listing are not in this folder yet. Signing in on the phone is another device.
