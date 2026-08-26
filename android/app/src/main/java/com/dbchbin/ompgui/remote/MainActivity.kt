package com.dbchbin.ompgui.remote

import android.net.Uri
import android.os.Bundle
import android.webkit.WebSettings
import android.webkit.WebView
import com.getcapacitor.BridgeActivity

/** Thin Capacitor host for the shared remote ompgui web application. */
class MainActivity : BridgeActivity() {
    private var replicaBridge: RemoteReplicaBridge? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val activeBridge = bridge ?: return
        val webView = activeBridge.webView ?: return

        configureWebView(webView)
        replicaBridge = RemoteReplicaBridge(this, activeBridge.localUrl).also {
            it.onTopLevelUrlChanged(webView.url)
            webView.addJavascriptInterface(it, RemoteReplicaBridge.JAVASCRIPT_NAME)
        }
        webView.webViewClient = RemoteWebViewClient(this, activeBridge)

        if (replicaBridge?.configuredOrigin != null) webView.post(::loadConfiguredOrigin)
    }

    private fun configureWebView(webView: WebView) {
        webView.settings.apply {
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            allowFileAccess = false
            allowContentAccess = false
            allowFileAccessFromFileURLs = false
            allowUniversalAccessFromFileURLs = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            safeBrowsingEnabled = true
        }
    }

    internal fun loadConfiguredOrigin() {
        val origin = replicaBridge?.configuredOrigin
        if (origin == null) {
            loadLocalBootstrap(offline = false)
            return
        }
        val remote = Uri.parse(origin).buildUpon()
            .appendQueryParameter("ompguiRemote", "1")
            .build()
        bridge?.webView?.loadUrl(remote.toString())
    }

    internal fun showOffline() = loadLocalBootstrap(offline = true)

    private fun loadLocalBootstrap(offline: Boolean) {
        val activeBridge = bridge ?: return
        val webView = activeBridge.webView ?: return
        val builder = Uri.parse(activeBridge.localUrl).buildUpon().appendPath("")
        if (offline) builder.appendQueryParameter("offline", "1")
        webView.loadUrl(builder.build().toString())
    }

    internal fun isLocalUrl(target: Uri): Boolean {
        val localOrigin = bridge?.localUrl ?: return false
        return OriginValidator.isAllowedNavigation(localOrigin, target)
    }

    internal fun isConfiguredUrl(target: Uri): Boolean =
        OriginValidator.isAllowedNavigation(replicaBridge?.configuredOrigin, target)

    internal fun onTopLevelUrlChanged(url: String?) {
        replicaBridge?.onTopLevelUrlChanged(url)
    }
}
