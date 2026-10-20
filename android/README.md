# StockRidge Android

A WebView around the same Worker the browser uses. Chrome on the phone still shows Download and Install. This app removes those buttons from the page it loads.

It does not hold a Turso token, a Cloudflare token, or a PIN. It does not open Turso. Sales still sync through the Worker.

The PWA at `https://sample.stockridge.workers.dev`, the office host `https://stockridge.stockridge.workers.dev`, this APK, and the desktop till all use one Turso database, `stockridge-10client.aws-eu-north-1.turso.io`, at the same time. This app does not open Turso. A sale syncs through the Worker.

Before building a client copy, change `app/src/main/res/values/strings.xml` to that client's Worker. The value in the repository is the demonstration, which is the same books as the office host. Do not ship the demonstration address to a different client, and do not create a second database for the phone.

Open this `android` folder in Android Studio, wait for Gradle, then Build APK. Rename the file with the client name before it can be mixed up. A shop release needs a signing key that stays with that client. Do not commit the key.
