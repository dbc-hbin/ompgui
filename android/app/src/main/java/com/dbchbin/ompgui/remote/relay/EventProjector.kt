package com.dbchbin.ompgui.remote.relay

import org.json.JSONObject

object EventProjector {
    const val MAX_TEXT_CHARS = 4_000
    const val FULL_TEXT_THRESHOLD = 4_000
    const val INLINE_ATTACHMENT_LIMIT_BYTES = 128 * 1024

    /** Transient banner surfaced from `notice` / `prompt_error` / `command_output` events. */
    data class ChatNotice(
        val id: String,
        val message: String,
        val type: String,
    )

    /**
     * Native projection of streamed `extension_ui_request` frames.
     * Same supported desktop semantics as `handleExtensionUiRequest` in
     * `hooks/useAgentSession.ts`: select/confirm/input/editor surface a blocking
     * dialog; cancel dismisses it; open_url/notify become notices (never silently
     * dropped); setStatus/setWidget/setTitle/set_editor_text/custom update inline
     * state instead of a dialog.
     */
    sealed interface ChatExtensionRequest {
        val id: String
        val title: String

        data class Select(
            override val id: String,
            override val title: String,
            val options: List<String>,
            val optionDescriptions: List<String?> = emptyList(),
        ) : ChatExtensionRequest

        data class Confirm(
            override val id: String,
            override val title: String,
            val message: String,
        ) : ChatExtensionRequest

        data class Input(
            override val id: String,
            override val title: String,
            val placeholder: String?,
        ) : ChatExtensionRequest

        data class Editor(
            override val id: String,
            override val title: String,
            val prefill: String?,
        ) : ChatExtensionRequest
    }

    data class ExtensionSideEffect(
        val notice: ChatNotice? = null,
        val openUrl: String? = null,
        val clearDialogId: String? = null,
    )

    fun isQuotaLikeError(text: String): Boolean {
        return text.contains("429") ||
            text.contains("quota", ignoreCase = true) ||
            text.contains("RESOURCE_EXHAUSTED") ||
            text.contains("Cloud Code Assist", ignoreCase = true)
    }

    fun isSafeOpenUrl(raw: String?): Boolean {
        if (raw.isNullOrBlank()) return false
        val url = raw.trim()
        if (url.startsWith("//")) return false
        val lower = url.lowercase()
        if (lower.startsWith("javascript:") || lower.startsWith("data:") ||
            lower.startsWith("vbscript:") || lower.startsWith("file:")
        ) {
            return false
        }
        return lower.startsWith("http://") || lower.startsWith("https://") ||
            lower.startsWith("mailto:")
    }

    /** Commands with no omp RPC equivalent: surface server errors, never fake. */
    fun isKnownUnsupportedCommand(type: String): Boolean {
        return type == "navigate_tree" || type == "clear_queue" ||
            type == "get_tools" || type == "set_tools" ||
            type == "extension_ui_input"
    }

    fun isBashExcludeError(code: String?, message: String?): Boolean {
        if (code == "bash_exclude_unsupported") return true
        return message?.contains("!!") == true && message.contains("excluded", ignoreCase = true)
    }

    /** Long assistant text stays fully accessible via bounded fetch/paging; never silently cut. */
    fun needsFullText(text: String): Boolean = text.length > FULL_TEXT_THRESHOLD

    fun previewText(text: String): String {
        if (text.length <= FULL_TEXT_THRESHOLD) return text
        val boundary = text.lastIndexOfAny(charArrayOf(' ', '\n', '\t'), FULL_TEXT_THRESHOLD)
        return text.substring(0, if (boundary > 0) boundary else FULL_TEXT_THRESHOLD).trimEnd() + "…"
    }

    /**
     * Attachments over 128KiB must reject/warn, not prefix-as-complete.
     * Returns null when inline is fine, otherwise a human-readable warning.
     */
    fun inlineAttachmentWarning(name: String, sizeBytes: Long, isText: Boolean): String? {
        if (!isText) return null
        if (sizeBytes <= 0) return null
        if (sizeBytes <= INLINE_ATTACHMENT_LIMIT_BYTES) return null
        return "$name is larger than 128 KB and was not inlined. Upload it via Files instead of pasting the full content."
    }

    // -----------------------------------------------------------------------
    // Streamed extension_ui_request projection (desktop parity).
    // -----------------------------------------------------------------------

