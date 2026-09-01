package com.dbchbin.ompgui.remote

import android.net.Uri

/**
 * Ordered Android back handling: web UI overlays, then in-surface WebView
 * history, then confirm/exit only at the shell boundary.
 */
object ShellBackPolicy {
    enum class Action {
        ConsumedByWebUi,
        WebHistoryBack,
        ConfirmExit,
    }

    fun decide(
        webUiConsumed: Boolean,
        currentUrl: String?,
        previousUrl: String?,
        configuredOrigin: String?,
        localOrigin: String,
    ): Action {
        if (webUiConsumed) return Action.ConsumedByWebUi
        if (previousUrl != null && staysOnSameSurface(currentUrl, previousUrl, configuredOrigin, localOrigin)) {
            return Action.WebHistoryBack
        }
        return Action.ConfirmExit
    }

    fun isJsTrue(result: String?): Boolean =
        result == "true" || result == "\"true\""

    internal fun staysOnSameSurface(
        currentUrl: String?,
        previousUrl: String?,
        configuredOrigin: String?,
        localOrigin: String,
    ): Boolean {
        val current = currentUrl?.let(Uri::parse) ?: return false
        val previous = Uri.parse(previousUrl)
        val currentLocal = OriginValidator.isAllowedNavigation(localOrigin, current)
        val previousLocal = OriginValidator.isAllowedNavigation(localOrigin, previous)
        if (currentLocal && previousLocal) return true
        val currentRemote = OriginValidator.isAllowedNavigation(configuredOrigin, current)
        val previousRemote = OriginValidator.isAllowedNavigation(configuredOrigin, previous)
        return currentRemote && previousRemote
    }
}
