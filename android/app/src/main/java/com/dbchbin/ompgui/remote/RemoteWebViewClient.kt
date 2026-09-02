package com.dbchbin.ompgui.remote

import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import com.getcapacitor.Bridge

/** Keeps only the local bootstrap and configured origin inside the WebView. */
internal class RemoteWebViewClient(
    private val activity: MainActivity,
    private val bridge: Bridge,
) : WebViewClient() {
    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
        bridge.localServer?.shouldInterceptRequest(request)

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
        handleNavigation(request.url)

    private fun handleNavigation(target: Uri?): Boolean {
        if (target == null) return true
        if (activity.isPermittedDocument(target.toString())) return false

        if (target.scheme.equals("http", ignoreCase = true) || target.scheme.equals("https", ignoreCase = true)) {
            try {
                activity.startActivity(Intent(Intent.ACTION_VIEW, target).apply {
                    addCategory(Intent.CATEGORY_BROWSABLE)
                })
            } catch (_: ActivityNotFoundException) {
                // No browser is installed; leave the current page unchanged.
            }
        }
        // Unsafe schemes (including javascript:, file:, content:, and intent:)
        // are never handed to another application.
        return true
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        super.onReceivedError(view, request, error)
        if (request.isForMainFrame) applyLoadFailure(view, request.url?.toString())
    }

    override fun onReceivedHttpError(
        view: WebView,
        request: WebResourceRequest,
        errorResponse: WebResourceResponse,
    ) {
        super.onReceivedHttpError(view, request, errorResponse)
        if (request.isForMainFrame) applyLoadFailure(view, request.url?.toString())
    }

    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError?) {
        handler.cancel()
        val failingUrl = error?.url ?: return
        applyLoadFailure(view, failingUrl)
    }

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
        activity.onTopLevelUrlChanged(url)
        if (!activity.isPermittedDocument(url)) {
            view.stopLoading()
            handleNavigation(Uri.parse(url))
            restorePreviousDocument(view)
            return
        }
        bridge.reset()
    }

    override fun onPageFinished(view: WebView, url: String) {
        super.onPageFinished(view, url)
        view.evaluateJavascript(PREVENT_TEXT_DROP_NAV_JS, null)
    }

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        super.onRenderProcessGone(view, detail)
        activity.loadConfiguredOrigin()
        return true
    }

    private fun applyLoadFailure(view: WebView, failingUrl: String?) {
        when (
            RemoteNavigationPolicy.onMainFrameFailure(
                activity.configuredOriginForNavigation(),
                failingUrl,
            )
        ) {
            RemoteNavigationPolicy.LoadFailureAction.ShowOffline -> activity.showOffline()
            RemoteNavigationPolicy.LoadFailureAction.RestorePrevious -> restorePreviousDocument(view)
        }
    }

    private fun restorePreviousDocument(view: WebView) {
        view.post {
            if (view.canGoBack()) view.goBack()
        }
    }

    companion object {
        /**
         * Android text-handle drags and HTML5 drops can navigate the WebView to
         * the dropped string. Consume them in-page as a second line of defense.
         */
        private const val PREVENT_TEXT_DROP_NAV_JS =
            "(function(){try{if(window.__ompguiDropGuard)return;window.__ompguiDropGuard=1;" +
                "var s=function(e){e.preventDefault();e.stopPropagation();};" +
                "document.addEventListener('dragstart',s,true);" +
                "document.addEventListener('dragover',s,true);" +
                "document.addEventListener('drop',s,true);}catch(e){}})()"
    }
}