    fun acceptsSessionEvent(
        eventSessionId: String, openedSessionId: String?, awaitingSnapshot: Boolean,
        historicalView: Boolean, payload: JSONObject,
    ): Boolean {
        if (eventSessionId != openedSessionId || historicalView) return false
        if (!awaitingSnapshot) return true
        val type = payload.optString("type")
        return type == "extension_ui_request" || type == "extension_ui_pending"
    }

    fun applyExtensionDialogs(current: List<ChatExtensionRequest>, payload: JSONObject): List<ChatExtensionRequest> {
        if (payload.optString("type") == "extension_ui_pending") {
            val ids = payload.optJSONArray("ids") ?: return current
            val pending = (0 until ids.length()).mapNotNull { ids.opt(it) as? String }.toSet()
            return current.filter { it.id in pending }
        }
        if (payload.optString("type") == "extension_ui_request" && payload.optString("method") == "cancel") {
            val target = payload.optString("targetId")
            return current.filterNot { it.id == target }
        }
        val dialog = parseExtensionDialog(payload) ?: return current
        return if (current.any { it.id == dialog.id }) {
            current.map { if (it.id == dialog.id) dialog else it }
        } else current + dialog
    }

    /** Parse a blocking dialog request (select/confirm/input/editor). Null for other methods. */
    fun parseExtensionDialog(payload: JSONObject): ChatExtensionRequest? {
        if (payload.optString("type") != "extension_ui_request") return null
        val id = payload.optString("id").trim()
        if (id.isEmpty()) return null
        return when (payload.optString("method")) {
            "select" -> {
                val title = payload.optString("title").trim().ifEmpty { return null }
                val arr = payload.optJSONArray("options") ?: return null
                val options = ArrayList<String>(arr.length())
                val descriptions = ArrayList<String?>(arr.length())
                val details = payload.optJSONArray("optionDetails")
                for (i in 0 until arr.length()) {
                    // RPC responses must echo the original label, including native ask's
                    // recommendation suffix and multi-select checkmark prefix.
                    val option = arr.opt(i) as? String ?: return null
                    if (option.isBlank()) return null
                    options.add(option)
                    descriptions.add((details?.optJSONObject(i)?.opt("description") as? String)?.takeIf { it.isNotBlank() })
                }
                if (options.isEmpty()) return null
                ChatExtensionRequest.Select(id = id, title = title, options = options, optionDescriptions = descriptions)
            }
            "confirm" -> {
                val title = payload.optString("title").trim().ifEmpty { return null }
                val message = payload.optString("message")
                ChatExtensionRequest.Confirm(id = id, title = title, message = message)
            }
            "input" -> {
                val title = payload.optString("title").trim().ifEmpty { return null }
                val placeholder = payload.optString("placeholder").trim().takeIf { it.isNotEmpty() }
                ChatExtensionRequest.Input(id = id, title = title, placeholder = placeholder)
            }
            "editor" -> {
                val title = payload.optString("title").trim().ifEmpty { return null }
                val prefill = if (payload.has("prefill") && !payload.isNull("prefill")) {
                    payload.optString("prefill")
                } else {
                    null
                }
                ChatExtensionRequest.Editor(id = id, title = title, prefill = prefill)
            }
            else -> null
        }
    }

    /**
     * Parse non-dialog side effects. Never silently drops approvals: dialog
     * methods return null here so callers keep showing the dialog; cancel,
     * open_url and notify project to effects the UI must surface.
     */
    fun parseExtensionSideEffect(payload: JSONObject, nowMs: Long = System.currentTimeMillis()): ExtensionSideEffect? {
        if (payload.optString("type") != "extension_ui_request") return null
        return when (payload.optString("method")) {
            "cancel" -> {
                val target = payload.optString("targetId").trim().ifEmpty { return null }
                ExtensionSideEffect(clearDialogId = target)
            }
            "open_url" -> {
                val raw = payload.optString("launchUrl").trim().takeIf { it.isNotEmpty() }
                    ?: payload.optString("url").trim().takeIf { it.isNotEmpty() }
                    ?: return ExtensionSideEffect(
                        notice = ChatNotice(
                            id = payload.optString("id").trim().ifEmpty { "open-url-$nowMs" },
                            message = "Blocked an unsafe URL from the agent.",
                            type = "warning",
                        ),
                    )
                if (!isSafeOpenUrl(raw)) {
                    return ExtensionSideEffect(
                        notice = ChatNotice(
                            id = payload.optString("id").trim().ifEmpty { "open-url-$nowMs" },
                            message = "Blocked an unsafe URL from the agent.",
                            type = "warning",
                        ),
                    )
                }
                val instructions = payload.optString("instructions").trim()
                val message = if (instructions.isNotEmpty()) "$instructions\n$raw" else "Open in browser:\n$raw"
                ExtensionSideEffect(
                    notice = ChatNotice(
                        id = payload.optString("id").trim().ifEmpty { "open-url-$nowMs" },
                        message = message,
                        type = "info",
                    ),
                    openUrl = raw,
                )
            }
            "notify" -> {
                val message = payload.optString("message").trim().ifEmpty { return null }
                val kind = when (payload.optString("notifyType").trim().lowercase()) {
                    "error" -> "error"
                    "warning" -> "warning"
                    else -> "info"
                }
                ExtensionSideEffect(
                    notice = ChatNotice(
                        id = payload.optString("id").trim().ifEmpty { "notify-$nowMs" },
                        message = message,
                        type = kind,
                    ),
                )
            }
            // Dialog methods are handled by parseExtensionDialog; inline state
            // methods (setStatus/setWidget/setTitle/set_editor_text/custom) are
            // surfaced by dedicated parsers below, not dropped.
            else -> null
        }
    }

