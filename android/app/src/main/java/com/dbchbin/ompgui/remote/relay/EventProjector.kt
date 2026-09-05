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

    /** Client-side mirror of queued steering/follow-up texts (server reports count only). */
    data class ChatQueue(
        val steering: List<String> = emptyList(),
        val followUp: List<String> = emptyList(),
    ) {
        fun isEmpty(): Boolean = steering.isEmpty() && followUp.isEmpty()
        fun size(): Int = steering.size + followUp.size
    }

    /**
     * Native projection of streamed `extension_ui_request` frames.
     * Same supported desktop semantics as `handleExtensionUiRequest` in
     * `hooks/useAgentSession.ts`: select/confirm/input/editor surface a blocking
     * dialog; cancel dismisses it; open_url/notify become notices (never silently
     * dropped); setStatus/setWidget/setTitle/set_editor_text/custom update inline
     * state instead of a dialog.
     */
    sealed interface ChatExtensionRequest {
        data class Select(
            val id: String,
            val title: String,
            val options: List<String>,
        ) : ChatExtensionRequest

        data class Confirm(
            val id: String,
            val title: String,
            val message: String,
        ) : ChatExtensionRequest

        data class Input(
            val id: String,
            val title: String,
            val placeholder: String?,
        ) : ChatExtensionRequest

        data class Editor(
            val id: String,
            val title: String,
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

    fun previewText(text: String): String = text.take(FULL_TEXT_THRESHOLD)

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
                for (i in 0 until arr.length()) {
                    val opt = arr.optString(i).trim()
                    if (opt.isNotEmpty()) options.add(opt)
                }
                if (options.isEmpty()) return null
                ChatExtensionRequest.Select(id = id, title = title, options = options)
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
    // Queue mirror (server reports count only; texts tracked client-side).
    // -----------------------------------------------------------------------

    fun queueAfterSend(queue: ChatQueue, text: String, steering: Boolean): ChatQueue {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return queue
        return if (steering) {
            queue.copy(steering = queue.steering + trimmed)
        } else {
            queue.copy(followUp = queue.followUp + trimmed)
        }
    }

    /** Remove one delivered text from the mirror (desktop consumeQueuedMessage). */
    fun queueAfterDelivered(queue: ChatQueue, text: String): ChatQueue {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return queue
        val si = queue.steering.indexOf(trimmed)
        if (si != -1) {
            return queue.copy(steering = queue.steering.filterIndexed { i, _ -> i != si })
        }
        val fi = queue.followUp.indexOf(trimmed)
        if (fi != -1) {
            return queue.copy(followUp = queue.followUp.filterIndexed { i, _ -> i != fi })
        }
        return queue
    }

    fun queueRemove(queue: ChatQueue, text: String): ChatQueue = queueAfterDelivered(queue, text)

    fun queuePromoteToSteer(queue: ChatQueue, text: String): ChatQueue {
        val trimmed = text.trim()
        val fi = queue.followUp.indexOf(trimmed)
        if (fi == -1) return queue
        return queue.copy(
            steering = queue.steering + trimmed,
            followUp = queue.followUp.filterIndexed { i, _ -> i != fi },
        )
    }

    /**
     * A server snapshot reporting zero queued messages clears the mirror,
     * unless the client just mutated the queue (<5s ago, mirroring desktop's
     * queueMutatedAtRef guard against lagging get_state snapshots).
     */
    fun queueAfterServerCount(queue: ChatQueue, serverCount: Int, mutatedAtMs: Long, nowMs: Long): ChatQueue {
        if (serverCount != 0) return queue
        if (nowMs - mutatedAtMs < 5_000) return queue
        return ChatQueue()
    }

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
        return when (payload.optString("type")) {
            "message_start", "message_update" -> {
                val message = payload.optJSONObject("message") ?: return current
                val role = message.optString("role")
                if (role == "user") return current
                if (role != "assistant" && role != "custom") return current
                val text = extractText(message)
                upsertStreaming(current, role, text)
            }
            "message_end" -> {
                val message = payload.optJSONObject("message") ?: return current
                val role = message.optString("role")
                if (role == "user") {
                    val text = extractText(message)
                    if (text.isEmpty()) return current
                    return current + DisplayMessage(role = "user", text = text, streaming = false)
                }
                val text = extractText(message)
                freezeStreaming(
                    current,
                    if (role == "assistant" || role == "custom") role else null,
                    text.ifEmpty { null },
                )
            }
            else -> current
        }
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
     * Keep an optimistic user bubble if a snapshot arrives while a prompt is
     * still in flight and the snapshot does not yet include that message.
     */
    fun mergeSnapshotMessages(
        current: List<DisplayMessage>,
        snapshot: List<DisplayMessage>,
        promptInFlight: Boolean,
    ): List<DisplayMessage> {
        if (!promptInFlight || current.isEmpty()) return snapshot
        val last = current.last()
        if (last.role != "user") return snapshot
        val alreadyPresent = snapshot.any { it.role == "user" && it.text == last.text }
        return if (alreadyPresent) snapshot else snapshot + last
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
        if (!last.streaming) {
            if (role.isNullOrEmpty() || text.isNullOrEmpty()) return current
            if (last.role == role && last.text == text) return current
            return current + DisplayMessage(role = role, text = text, streaming = false)
        }
        val frozenRole = role ?: last.role
        val frozenText = if (!text.isNullOrEmpty()) text else last.text
        return current.dropLast(1) + last.copy(role = frozenRole, text = frozenText, streaming = false)
    }
}
