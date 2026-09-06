package com.dbchbin.ompgui.remote.relay

import java.net.URI
import java.util.Locale

private val LOOPBACK_HOSTS = setOf("127.0.0.1", "localhost", "::1", "[::1]")

fun isLoopbackHost(hostname: String): Boolean {
    val host = hostname.trim().lowercase(Locale.ROOT).removePrefix("[").removeSuffix("]")
    if (host in LOOPBACK_HOSTS || hostname.trim().lowercase(Locale.ROOT) in LOOPBACK_HOSTS) return true
    if (host.startsWith("127.") && host.split('.').size == 4) {
        return host.split('.').all { part -> part.toIntOrNull() != null }
    }
    return host == "0:0:0:0:0:0:0:1"
}

/**
 * Normalize a user-supplied relay URL to `wss://host/relay` (or `ws://` on
 * loopback). Credentials, extra paths, and query strings are rejected.
 */
fun normalizeRelayUrl(input: String): String? {
    val trimmed = input.trim()
    if (trimmed.isEmpty() || trimmed.length > 512 || '\\' in trimmed) return null
    if (trimmed.any(Char::isISOControl)) return null
    var candidate = trimmed
    if (!candidate.contains("://")) candidate = "wss://$candidate"

    val uri = try {
        URI(candidate)
    } catch (_: Exception) {
        return null
    }
    if (!uri.isAbsolute || uri.isOpaque) return null
    if (!uri.rawUserInfo.isNullOrEmpty()) return null

    val scheme = when (uri.scheme?.lowercase(Locale.ROOT)) {
        "https" -> "wss"
        "http" -> "ws"
        "wss" -> "wss"
        "ws" -> "ws"
        else -> return null
    }
    var host = uri.host?.lowercase(Locale.ROOT)?.takeIf { it.isNotEmpty() } ?: return null
    if (scheme == "ws" && !isLoopbackHost(host)) return null

    val path = when (val raw = uri.rawPath.orEmpty()) {
        "", "/" -> "/relay"
        else -> raw
    }
    if (path != "/relay") return null
    if (!uri.rawQuery.isNullOrEmpty()) return null
    if (!uri.fragment.isNullOrEmpty()) return null

    if (':' in host && !host.startsWith("[")) host = "[$host]"
    val port = uri.port
    if (port < -1 || port > 65535) return null
    val portPart = if (port >= 0) ":$port" else ""
    return "$scheme://$host$portPart/relay"
}