    /** Inline extension status update (setStatus). Null when absent. */
    fun parseExtensionStatus(payload: JSONObject): Pair<String, String?>? {
        if (payload.optString("type") != "extension_ui_request") return null
        if (payload.optString("method") != "setStatus") return null
        val key = payload.optString("statusKey").trim().ifEmpty { return null }
        val text = if (payload.has("statusText") && !payload.isNull("statusText")) {
            payload.optString("statusText")
        } else {
            null
        }
        return key to text
    }

    /** Inline extension widget update (setWidget). Null when absent. */
    fun parseExtensionWidget(payload: JSONObject): Triple<String, List<String>?, String>? {
        if (payload.optString("type") != "extension_ui_request") return null
        if (payload.optString("method") != "setWidget") return null
        val key = payload.optString("widgetKey").trim().ifEmpty { return null }
        val lines = payload.optJSONArray("widgetLines")?.let { arr ->
            ArrayList<String>(arr.length()).also { out ->
                for (i in 0 until arr.length()) out.add(arr.optString(i))
            }
        }
        val placement = payload.optString("widgetPlacement").trim().takeIf { it.isNotEmpty() } ?: "aboveEditor"
        return Triple(key, lines, placement)
    }

    /** Editor-text insertion (set_editor_text): text the agent wants in the composer. */
    fun parseEditorTextInsert(payload: JSONObject): String? {
        if (payload.optString("type") != "extension_ui_request") return null
        if (payload.optString("method") != "set_editor_text") return null
        return payload.optString("text").takeIf { it.isNotEmpty() }
    }

    /** Title update (setTitle). Null when absent. */
    fun parseExtensionTitle(payload: JSONObject): String? {
        if (payload.optString("type") != "extension_ui_request") return null
        if (payload.optString("method") != "setTitle") return null
        return payload.optString("title").trim().takeIf { it.isNotEmpty() }
    }

    // -----------------------------------------------------------------------
    // Notices / errors (desktop parity: notice, prompt_error, command_output).
    // -----------------------------------------------------------------------

    /** Project a streamed event to a transient banner. Null for non-notice events. */
    fun parseNotice(payload: JSONObject, nowMs: Long = System.currentTimeMillis()): ChatNotice? {
        return when (payload.optString("type")) {
            "notice" -> {
                val message = payload.optString("message").trim().ifEmpty { return null }
                val level = payload.optString("level").trim().lowercase()
                val kind = when (level) {
                    "error" -> "error"
                    "warning" -> "warning"
                    "success" -> "success"
                    else -> "info"
                }
                ChatNotice(
                    id = "notice-$nowMs-${message.hashCode()}",
                    message = message,
                    type = if (isQuotaLikeError(message)) "error" else kind,
                )
            }
            "prompt_error" -> {
                val message = payload.optString("errorMessage").trim()
                    .ifEmpty { payload.optString("message").trim() }
                    .ifEmpty { return null }
                ChatNotice(id = "prompt-error-$nowMs", message = message, type = "error")
            }
            "command_output" -> {
                val text = payload.optString("text").trim().ifEmpty { return null }
                ChatNotice(id = "cmd-out-$nowMs-${text.hashCode()}", message = text, type = "info")
            }
            else -> null
        }
    }

    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // Scroll / history helpers.
    // -----------------------------------------------------------------------

    /** Autofollow only when the user has not scrolled up (desktop parity). */
    fun shouldAutoFollow(canScrollForward: Boolean, userScrolledUp: Boolean): Boolean {
        if (userScrolledUp) return false
        return !canScrollForward
    }

