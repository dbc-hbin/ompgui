package com.dbchbin.ompgui.remote.relay

import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.Locale

data class PairingOffer(
    val url: String,
    val serverId: String,
    val secret: String,
)

private fun isSafeToken(value: String, max: Int): Boolean =
    value.isNotEmpty() && value.length <= max && value.matches(Regex("^[A-Za-z0-9._~-]+$"))

/** Parse `ompgui://pair#v=1&url=...&sid=...&secret=...` (fragment, not query). */
fun parsePairingUri(input: String): PairingOffer? {
    val trimmed = input.trim()
    if (trimmed.isEmpty() || trimmed.length > 2048) return null
    val uri = try {
        URI(trimmed)
    } catch (_: Exception) {
        return null
    }
    if (uri.scheme?.lowercase(Locale.ROOT) != "ompgui") return null
    val host = uri.host ?: uri.authority
    if (host != "pair") return null
    val fragment = uri.fragment ?: return null
    if (fragment.isEmpty()) return null
    val params = parseQuery(fragment)
    if (params["v"] != "1") return null
    val relayUrl = params["url"]?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val serverId = params["sid"]?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val secret = params["secret"]?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    if (!isSafeToken(serverId, 64) || !isSafeToken(secret, 128)) return null
    val normalized = normalizeRelayUrl(relayUrl) ?: return null
    return PairingOffer(url = normalized, serverId = serverId, secret = secret)
}

private fun parseQuery(raw: String): Map<String, String> {
    val out = LinkedHashMap<String, String>()
    for (part in raw.split('&')) {
        if (part.isEmpty()) continue
        val eq = part.indexOf('=')
        val key = if (eq < 0) decode(part) else decode(part.substring(0, eq))
        val value = if (eq < 0) "" else decode(part.substring(eq + 1))
        if (key.isNotEmpty() && key !in out) out[key] = value
    }
    return out
}

private fun decode(value: String): String = try {
    URLDecoder.decode(value, StandardCharsets.UTF_8.name())
} catch (_: Exception) {
    value
}
