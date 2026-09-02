package com.dbchbin.ompgui.remote

import android.app.AlertDialog
import android.content.ClipDescription
import android.net.Uri
import android.os.Bundle
import android.view.DragEvent
import android.view.View
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.core.graphics.Insets
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.getcapacitor.BridgeActivity

/** Thin Capacitor host for the shared remote ompgui web application. */
class MainActivity : BridgeActivity() {
    private var replicaBridge: RemoteReplicaBridge? = null
    private var exitConfirmDialog: AlertDialog? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        WindowCompat.setDecorFitsSystemWindows(window, false)
        super.onCreate(savedInstanceState)
        window.setBackgroundDrawableResource(R.color.shell_background)
        val activeBridge = bridge ?: return
        val webView = activeBridge.webView ?: return

        configureWindowInsets(webView)
        configureWebView(webView)
        configureBackNavigation(webView)
        replicaBridge = RemoteReplicaBridge(this, activeBridge.localUrl).also {
            it.onTopLevelUrlChanged(webView.url)
            webView.addJavascriptInterface(it, RemoteReplicaBridge.JAVASCRIPT_NAME)
        }
        webView.webViewClient = RemoteWebViewClient(this, activeBridge)

        if (replicaBridge?.configuredOrigin != null) webView.post(::loadConfiguredOrigin)
    }

    /**
     * Pad IME only. System bars and display cutouts stay with web
     * `env(safe-area-inset-*)` so native and CSS padding are not stacked.
     */
    private fun configureWindowInsets(webView: WebView) {
        val contentView = webView.parent as? View ?: webView
        ViewCompat.setOnApplyWindowInsetsListener(contentView) { view, insets ->
            val imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(imeInsets.left, imeInsets.top, imeInsets.right, imeInsets.bottom)
            WindowInsetsCompat.Builder(insets)
                .setInsets(WindowInsetsCompat.Type.ime(), Insets.of(0, 0, 0, 0))
                .build()
        }
        ViewCompat.requestApplyInsets(contentView)
    }

    private fun configureWebView(webView: WebView) {
        webView.setBackgroundColor(SHELL_BACKGROUND_COLOR)
        webView.setOnDragListener { _, event -> consumeTextDrag(event) }
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

    private fun consumeTextDrag(event: DragEvent): Boolean {
        val description = event.clipDescription
        val textDrag = description != null && (
            description.hasMimeType(ClipDescription.MIMETYPE_TEXT_PLAIN) ||
                description.hasMimeType(ClipDescription.MIMETYPE_TEXT_URILIST) ||
                description.hasMimeType("text/html")
            )
        if (!textDrag) return false
        return when (event.action) {
            DragEvent.ACTION_DRAG_STARTED,
            DragEvent.ACTION_DRAG_ENTERED,
            DragEvent.ACTION_DRAG_LOCATION,
            DragEvent.ACTION_DRAG_EXITED,
            DragEvent.ACTION_DROP,
            DragEvent.ACTION_DRAG_ENDED,
            -> true
            else -> false
        }
    }

    private fun configureBackNavigation(webView: WebView) {
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    dispatchBack(webView)
                }
            },
        )
    }

    private fun dispatchBack(webView: WebView) {
        webView.evaluateJavascript(CONSUME_BACK_JS) { result ->
            runOnUiThread {
                val list = webView.copyBackForwardList()
                val current = list.currentItem?.url
                val previous = if (list.currentIndex > 0) {
                    list.getItemAtIndex(list.currentIndex - 1).url
                } else {
                    null
                }
                when (
                    ShellBackPolicy.decide(
                        webUiConsumed = ShellBackPolicy.isJsTrue(result),
                        currentUrl = current,
                        previousUrl = previous,
                        configuredOrigin = replicaBridge?.configuredOrigin,
                        localOrigin = bridge?.localUrl.orEmpty(),
                    )
                ) {
                    ShellBackPolicy.Action.ConsumedByWebUi -> Unit
                    ShellBackPolicy.Action.WebHistoryBack -> webView.goBack()
                    ShellBackPolicy.Action.ConfirmExit -> confirmExit()
                }
            }
        }
    }

    private fun confirmExit() {
        if (exitConfirmDialog?.isShowing == true) return
        exitConfirmDialog = AlertDialog.Builder(this)
            .setTitle(R.string.shell_exit_title)
            .setMessage(R.string.shell_exit_message)
            .setNegativeButton(R.string.shell_exit_cancel) { dialog, _ -> dialog.dismiss() }
            .setPositiveButton(R.string.shell_exit_confirm) { _, _ -> finish() }
            .setOnDismissListener { exitConfirmDialog = null }
            .show()
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

    internal fun isPermittedDocument(targetUrl: String?): Boolean =
        RemoteNavigationPolicy.isPermittedDocument(
            localOrigin = bridge?.localUrl,
            configuredOrigin = replicaBridge?.configuredOrigin,
            targetUrl = targetUrl,
        )

    internal fun configuredOriginForNavigation(): String? = replicaBridge?.configuredOrigin

    internal fun onTopLevelUrlChanged(url: String?) {
        replicaBridge?.onTopLevelUrlChanged(url)
    }

    companion object {
        private const val CONSUME_BACK_JS =
            "(function(){try{return !!(window.ompguiConsumeBack&&window.ompguiConsumeBack());}catch(e){return false;}})()"
        private const val SHELL_BACKGROUND_COLOR = 0xFF101317.toInt()
    }
}
