# StockRidge Android

A WebView around the same Worker the browser uses. Chrome on the phone still shows Download and Install. This app removes those buttons from the page it loads.

It does not hold a Turso token, a Cloudflare token, or a PIN. It does not open Turso. Sales still sync through the Worker.

Before building a client copy, change `app/src/main/res/values/strings.xml`. The value there is the demonstration:

`https://sample.stockridge.workers.dev`

A client must use their own Worker URL. Do not ship the demonstration address to a shop.

Open this `android` folder in Android Studio, wait for Gradle, then Build APK. Rename the file with the client name before it can be mixed up. A shop release needs a signing key that stays with that client. Do not commit the key.