    /** True when viewing a historical leaf instead of the live head. */
    fun isHistoricalLeaf(viewedLeafId: String?, liveLeafId: String?): Boolean {
        if (viewedLeafId.isNullOrBlank()) return false
        if (liveLeafId.isNullOrBlank()) return false
        return viewedLeafId != liveLeafId
    }

    fun applyMessages(current: List<DisplayMessage>, payload: JSONObject): List<DisplayMessage> {
        val type = payload.optString("type")
        if (type.startsWith("tool_execution_")) {
            if (type != "tool_execution_start" && type != "tool_execution_update" && type != "tool_execution_end") return current
            val id = payload.optString("toolCallId").takeIf { it.isNotBlank() } ?: return current
            val existingIndex = current.indexOfLast { it.role == "toolResult" && it.toolCallId == id }
            val existing = current.getOrNull(existingIndex)
            // Late progress must not turn an already completed result back into pending.
            if (existing != null && !existing.streaming && (type != "tool_execution_end" || existing.entryId != null)) return current
            val result = payload.optJSONObject("result") ?: payload.optJSONObject("partialResult")
            val contentPending = payload.optBoolean("contentPending") || result?.optBoolean("contentPending") == true
            val wire = JSONObject(result?.toString() ?: "{}").apply {
                put("role", "toolResult")
                put("toolCallId", id)
                put("toolName", payload.optString("toolName").ifEmpty { existing?.toolName.orEmpty() })
                if (payload.has("isError")) put("isError", payload.optBoolean("isError"))
                if (payload.has("entryId")) put("entryId", payload.optString("entryId"))
            }
            val parsed = parseDisplayMessage(wire, type != "tool_execution_end" || contentPending) ?: return current
            val projected = parsed.copy(
                entryId = parsed.entryId ?: existing?.entryId,
                text = if (result == null) existing?.text.orEmpty() else parsed.text,
                content = if (result == null) existing?.content else parsed.content,
                details = parsed.details ?: existing?.details,
                deferredImages = parsed.deferredImages ?: existing?.deferredImages,
                truncated = parsed.truncated || (result == null && existing?.truncated == true),
                isError = parsed.isError || (result == null && existing?.isError == true),
            )
            var messages = if (existingIndex < 0) current + projected else current.toMutableList().also { it[existingIndex] = projected }
            // A call can begin before the assistant's complete content frame arrives.
            val hasCall = messages.any { message ->
                val blocks = message.content
                blocks != null && (0 until blocks.length()).any { blocks.optJSONObject(it)?.optString("toolCallId") == id }
            }
            if (!hasCall && type == "tool_execution_start") {
                val call = JSONObject().put("type", "toolCall").put("toolCallId", id)
                    .put("toolName", payload.optString("toolName"))
                    .put("input", payload.opt("args") ?: payload.opt("arguments") ?: JSONObject())
                messages = messages.toMutableList().also {
                    val resultIndex = it.indexOfFirst { row -> row.role == "toolResult" && row.toolCallId == id }
                    it.add(resultIndex, DisplayMessage("assistant", "", content = org.json.JSONArray().put(call), entryId = "tool-call:$id"))
                }
            }
            return messages
        }
        if (type != "message_start" && type != "message_update" && type != "message_end") return current
        val message = payload.optJSONObject("message") ?: return current
        if (message.optString("role") == "user" && type != "message_end") return current
        val parsed = parseDisplayMessage(message, type != "message_end") ?: return current
        val incoming = parsed.copy(entryId = (payload.opt("entryId") as? String)?.takeIf { it.isNotBlank() } ?: parsed.entryId)
        // Replace provisional call-only rows once the real assistant message carries them.
        val callIds = buildSet {
            incoming.content?.let { blocks -> for (i in 0 until blocks.length()) {
                val block = blocks.optJSONObject(i) ?: continue
                if (block.optString("type") == "toolCall") add(block.optString("toolCallId"))
            } }
        }
        val messages = current.filterNot { it.entryId?.startsWith("tool-call:") == true && it.entryId.removePrefix("tool-call:") in callIds }
        val index = when {
            incoming.role == "toolResult" && incoming.toolCallId != null -> messages.indexOfLast { it.role == "toolResult" && it.toolCallId == incoming.toolCallId }
            incoming.entryId != null -> messages.indexOfLast { it.entryId == incoming.entryId }.takeIf { it >= 0 }
                ?: messages.indexOfLast { it.streaming && it.role == incoming.role }
            incoming.role == "user" -> -1
            else -> messages.indexOfLast { it.streaming && it.role == incoming.role }
        }
        if (index < 0) {
            if (incoming.role != "user" && incoming.entryId == null && messages.lastOrNull()?.let { it.role == incoming.role && it.text == incoming.text && it.content?.toString() == incoming.content?.toString() } == true) return messages
            return messages + incoming
        }
        val previous = messages[index]
        val replacement = incoming.copy(
            entryId = incoming.entryId ?: previous.entryId,
            // An empty terminal envelope must not erase accumulated output/images.
            text = incoming.text.ifEmpty { previous.text },
            content = incoming.content?.takeIf { it.length() > 0 } ?: previous.content,
            details = incoming.details ?: previous.details,
            toolName = incoming.toolName ?: previous.toolName,
            isError = incoming.isError || previous.isError,
            deferredImages = incoming.deferredImages ?: previous.deferredImages,
            truncated = incoming.truncated || (incoming.text.isEmpty() && incoming.content == null && previous.truncated),
        )
        return messages.toMutableList().also { it[index] = replacement }
    }

