package com.dbchbin.ompgui.remote.relay

import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets

object RelayProtocol {
    const val VERSION = 1
    const val MAX_FRAME_BYTES = 256 * 1024
    const val MAX_PROMPT_CHARS = 32_000
    const val MAX_LABEL_CHARS = 64
    const val MAX_SNAPSHOT_MESSAGES = 50
    val DEVICE_ID = Regex("^d_[A-Za-z0-9_-]{16,64}$")
    val SECRET = Regex("^[A-Za-z0-9_-]{32,128}$")
    val SESSION_ID = Regex("^[A-Za-z0-9._-]{1,128}$")
}

data class DisplayMessage(
    val role: String,
    val text: String,
    val timestamp: Long? = null,
    val streaming: Boolean = false,
)

data class AgentState(
    val running: Boolean,
    val ready: Boolean,
    val model: ModelRef? = null,
)

/** One pickable entry from the Mac `models` list frame. */
data class RelayModelOption(
    val provider: String,
    val id: String,
    val name: String,
)

/** The model a session is currently using (`agent.state.model` / `cmd_ok` data). */
data class ModelRef(
    val provider: String,
    val id: String,
    val name: String? = null,
) {
    fun displayName(): String = if (name.isNullOrBlank()) id else name
}

data class SessionListItem(
    val id: String,
    val cwd: String,
    val name: String? = null,
    val created: String = "",
    val modified: String = "",
    val messageCount: Int = 0,
    val firstMessage: String = "",
    val parentSessionId: String? = null,
    val projectRoot: String? = null,
    val projectKey: String? = null,
    val worktreeBranch: String? = null,
)

data class AttachedImage(val data: String, val mimeType: String)

sealed class ClientFrame {
    data class Hello(
        val pairingSecret: String? = null,
        val deviceId: String? = null,
        val token: String? = null,
        val password: String? = null,
        val label: String? = null,
    ) : ClientFrame()

    data object SessionsList : ClientFrame()
    data object ModelsList : ClientFrame()
    data class SessionOpen(val id: String) : ClientFrame()
    data object SessionClose : ClientFrame()
    data class Cmd(
        val req: Int,
        val type: String,
        val message: String? = null,
        val provider: String? = null,
        val modelId: String? = null,
        val images: List<AttachedImage>? = null,
    ) : ClientFrame()
    data object Usage : ClientFrame()
    data object SettingsGet : ClientFrame()
    data class SettingsUpdate(val settings: JSONObject) : ClientFrame()
}

sealed class ServerFrame {
    data class HelloOk(val serverId: String, val deviceId: String, val token: String?) : ServerFrame()
    data class HelloErr(val code: String, val message: String) : ServerFrame()
    data class Sessions(val sessions: List<SessionListItem>, val runningIds: List<String>) : ServerFrame()
    data class Models(val models: List<RelayModelOption>) : ServerFrame()
    data class Snapshot(
        val id: String,
        val title: String?,
        val cwd: String?,
        val leafId: String?,
        val messages: List<DisplayMessage>,
        val agent: AgentState,
    ) : ServerFrame()
    data class SessionErr(val id: String?, val code: String, val message: String) : ServerFrame()
    data class Event(val id: String, val payload: JSONObject) : ServerFrame()
    data class CmdOk(val req: Int, val data: JSONObject? = null) : ServerFrame()
    data class CmdErr(val req: Int, val code: String, val message: String) : ServerFrame()
    data class Error(val code: String, val message: String) : ServerFrame()
    data class Usage(val data: JSONObject) : ServerFrame()
    data class Settings(val settings: JSONObject) : ServerFrame()
    data class SettingsUpdated(val success: Boolean, val settings: JSONObject?, val error: String?) : ServerFrame()
}

