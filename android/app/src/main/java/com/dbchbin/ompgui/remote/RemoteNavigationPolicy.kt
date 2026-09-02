package com.dbchbin.ompgui.remote

import java.net.URI
import java.net.URISyntaxException

/**
 * Decides whether a main-frame load may stay in the WebView and what to do
 * when it is blocked or fails. Accidental text-handle drags become same-origin
 * paths or off-origin FixupURLs; those must restore the previous document
 * instead of leaving a blank view over the launch splash.
 */
internal object RemoteNavigationPolicy {
    enum class LoadFailureAction {
        ShowOffline,
        RestorePrevious,
    }

    fun isPermittedDocument(
        localOrigin: String?,
        configuredOrigin: String?,
        targetUrl: String?,
    ): Boolean {
        if (targetUrl == null) return false
        return OriginValidator.isAllowedNavigation(localOrigin, targetUrl) ||
            OriginValidator.isAllowedNavigation(configuredOrigin, targetUrl)
    }

    fun onDisallowedDocumentStarted(): LoadFailureAction = LoadFailureAction.RestorePrevious

    fun onMainFrameFailure(configuredOrigin: String?, failingUrl: String?): LoadFailureAction {
        if (failingUrl == null || !OriginValidator.isAllowedNavigation(configuredOrigin, failingUrl)) {
            return LoadFailureAction.RestorePrevious
        }
        return if (isRemoteEntryPath(failingUrl)) {
            LoadFailureAction.ShowOffline
        } else {
            LoadFailureAction.RestorePrevious
        }
    }

    internal fun isRemoteEntryPath(url: String): Boolean {
        val uri = try {
            URI(url)
        } catch (_: URISyntaxException) {
            return false
        }
        if (uri.isOpaque) return false
        val path = uri.path?.trimEnd('/').orEmpty()
        return path.isEmpty() || path == "/index.html"
    }
}