    /**
     * Live todo phase label for the composer header (desktop phaseLabel parity):
     * running tool names (max 3, then "+N more"), waiting-model, running-command,
     * otherwise thinking. Null payload knowledge yields a thinking label.
     */
    fun phaseLabel(toolNames: List<String>, waitingModel: Boolean, runningCommand: Boolean): String {
        if (runningCommand) return "Running command…"
        if (waitingModel) return "Waiting for model…"
        if (toolNames.isEmpty()) return "Thinking…"
        if (toolNames.size <= 3) return "Running ${toolNames.joinToString(", ")}…"
        return "Running ${toolNames.take(2).joinToString(", ")} +${toolNames.size - 2} more…"
    }

    fun parsePhaseTools(payload: JSONObject): List<String> {
        if (payload.optString("type") != "tool_execution_start") return emptyList()
        val name = payload.optString("toolName").trim()
        return if (name.isNotEmpty()) listOf(name) else emptyList()
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

    /**
     * Apply live subagent hub frames onto the chip roster. Returns null when
     * the payload is not a subagent roster event.
     */
    fun applySubagentEvent(current: List<SubagentChip>, payload: JSONObject): List<SubagentChip>? {
        return when (payload.optString("type")) {
            "subagent_lifecycle" -> {
                val id = payload.optString("id").trim()
                val status = subagentStatus(payload) ?: return current
                if (id.isEmpty()) return current
                upsertSubagentChip(
                    current,
                    SubagentChip(
                        id = id,
                        agent = payload.optString("agent").trim().ifEmpty { "subagent" },
                        status = status,
                        task = payload.optString("description").trim()
                            .ifEmpty { payload.optString("task").trim() },
                        live = !isSubagentTerminal(status),
                    ),
                )
            }
            "subagent_progress" -> {
                val progress = payload.optJSONObject("progress") ?: payload
                val id = progress.optString("id").trim()
                    .ifEmpty { payload.optString("id").trim() }
                if (id.isEmpty()) return current
                val existing = current.find { it.id == id }
                val progressStatus = subagentStatus(progress)
                val envelopeStatus = subagentStatus(payload)
                val status = when {
                    progressStatus != null && isSubagentTerminal(progressStatus) -> progressStatus
                    envelopeStatus != null && isSubagentTerminal(envelopeStatus) -> envelopeStatus
                    existing != null && isSubagentTerminal(existing.status) -> existing.status
                    else -> progressStatus ?: envelopeStatus ?: "running"
                }
                upsertSubagentChip(
                    current,
                    SubagentChip(
                        id = id,
                        agent = progress.optString("agent").trim()
                            .ifEmpty { payload.optString("agent").trim() }
                            .ifEmpty { current.find { it.id == id }?.agent ?: "task" },
                        status = status,
                        task = progress.optString("task").trim()
                            .ifEmpty { progress.optString("description").trim() }
                            .ifEmpty { payload.optString("task").trim() }
                            .ifEmpty { current.find { it.id == id }?.task.orEmpty() },
                        live = !isSubagentTerminal(status),
                    ),
                )
            }
            else -> null
        }
    }

    private fun upsertSubagentChip(current: List<SubagentChip>, chip: SubagentChip): List<SubagentChip> {
        val index = current.indexOfFirst { it.id == chip.id }
        if (index < 0) return current + chip
        return current.toMutableList().also { it[index] = chip }
    }

}