fun ClientFrame.encode(): String {
    val json = JSONObject()
    when (this) {
        is ClientFrame.Hello -> {
            json.put("op", "hello")
            json.put("protocol", RelayProtocol.VERSION)
            val pairing = pairingSecret?.trim()
            val device = deviceId?.trim()
            val tok = token?.trim()
            when {
                !pairing.isNullOrEmpty() -> {
                    require(RelayProtocol.SECRET.matches(pairing)) { "Invalid pairing secret" }
                    json.put("pairingSecret", pairing)
                }
                !device.isNullOrEmpty() && !tok.isNullOrEmpty() -> {
                    require(RelayProtocol.DEVICE_ID.matches(device)) { "Invalid device id" }
                    require(RelayProtocol.SECRET.matches(tok)) { "Invalid device token" }
                    json.put("deviceId", device)
                    json.put("token", tok)
                }
                else -> throw IllegalArgumentException("Pairing secret or device token is required")
            }
            if (password != null) json.put("password", password)
            val trimmedLabel = label?.trim()?.take(RelayProtocol.MAX_LABEL_CHARS)
            if (!trimmedLabel.isNullOrEmpty()) json.put("label", trimmedLabel)
        }
        is ClientFrame.SessionsList -> json.put("op", "sessions.list")
        is ClientFrame.ModelsList -> json.put("op", "models.list")
        is ClientFrame.SessionOpen -> {
            val sessionId = id.trim()
            require(RelayProtocol.SESSION_ID.matches(sessionId)) { "Invalid session id" }
            json.put("op", "session.open")
            json.put("id", sessionId)
        }
        is ClientFrame.SessionClose -> json.put("op", "session.close")
        is ClientFrame.Usage -> json.put("op", "usage")
        is ClientFrame.SettingsGet -> json.put("op", "settings.get")
        is ClientFrame.SettingsUpdate -> {
            json.put("op", "settings.update")
            json.put("settings", settings)
        }
        is ClientFrame.Cmd -> {
            require(req >= 1) { "cmd.req must be a positive integer" }
            val command = type.trim()
            require(command in setOf("prompt", "abort", "get_state", "set_model")) {
                "Command is not allowed on the relay"
            }
            json.put("op", "cmd")
            json.put("req", req)
            json.put("type", command)
            when (command) {
                "prompt" -> {
                    val text = message ?: throw IllegalArgumentException("prompt message is required")
                    require(text.length <= RelayProtocol.MAX_PROMPT_CHARS) { "prompt message is too long" }
                    json.put("message", text)
                    if (!images.isNullOrEmpty()) {
                        val array = JSONArray()
                        for (image in images) {
                            array.put(JSONObject().put("data", image.data).put("mimeType", image.mimeType))
                        }
                        json.put("images", array)
                    }
                }
                "set_model" -> {
                    val providerName = provider?.trim()
                    val model = modelId?.trim()
                    require(!providerName.isNullOrEmpty() && !model.isNullOrEmpty()) {
                        "set_model requires provider and modelId"
                    }
                    json.put("provider", providerName)
                    json.put("modelId", model)
                }
            }
        }
    }
    val encoded = json.toString()
    require(utf8Size(encoded) <= RelayProtocol.MAX_FRAME_BYTES) { "Frame is too large" }
    return encoded
}

fun parseServerFrame(raw: String): ServerFrame? {
    if (raw.isEmpty() || utf8Size(raw) > RelayProtocol.MAX_FRAME_BYTES) return null
    val parsed = try {
        JSONObject(raw)
    } catch (_: Exception) {
        return null
    }
    return when (parsed.optString("op", "")) {
        "hello_ok" -> {
            if (parsed.optInt("protocol", -1) != RelayProtocol.VERSION) return null
            val serverId = parsed.optString("serverId").trim()
            val deviceId = parsed.optString("deviceId").trim()
            if (serverId.isEmpty() || deviceId.isEmpty()) return null
            val token = parsed.optString("token").trim().takeIf { it.isNotEmpty() }
            ServerFrame.HelloOk(serverId = serverId, deviceId = deviceId, token = token)
        }
        "hello_err" -> ServerFrame.HelloErr(
            code = parsed.optString("code", "unauthorized"),
            message = parsed.optString("message", "Unauthorized"),
        )
        "sessions" -> ServerFrame.Sessions(
            sessions = parseSessions(parsed.optJSONArray("sessions")),
            runningIds = parseStringList(parsed.optJSONArray("runningIds")),
        )
        "models" -> ServerFrame.Models(
            models = parseModelOptions(parsed.optJSONArray("models")),
        )
        "session.snapshot" -> {
            val id = parsed.optString("id").trim()
            if (!RelayProtocol.SESSION_ID.matches(id)) return null
            val agent = parsed.optJSONObject("agent")
            ServerFrame.Snapshot(
                id = id,
                title = parsed.optString("title").trim().takeIf { it.isNotEmpty() },
                cwd = parsed.optString("cwd").trim().takeIf { it.isNotEmpty() },
                leafId = parsed.optString("leafId").trim().takeIf { it.isNotEmpty() },
                messages = parseMessages(parsed.optJSONArray("messages")),
                agent = AgentState(
                    running = agent?.optBoolean("running", false) == true,
                    ready = agent?.optBoolean("ready", false) == true,
                    model = agent?.optJSONObject("state")?.let(::parseModelRef)
                        ?: parseModelRef(agent),
                ),
            )
        }
        "session.err" -> ServerFrame.SessionErr(
            id = parsed.optString("id").trim().takeIf { it.isNotEmpty() },
            code = parsed.optString("code", "session_open_failed"),
            message = parsed.optString("message", "Session failed"),
        )
        "event" -> {
            val id = parsed.optString("id").trim()
            if (!RelayProtocol.SESSION_ID.matches(id)) return null
            val payload = parsed.optJSONObject("payload") ?: JSONObject()
            ServerFrame.Event(id = id, payload = payload)
        }
        "cmd_ok" -> {
            val req = parsed.optInt("req", -1)
            if (req < 1) return null
            ServerFrame.CmdOk(req, data = parsed.optJSONObject("data"))
        }
        "cmd_err" -> {
            val req = parsed.optInt("req", -1)
            if (req < 1) return null
            ServerFrame.CmdErr(
                req = req,
                code = parsed.optString("code", "rpc_command_failed"),
                message = parsed.optString("message", "Command failed"),
            )
        }
        "error" -> ServerFrame.Error(
            code = parsed.optString("code", "error"),
            message = parsed.optString("message", "Error"),
        )
        "usage" -> ServerFrame.Usage(parsed.optJSONObject("data") ?: JSONObject())
        "settings" -> ServerFrame.Settings(parsed.optJSONObject("settings") ?: JSONObject())
        "settings_updated" -> ServerFrame.SettingsUpdated(
            success = parsed.optBoolean("success", false),
            settings = parsed.optJSONObject("settings"),
            error = parsed.optString("error").takeIf { it.isNotEmpty() },
        )
        else -> null
    }
}

