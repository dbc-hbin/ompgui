package com.dbchbin.ompgui.remote.relay

import org.json.JSONObject

object EventProjector {
    const val MAX_TEXT_CHARS = 4_000

    fun applyMessages(current: List<DisplayMessage>, payload: JSONObject): List<DisplayMessage> {
        return when (payload.optString("type")) {
            "message_start", "message_update" -> {
                val message = payload.optJSONObject("message") ?: return current
                val role = message.optString("role")
                if (role != "assistant" && role != "custom") return current
                val text = extractText(message).take(MAX_TEXT_CHARS)
                upsertStreaming(current, role, text)
            }
            "message_end" -> {
                val message = payload.optJSONObject("message")
                val role = message?.optString("role")
                val text = message?.let(::extractText)?.take(MAX_TEXT_CHARS)
                freezeStreaming(
                    current,
                    if (role == "assistant" || role == "custom") role else null,
                    text,
                )
            }
            else -> current
        }
    }

    fun applyRunning(current: Boolean, payload: JSONObject): Boolean {
        return when (payload.optString("type")) {
            "agent_start" -> true
            "session_closed" -> false
            "agent_end" -> if (payload.opt("isTerminal") == false) current else false
            else -> current
        }
    }

    /**
     * True when this event payload ends the agent turn for notification
     * purposes: a terminal `agent_end` (any payload where `isTerminal` is not
     * explicitly false) or `session_closed`. `previousRunning` guards against
     * notifying for duplicate/late terminal events when nothing was running.
     */
    fun isTerminalStop(previousRunning: Boolean, payload: JSONObject): Boolean {
        if (!previousRunning) return false
        return when (payload.optString("type")) {
            "session_closed" -> true
            "agent_end" -> payload.opt("isTerminal") != false
            else -> false
        }
    }

    private fun extractText(message: JSONObject): String {
        if (message.has("text") && !message.isNull("text")) {
            return message.optString("text")
        }
        val content = message.optJSONArray("content") ?: return ""
        val builder = StringBuilder()
        for (i in 0 until content.length()) {
            val block = content.optJSONObject(i) ?: continue
            if (block.optString("type") == "text") {
                builder.append(block.optString("text"))
            }
        }
        return builder.toString()
    }

    private fun upsertStreaming(
        current: List<DisplayMessage>,
        role: String,
        text: String,
    ): List<DisplayMessage> {
        if (current.isNotEmpty()) {
            val last = current.last()
            if (last.streaming && (last.role == "assistant" || last.role == "custom")) {
                return current.dropLast(1) + last.copy(role = role, text = text, streaming = true)
            }
        }
        return current + DisplayMessage(role = role, text = text, streaming = true)
    }

    private fun freezeStreaming(
        current: List<DisplayMessage>,
        role: String?,
        text: String?,
    ): List<DisplayMessage> {
        if (current.isEmpty()) {
            return if (!role.isNullOrEmpty() && !text.isNullOrEmpty()) {
                listOf(DisplayMessage(role = role, text = text, streaming = false))
            } else {
                current
            }
        }
        val last = current.last()
        if (!last.streaming) return current
        val frozenRole = role ?: last.role
        val frozenText = if (!text.isNullOrEmpty()) text else last.text
        return current.dropLast(1) + last.copy(role = frozenRole, text = frozenText, streaming = false)
    }
}
