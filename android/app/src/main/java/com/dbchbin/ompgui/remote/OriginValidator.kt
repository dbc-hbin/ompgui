package com.dbchbin.ompgui.remote

import android.net.Uri
import java.net.URI
import java.net.URISyntaxException
import java.util.Locale

/** Validates and normalizes the user-controlled server origin. */
object OriginValidator {
    /**
     * Normalizes an origin to scheme://host[:port]. Paths, queries, and fragments
     * are intentionally discarded. HTTPS is mandatory except for loopback HTTP.
     */
    fun normalize(input: String?): String? {
        var candidate = input?.trim() ?: return null
        if (candidate.isEmpty() || candidate.any(Character::isISOControl)) return null
        if (!candidate.contains("://")) candidate = "https://$candidate"

        val uri = try {
            URI(candidate)
        } catch (_: URISyntaxException) {
            return null
        }
        if (!uri.isAbsolute || uri.isOpaque || uri.rawUserInfo != null) return null

        val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return null
        var host = uri.host?.lowercase(Locale.ROOT)?.takeIf(String::isNotEmpty) ?: return null
        if (host.length > 2 && host.first() == '[' && host.last() == ']') {
            host = host.substring(1, host.length - 1)
        }

        val secure = scheme == "https"
        val loopbackHttp = scheme == "http" && isLoopbackHost(host)
        if (!secure && !loopbackHttp) return null

        var port = uri.port
        if (port < -1 || port > 65535) return null
        val authority = uri.rawAuthority
        if (authority.isNullOrEmpty() || authority.endsWith(':')) return null
        if (':' in host) host = "[$host]"

        if ((secure && port == 443) || (loopbackHttp && port == 80)) port = -1
        return "$scheme://$host${if (port >= 0) ":$port" else ""}"
    }

    fun isAllowedNavigation(configuredOrigin: String?, target: Uri?): Boolean =
        configuredOrigin != null && target != null && configuredOrigin == normalize(target.toString())

    fun isLoopbackHost(host: String?): Boolean = when (host?.lowercase(Locale.ROOT)) {
        "localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1" -> true
        else -> false
    }
}
