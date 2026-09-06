package com.dbchbin.ompgui.remote.relay

import org.json.JSONArray
import org.json.JSONObject

/**
 * Chat-scoped request helpers over the canonical [RelayRequester].
 *
 * Ownership: ChatParity owns this file. Transport (AndroidTransport) owns the
 * wire; SessionsParity owns the `sessions` domain backend; NativeFiles owns
 * upload/download streaming; GeneralSettings owns the `system` domain backend.
 * All helpers return parsed JSON objects and throw [RelayRequestException]
 * (coded server errors) or cancellation — never fake success for unsupported
 * operations.
 */
object ChatRequests {
    const val DOMAIN_SESSIONS = "sessions"
    const val DOMAIN_FILES = "files"
    const val DOMAIN_SYSTEM = "system"

    // Exact action names per SessionsParity / reset contract.
    const val ACTION_COMMAND = "command"
    const val ACTION_HISTORY = "history"
    const val ACTION_THINKING = "thinking"
    const val ACTION_MEDIA = "media"
    const val ACTION_SUBAGENTS = "subagents"
    const val ACTION_SUBAGENT_TRANSCRIPT = "subagentTranscript"
    const val ACTION_SUBAGENT_COMPLETION = "subagentCompletion"
    const val ACTION_STATS = "stats"
    const val ACTION_STATE = "state"
    const val ACTION_SYSTEM_PROMPT = "systemPrompt"
    const val ACTION_SYSTEM_PROMPT_GET = "systemPrompt.get"
    const val ACTION_BRANCHES = "branches"
    const val ACTION_LEAF = "leaf"
    const val ACTION_AUTONAME = "autoname"

    /** Supported runtime command types; unsupported ones surface server errors. */
    val SUPPORTED_COMMAND_TYPES: Set<String> = setOf(
        "prompt", "steer", "follow_up", "abort", "abort_and_prompt",
        "get_state", "set_model", "set_thinking_level", "set_fast_mode",
        "fork", "new_session", "switch_session",
        "compact", "abort_compaction", "set_session_name",
        "get_session_stats", "get_last_assistant_text", "get_commands",
        "reload", "extension_ui_response",
        "bash", "set_steering_mode", "set_follow_up_mode",
        "set_interrupt_mode", "set_auto_compaction", "set_auto_retry",
        "abort_retry", "abort_bash", "set_todos", "handoff",
        "get_subagents", "get_subagent_messages", "set_subagent_subscription",
        "get_messages", "get_messages_page", "get_branch_messages",
        "export_html", "cycle_model", "cycle_thinking_level",
    )

    fun commandArgs(id: String, command: JSONObject): JSONObject =
        JSONObject().put("id", id).put("command", command)

    fun promptCommand(message: String, images: JSONArray? = null, behavior: String? = null): JSONObject {
        val cmd = JSONObject().put("type", "prompt").put("message", message)
        if (images != null) cmd.put("images", images)
        if (behavior == "steer" || behavior == "followUp") cmd.put("streamingBehavior", behavior)
        return cmd
    }

    fun steerCommand(message: String): JSONObject =
        JSONObject().put("type", "steer").put("message", message)

    fun followUpCommand(message: String): JSONObject =
        JSONObject().put("type", "follow_up").put("message", message)

    fun interruptCommand(message: String, images: JSONArray? = null): JSONObject {
        val cmd = JSONObject().put("type", "abort_and_prompt").put("message", message)
        if (images != null) cmd.put("images", images)
        return cmd
    }

    fun extensionResponse(id: String, response: JSONObject): JSONObject {
        val cmd = JSONObject(response.toString())
        cmd.put("type", "extension_ui_response")
        cmd.put("id", id)
        return cmd
    }

    fun historyArgs(id: String, leafId: String? = null, offset: Int = 0, limit: Int = 100): JSONObject {
        val args = JSONObject().put("id", id).put("offset", offset).put("limit", limit)
        if (!leafId.isNullOrBlank()) args.put("leafId", leafId)
        return args
    }

    data class HistoryPage(
        val messages: JSONArray,
        val entryIds: JSONArray,
        val todoPhases: JSONArray,
        val total: Int,
        val offset: Int,
        val limit: Int,
        val hasMore: Boolean,
        val leafId: String?,
    )

    fun parseHistoryPage(data: JSONObject): HistoryPage {
        return HistoryPage(
            messages = data.optJSONArray("messages") ?: JSONArray(),
            entryIds = data.optJSONArray("entryIds") ?: JSONArray(),
            todoPhases = data.optJSONArray("todoPhases") ?: JSONArray(),
            total = data.optInt("total", 0),
            offset = data.optInt("offset", 0),
            limit = data.optInt("limit", 100),
            hasMore = data.optBoolean("hasMore", false),
            leafId = data.optString("leafId").trim().takeIf { it.isNotEmpty() },
        )
    }