private fun parseSessions(array: JSONArray?): List<SessionListItem> {
    if (array == null) return emptyList()
    val out = ArrayList<SessionListItem>(array.length())
    for (i in 0 until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        val id = item.optString("id").trim()
        val cwd = item.optString("cwd")
        if (!RelayProtocol.SESSION_ID.matches(id)) continue
        out.add(
            SessionListItem(
                id = id,
                cwd = cwd,
                name = item.optString("name").trim().takeIf { it.isNotEmpty() },
                created = item.optString("created"),
                modified = item.optString("modified"),
                messageCount = item.optInt("messageCount", 0),
                firstMessage = item.optString("firstMessage"),
                parentSessionId = item.optString("parentSessionId").trim().takeIf { it.isNotEmpty() },
                projectRoot = item.optString("projectRoot").trim().takeIf { it.isNotEmpty() },
                projectKey = item.optString("projectKey").trim().takeIf { it.isNotEmpty() },
                worktreeBranch = item.optString("worktreeBranch").trim().takeIf { it.isNotEmpty() },
            ),
        )
    }
    return out
}

private fun parseMessages(array: JSONArray?): List<DisplayMessage> {
    if (array == null) return emptyList()
    val out = ArrayList<DisplayMessage>()
    val first = maxOf(0, array.length() - RelayProtocol.MAX_SNAPSHOT_MESSAGES)
    for (i in first until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        val role = item.optString("role")
        if (role !in setOf("user", "assistant", "custom")) continue
        if (!item.has("text") || item.isNull("text")) continue
        val text = item.optString("text")
        val timestamp = when (val raw = item.opt("timestamp")) {
            is Number -> raw.toLong()
            else -> null
        }
        out.add(DisplayMessage(role = role, text = text, timestamp = timestamp))
    }
    return out
}

private fun parseStringList(array: JSONArray?): List<String> {
    if (array == null) return emptyList()
    val out = ArrayList<String>(array.length())
    for (i in 0 until array.length()) {
        val value = array.optString(i).trim()
        if (value.isNotEmpty()) out.add(value)
    }
    return out
}

/**
 * Parses `{"op":"models","models":[...]}` entries. Mac sends
 * `{provider, id, name}` with `name` falling back to `id`; entries missing
 * provider/id are dropped.
 */
fun parseModelOptions(array: JSONArray?): List<RelayModelOption> {
    if (array == null) return emptyList()
    val out = ArrayList<RelayModelOption>(array.length())
    for (i in 0 until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        val provider = item.optString("provider").trim()
        val id = item.optString("id").trim()
        if (provider.isEmpty() || id.isEmpty()) continue
        val name = item.optString("name").trim().takeIf { it.isNotEmpty() } ?: id
        out.add(RelayModelOption(provider = provider, id = id, name = name))
    }
    return out
}

/**
 * Parses the current-model shape shared by snapshot `agent.state.model`,
 * `get_state` `cmd_ok` data, and `set_model` `cmd_ok` data (OmpModel).
 * Accepts `id` (Mac) and `modelId` (omp RPC) keys; returns null when neither
 * provider nor id is present. A bare `agent` object without a model returns
 * null so callers keep the previous value.
 */
fun parseModelRef(obj: JSONObject?): ModelRef? {
    if (obj == null) return null
    val model = if (obj.has("model") && !obj.isNull("model")) {
        obj.optJSONObject("model") ?: return null
    } else {
        obj
    }
    val provider = model.optString("provider").trim()
    val id = (model.optString("id").trim().takeIf { it.isNotEmpty() }
        ?: model.optString("modelId").trim()).trim()
    if (provider.isEmpty() || id.isEmpty()) return null
    val name = model.optString("name").trim().takeIf { it.isNotEmpty() }
    return ModelRef(provider = provider, id = id, name = name)
}

/** Extracts a [ModelRef] from `cmd_ok` data, unwrapping `model` when present. */
fun ServerFrame.CmdOk.model(): ModelRef? = parseModelRef(data)

private fun utf8Size(value: String): Int = value.toByteArray(StandardCharsets.UTF_8).size
