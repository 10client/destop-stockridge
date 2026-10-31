package com.stockridge.till;

import android.app.Activity;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

/**
 * A WebView around the same Worker the browser uses. Chrome on the phone is
 * left alone, so the PWA still offers Download and Install. This app removes
 * those buttons from the page it loads.
 *
 * This is not the Windows till. It does not open stockridge.db, stockridge.key,
 * or Turso. Sales still go through the Worker. The last shop screen is kept
 * on this phone so the till can open when the line is down. It does not cache /api/.
 * The build paper is docs/android-from-the-electron-machine.pdf.
 */
public class MainActivity extends Activity {
    // Same signature the Windows till sends. A Dalvik client is not a browser,
    // and a rejected fill must not be stored as the offline page.
    private static final String CHROME_UA = "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
    private static final Pattern INSTALL_BUTTON = Pattern.compile(
            "<button\\b[^>]*\\bid=[\\\"'](?:install-btn|nav-install|login-install)[\\\"'][^>]*>.*?</button>",
            Pattern.CASE_INSENSITIVE | Pattern.DOTALL);

    private WebView webView;
    private String hideScript = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        hideScript = readAsset("hide-install.js");
        webView = new WebView(this);
        setContentView(webView);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.setWebViewClient(new StockRidgeClient());
        webView.loadUrl(getString(R.string.stockridge_origin));
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) >= 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } catch (Exception err) {
            return "";
        }
    }

    private File shellDir() {
        File dir = new File(getCacheDir(), "sr-shell");
        if (!dir.isDirectory() && !dir.mkdirs()) return getCacheDir();
        return dir;
    }

    private File shellHtml() {
        return new File(shellDir(), "shell.html");
    }

    private File assetFile(Uri uri) {
        String path = uri.getPath() == null ? "" : uri.getPath();
        String query = uri.getQuery() == null ? "" : uri.getQuery();
        String name = (path + "_" + query).replaceAll("[^A-Za-z0-9._-]", "_");
        if (name.length() > 80) name = name.substring(0, 48) + "_" + Integer.toHexString(name.hashCode());
        return new File(shellDir(), name);
    }

    private boolean shellAsset(String path) {
        return path.startsWith("/js/") || path.startsWith("/css/")
                || path.startsWith("/icons/") || path.startsWith("/brand/")
                || "/sw.js".equals(path);
    }

    private void writeFile(File file, byte[] body) {
        if (body == null || body.length == 0) return;
        File parent = file.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) return;
        File tmp = new File(parent == null ? getCacheDir() : parent, file.getName() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(body);
            out.flush();
        } catch (Exception ignored) {
            tmp.delete();
            return;
        }
        if (!tmp.renameTo(file)) {
            file.delete();
            if (!tmp.renameTo(file)) tmp.delete();
        }
    }

    private boolean radioUp() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            if (cm == null) return true;
            Network net = cm.getActiveNetwork();
            if (net == null) return false;
            NetworkCapabilities caps = cm.getNetworkCapabilities(net);
            return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (Exception err) {
            return true;
        }
    }

    private byte[] readFile(File file) {
        if (file == null || !file.isFile() || file.length() <= 0 || file.length() > 8_000_000) return null;
        try (InputStream in = new FileInputStream(file);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) >= 0) out.write(buf, 0, n);
            return out.toByteArray();
        } catch (Exception err) {
            return null;
        }
    }

    private WebResourceResponse bytesResponse(String mime, String encoding, byte[] body) {
        return new WebResourceResponse(mime, encoding, new ByteArrayInputStream(body));
    }

    private String encodingFor(String path) {
        if (path.endsWith(".png") || path.endsWith(".jpg") || path.endsWith(".jpeg")
                || path.endsWith(".webp") || path.endsWith(".gif") || path.endsWith(".ico")) return null;
        return "utf-8";
    }

    private String mimeFor(String path, String header) {
        if (header != null && header.contains("/")) return header.split(";")[0].trim();
        if (path.endsWith(".js")) return "application/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".html")) return "text/html";
        return "application/octet-stream";
    }

    private final class StockRidgeClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            if (request == null || request.getUrl() == null) return null;
            if (request.getMethod() != null && !"GET".equalsIgnoreCase(request.getMethod())) return null;
            Uri uri = request.getUrl();
            if (!"https".equalsIgnoreCase(uri.getScheme())) return null;
            String host = uri.getHost() == null ? "" : uri.getHost();
            if (!host.endsWith("stockridge.workers.dev")) return null;
            String path = uri.getPath() == null ? "/" : uri.getPath();
            // Shop answers are never stored on the phone. A cached sale total is a lie.
            if (path.startsWith("/api/")) return null;
            boolean main = request.isForMainFrame();
            if (!main && !shellAsset(path)) return null;
            // No radio: do not wait on a socket. The last page is the till.
            if (!radioUp()) return cached(uri, path, main);

            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(uri.toString()).openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(4000);
                conn.setReadTimeout(20000);
                conn.setRequestProperty("User-Agent", CHROME_UA);
                conn.setRequestProperty("Accept", main ? "text/html,application/xhtml+xml" : "*/*");
                int status = conn.getResponseCode();
                String type = conn.getContentType() == null ? "" : conn.getContentType();
                // A server answer is not a network miss. Let the WebView load it.
                if (status >= 400) return null;
                ByteArrayOutputStream body = new ByteArrayOutputStream();
                try (InputStream in = conn.getInputStream()) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) >= 0) body.write(buf, 0, n);
                }
                if (main) {
                    if (!type.toLowerCase().contains("html")) return null;
                    String html = body.toString("UTF-8");
                    html = INSTALL_BUTTON.matcher(html).replaceAll("");
                    String tag = "<script>" + hideScript + "</script>";
                    if (html.contains("<head>")) html = html.replace("<head>", "<head>" + tag);
                    else html = tag + html;
                    byte[] bytes = html.getBytes(StandardCharsets.UTF_8);
                    // A challenge page is not the till. Do not store it as the shell.
                    if (html.contains("id=\"boot\"") || html.contains("id='boot'")) writeFile(shellHtml(), bytes);
                    return bytesResponse("text/html", "utf-8", bytes);
                }
                byte[] bytes = body.toByteArray();
                writeFile(assetFile(uri), bytes);
                return bytesResponse(mimeFor(path, type), encodingFor(path), bytes);
            } catch (Exception err) {
                return cached(uri, path, main);
            } finally {
                if (conn != null) conn.disconnect();
            }
        }

        private WebResourceResponse cached(Uri uri, String path, boolean main) {
            if (main) {
                byte[] html = readFile(shellHtml());
                if (html == null) return null;
                return bytesResponse("text/html", "utf-8", html);
            }
            byte[] body = readFile(assetFile(uri));
            if (body == null) return null;
            return bytesResponse(mimeFor(path, null), encodingFor(path), body);
        }
    }
}
