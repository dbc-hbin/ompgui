package com.dbchbin.ompgui.remote

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.nio.charset.StandardCharsets

/**
 * Converts an untrusted web snapshot into the small, display-only schema kept
 * in app-private preferences. Unknown fields are never copied.
 */
object SnapshotSanitizer {
    const val MAX_SNAPSHOT_BYTES = 64 * 1024
    const val MAX_MESSAGES = 50

    private const val MAX_ID_BYTES = 512
    private const val MAX_METADATA_BYTES = 512
    private const val MAX_MESSAGE_TEXT_BYTES = 1024
    private val safeRoles = setOf("user", "assistant", "system")

    /** Returns canonical safe JSON, or null when the record is invalid. */
    fun sanitize(input: String?, expectedOrigin: String?): String? {
        if (input == null || utf8Length(input) > MAX_SNAPSHOT_BYTES) return null
        return try {
            val source = JSONObject(input)
            val version = source.opt("version") as? Number
            if (version?.toInt() != 1) return null

            val origin = OriginValidator.normalize(stringValue(source, "origin"))
            if (origin == null || expectedOrigin != null && expectedOrigin != origin) return null
            val updatedAt = stringOrNumberValue(source, "updatedAt") ?: return null

            val sourceSession = source.optJSONObject("session") ?: return null
            val sessionId = boundedString(stringValue(sourceSession, "id"), MAX_ID_BYTES)
            if (sessionId.isNullOrEmpty()) return null

            val safeSession = JSONObject().apply {
                put("id", sessionId)
                putOptional(this, "title", boundedString(stringValue(sourceSession, "title"), MAX_METADATA_BYTES))
                putOptional(this, "cwd", boundedString(stringValue(sourceSession, "cwd"), MAX_METADATA_BYTES))
                putOptional(this, "leafId", boundedString(stringValue(sourceSession, "leafId"), MAX_ID_BYTES))
            }

            val safeMessages = JSONArray()
            sourceSession.optJSONArray("messages")?.let { sourceMessages ->
                val first = maxOf(0, sourceMessages.length() - MAX_MESSAGES)
                for (index in first until sourceMessages.length()) {
                    val sourceMessage = sourceMessages.optJSONObject(index) ?: continue
                    val role = stringValue(sourceMessage, "role") ?: continue
                    val text = stringValue(sourceMessage, "text") ?: continue
                    if (role !in safeRoles) continue
                    safeMessages.put(JSONObject().apply {
                        put("role", role)
                        put("text", boundedText(text, MAX_MESSAGE_TEXT_BYTES))
                    })
                }
            }
            safeSession.put("messages", safeMessages)

            val safeSnapshot = JSONObject().apply {
                put("version", 1)
                put("origin", origin)
                put("updatedAt", updatedAt)
                put("session", safeSession)
            }
            while (utf8Length(safeSnapshot.toString()) > MAX_SNAPSHOT_BYTES && safeMessages.length() > 0) {
                safeMessages.remove(0)
            }
            safeSnapshot.toString().takeIf { utf8Length(it) <= MAX_SNAPSHOT_BYTES }
        } catch (_: JSONException) {
            null
        } catch (_: RuntimeException) {
            null
        }
    }

    private fun putOptional(target: JSONObject, key: String, value: String?) {
        if (!value.isNullOrEmpty()) target.put(key, value)
    }

    private fun stringValue(source: JSONObject, key: String): String? = source.opt(key) as? String

    private fun stringOrNumberValue(source: JSONObject, key: String): String? = when (val value = source.opt(key)) {
        is String -> boundedString(value, MAX_METADATA_BYTES)
        is Number -> boundedString(value.toString(), MAX_METADATA_BYTES)
        else -> null
    }

    private fun boundedString(value: String?, maxBytes: Int): String? =
        value?.let { boundedText(it, maxBytes) }

    private fun boundedText(value: String, maxBytes: Int): String {
        val result = StringBuilder(value.length)
        var bytes = 0
        var offset = 0
        while (offset < value.length) {
            val codePoint = value.codePointAt(offset)
            offset += Character.charCount(codePoint)
            if (Character.isISOControl(codePoint) && codePoint != '\n'.code && codePoint != '\r'.code && codePoint != '\t'.code) {
                continue
            }
            val part = String(Character.toChars(codePoint))
            val partBytes = utf8Length(part)
            if (bytes + partBytes > maxBytes) break
            result.append(part)
            bytes += partBytes
        }
        return result.toString()
    }

    private fun utf8Length(value: String): Int = value.toByteArray(StandardCharsets.UTF_8).size
}
