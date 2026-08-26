package com.dbchbin.ompgui.remote

import android.content.Context
import android.content.SharedPreferences
import android.webkit.JavascriptInterface

/**
 * Narrow, display-only bridge exposed to the local bootstrap and remote UI.
 * Calls are additionally checked against the last top-level WebView URL so a
 * third-party iframe cannot read the local cache or change its origin.
 */
class RemoteReplicaBridge(context: Context, private val localOrigin: String) {
    private val preferences: SharedPreferences = context.applicationContext.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE,
    )

    @Volatile
    private var topLevelUrl: String? = null

    internal fun onTopLevelUrlChanged(url: String?) {
        topLevelUrl = url
    }

    @JavascriptInterface
    fun storeSnapshot(json: String) {
        val origin = configuredOrigin
        if (!isTopLevelAtOrigin(origin, topLevelUrl)) return
        val safeSnapshot = SnapshotSanitizer.sanitize(json, origin) ?: return
        preferences.edit().putString(SNAPSHOT_KEY, safeSnapshot).apply()
    }

    @JavascriptInterface
    fun getSnapshot(): String? = if (isLocalBootstrapTopLevel()) snapshotInternal else null

    @JavascriptInterface
    fun getOrigin(): String? = if (isLocalBootstrapTopLevel()) configuredOrigin else null

    @JavascriptInterface
    fun setOrigin(input: String): Boolean = isLocalBootstrapTopLevel() && setOriginInternal(input)

    /** Internal access for the activity; never exposed through JavaScript. */
    internal val configuredOrigin: String?
        get() = preferences.getString(ORIGIN_KEY, null)

    /** Internal access for the activity; never exposed through JavaScript. */
    internal val snapshotInternal: String?
        get() {
            val stored = preferences.getString(SNAPSHOT_KEY, null) ?: return null
            val origin = configuredOrigin ?: return null
            // Re-validate persisted data at the read boundary so an upgraded app
            // cannot render an older or manually modified record.
            return SnapshotSanitizer.sanitize(stored, origin)
        }

    /** Internal origin update used by tests/activity; JavaScript remains gated. */
    internal fun setOriginInternal(input: String): Boolean {
        val normalized = OriginValidator.normalize(input) ?: return false
        val previous = configuredOrigin
        preferences.edit().apply {
            putString(ORIGIN_KEY, normalized)
            if (normalized != previous) remove(SNAPSHOT_KEY)
            apply()
        }
        return true
    }

    private fun isLocalBootstrapTopLevel(): Boolean = isTopLevelAtOrigin(localOrigin, topLevelUrl)

    companion object {
        const val JAVASCRIPT_NAME = "OmpguiRemoteReplica"

        private const val PREFERENCES_NAME = "ompgui_remote_preferences"
        private const val ORIGIN_KEY = "origin"
        private const val SNAPSHOT_KEY = "snapshot"

        internal fun isTopLevelAtOrigin(expectedOrigin: String?, currentUrl: String?): Boolean {
            if (expectedOrigin == null || currentUrl == null) return false
            return expectedOrigin == OriginValidator.normalize(currentUrl)
        }
    }
}