    data class SubagentTranscriptPage(
        val messages: JSONArray,
        val fromByte: Long,
        val nextByte: Long,
        val reset: Boolean,
        val totalBytes: Long?,
        val exhausted: Boolean,
    )

    fun parseSubagentTranscriptPage(data: JSONObject): SubagentTranscriptPage {
        val fromByte = data.optLong("fromByte", 0L)
        val nextByte = data.optLong("nextByte", 0L)
        val totalBytes = if (data.has("totalBytes") && !data.isNull("totalBytes")) {
            data.optLong("totalBytes")
        } else {
            null
        }
        val reset = data.optBoolean("reset", false)
        val messages = data.optJSONArray("messages") ?: JSONArray()
        val exhausted = if (totalBytes != null) {
            nextByte >= totalBytes || nextByte <= fromByte
        } else {
            messages.length() == 0 || nextByte <= fromByte
        }
        return SubagentTranscriptPage(
            messages = messages,
            fromByte = fromByte,
            nextByte = nextByte,
            reset = reset,
            totalBytes = totalBytes,
            exhausted = exhausted,
        )
    }

    suspend fun command(
        requester: RelayRequester,
        id: String,
        command: JSONObject,
    ): JSONObject = requester.request(DOMAIN_SESSIONS, ACTION_COMMAND, commandArgs(id, command))

    suspend fun history(
        requester: RelayRequester,
        id: String,
        leafId: String? = null,
        offset: Int = 0,
        limit: Int = 100,
    ): JSONObject = requester.request(DOMAIN_SESSIONS, ACTION_HISTORY, historyArgs(id, leafId, offset, limit))

    suspend fun thinking(
        requester: RelayRequester,
        id: String,
        entryId: String,
        blockIndex: Int,
    ): JSONObject = requester.request(
        DOMAIN_SESSIONS, ACTION_THINKING,
        JSONObject().put("id", id).put("entryId", entryId).put("blockIndex", blockIndex),
    )

    suspend fun media(
        requester: RelayRequester,
        id: String,
        entryId: String,
    ): JSONObject = requester.request(
        DOMAIN_SESSIONS, ACTION_MEDIA,
        JSONObject().put("id", id).put("entryId", entryId),
    )

    suspend fun subagents(requester: RelayRequester, id: String): JSONObject =
        requester.request(DOMAIN_SESSIONS, ACTION_SUBAGENTS, JSONObject().put("id", id))

    suspend fun subagentTranscript(
        requester: RelayRequester,
        id: String,
        subagentId: String,
        fromByte: Long = 0L,
    ): JSONObject = requester.request(
        DOMAIN_SESSIONS, ACTION_SUBAGENT_TRANSCRIPT,
        JSONObject().put("id", id).put("subagentId", subagentId).put("fromByte", fromByte),
    )

    suspend fun subagentCompletion(
        requester: RelayRequester,
        id: String,
        subagentId: String,
    ): JSONObject = requester.request(
        DOMAIN_SESSIONS, ACTION_SUBAGENT_COMPLETION,
        JSONObject().put("id", id).put("subagentId", subagentId),
    )

    suspend fun stats(requester: RelayRequester, id: String): JSONObject =
        requester.request(DOMAIN_SESSIONS, ACTION_STATS, JSONObject().put("id", id))

    suspend fun sessionState(requester: RelayRequester, id: String): JSONObject =
        requester.request(DOMAIN_SESSIONS, ACTION_STATE, JSONObject().put("id", id))

    suspend fun systemPrompt(requester: RelayRequester, id: String): JSONObject =
        requester.request(DOMAIN_SESSIONS, ACTION_SYSTEM_PROMPT, JSONObject().put("id", id))

    suspend fun systemPromptGet(requester: RelayRequester, sessionId: String): JSONObject =
        requester.request(DOMAIN_SYSTEM, ACTION_SYSTEM_PROMPT_GET, JSONObject().put("sessionId", sessionId))

    suspend fun branches(requester: RelayRequester, id: String): JSONObject =
        requester.request(DOMAIN_SESSIONS, ACTION_BRANCHES, JSONObject().put("id", id))

    suspend fun fileSearch(requester: RelayRequester, cwd: String, query: String): JSONObject =
        requester.request(DOMAIN_FILES, "search", JSONObject().put("cwd", cwd).put("query", query))
}
