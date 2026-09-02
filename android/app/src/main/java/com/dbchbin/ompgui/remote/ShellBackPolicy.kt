package com.dbchbin.ompgui.remote

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
        if (previousUrl != null && isLocalFallbackOverRemote(currentUrl, previousUrl, configuredOrigin, localOrigin)) {
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
        if (currentUrl == null || previousUrl == null) return false
        val currentLocal = OriginValidator.isAllowedNavigation(localOrigin, currentUrl)
        val previousLocal = OriginValidator.isAllowedNavigation(localOrigin, previousUrl)
        if (currentLocal && previousLocal) return true
        val currentRemote = OriginValidator.isAllowedNavigation(configuredOrigin, currentUrl)
        val previousRemote = OriginValidator.isAllowedNavigation(configuredOrigin, previousUrl)
        return currentRemote && previousRemote
    }

    internal fun isLocalFallbackOverRemote(
        currentUrl: String?,
        previousUrl: String?,
        configuredOrigin: String?,
        localOrigin: String,
    ): Boolean {
        return OriginValidator.isAllowedNavigation(localOrigin, currentUrl) &&
            OriginValidator.isAllowedNavigation(configuredOrigin, previousUrl)
    }
}
