package com.stockridge.till;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

/**
 * A WebView around the same Worker the browser uses. Chrome on the phone is
 * left alone, so the PWA still offers Download and Install. This app removes
 * those buttons from the page it loads. It does not hold a Turso token.
 */
public class MainActivity extends Activity {
    private static final Pattern INSTALL_BUTTON = Pattern.compile(
            "<button\\b[^>]*\\bid=[\"'](?:install-btn|nav-install|login-install)[\"'][^>]*>.*?</button>",
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

    private final class StockRidgeClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            if (request == null || !request.isForMainFrame()) return null;
            String raw = request.getUrl() == null ? "" : request.getUrl().toString();
            if (!raw.startsWith("https://")) return null;
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(raw).openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(20000);
                conn.setRequestProperty("Accept", "text/html,application/xhtml+xml");
                int status = conn.getResponseCode();
                String type = conn.getContentType() == null ? "" : conn.getContentType();
                if (status >= 400 || !type.toLowerCase().contains("html")) return null;
                ByteArrayOutputStream body = new ByteArrayOutputStream();
                try (InputStream in = conn.getInputStream()) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) >= 0) body.write(buf, 0, n);
                }
                String html = body.toString("UTF-8");
                html = INSTALL_BUTTON.matcher(html).replaceAll("");
                String tag = "<script>" + hideScript + "</script>";
                if (html.contains("<head>")) html = html.replace("<head>", "<head>" + tag);
                else html = tag + html;
                return new WebResourceResponse(
                        "text/html",
                        "utf-8",
                        new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
            } catch (Exception err) {
                return null;
            } finally {
                if (conn != null) conn.disconnect();
            }
        }
    }
}
