package app.aihub;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Hosts the AI Hub web app (bundled in assets/www) in a WebView. The page is
 * served from https://appassets.androidplatform.net so ES modules, storage and
 * fetch() behave as they do on a normal https site.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/assets/www/index.html";
    private static final int REQ_OPEN_FILE = 1;
    private static final int REQ_SAVE_FILE = 2;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingSave;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (HOST.equals(uri.getHost())) return false;
                openExternal(uri); // "Get a key" links and the like open in the browser
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                pick.setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(pick, "Import AI Hub data"), REQ_OPEN_FILE);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(), "AIHubAndroid");

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(START_URL);
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No app can open " + uri, Toast.LENGTH_SHORT).show();
        }
    }

    /** Called from the page as window.AIHubAndroid. */
    private class Bridge {
        @JavascriptInterface
        public void saveFile(String name, String content) {
            runOnUiThread(() -> {
                pendingSave = content;
                Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                save.addCategory(Intent.CATEGORY_OPENABLE);
                save.setType("application/json");
                save.putExtra(Intent.EXTRA_TITLE, name);
                try {
                    startActivityForResult(save, REQ_SAVE_FILE);
                } catch (ActivityNotFoundException e) {
                    pendingSave = null;
                    Toast.makeText(MainActivity.this, "No app available to save files", Toast.LENGTH_SHORT).show();
                }
            });
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_OPEN_FILE && fileCallback != null) {
            Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
            fileCallback.onReceiveValue(uri != null ? new Uri[]{uri} : null);
            fileCallback = null;
        } else if (requestCode == REQ_SAVE_FILE) {
            String content = pendingSave;
            pendingSave = null;
            if (resultCode != RESULT_OK || data == null || data.getData() == null || content == null) return;
            try (OutputStream out = getContentResolver().openOutputStream(data.getData(), "wt")) {
                out.write(content.getBytes(StandardCharsets.UTF_8));
                Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(this, "Couldn't save: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        // Let the page close a dialog, settings or the session drawer first.
        web.evaluateJavascript("window.aiHubBack ? window.aiHubBack() : false", handled -> {
            if (!"true".equals(handled)) finish();
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
