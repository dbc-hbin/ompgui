package com.dbchbin.ompgui.remote

import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
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
        if (activity.isLocalUrl(target) || activity.isConfiguredUrl(target)) return false

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
        if (request.isForMainFrame && activity.isConfiguredUrl(request.url)) activity.showOffline()
    }

    override fun onReceivedHttpError(
        view: WebView,
        request: WebResourceRequest,
        errorResponse: WebResourceResponse,
    ) {
        super.onReceivedHttpError(view, request, errorResponse)
        if (request.isForMainFrame && activity.isConfiguredUrl(request.url)) activity.showOffline()
    }

    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError?) {
        handler.cancel()
        val failingUrl = error?.url ?: return
        if (activity.isConfiguredUrl(Uri.parse(failingUrl))) activity.showOffline()
    }

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
        activity.onTopLevelUrlChanged(url)
        val target = Uri.parse(url)
        if (!activity.isLocalUrl(target) && !activity.isConfiguredUrl(target)) {
            view.stopLoading()
            handleNavigation(target)
            return
        }
        bridge.reset()
    }
}
