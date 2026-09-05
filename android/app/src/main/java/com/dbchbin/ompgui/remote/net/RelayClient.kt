package com.dbchbin.ompgui.remote.net

import android.app.Application
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.dbchbin.ompgui.remote.R
import com.dbchbin.ompgui.remote.notify.AppForeground
import com.dbchbin.ompgui.remote.notify.RelayForegroundService
import com.dbchbin.ompgui.remote.notify.RelayNotifications
import com.dbchbin.ompgui.remote.relay.AttachedImage
import com.dbchbin.ompgui.remote.relay.ClientFrame
import com.dbchbin.ompgui.remote.relay.DisplayMessage
import com.dbchbin.ompgui.remote.relay.EventProjector
import com.dbchbin.ompgui.remote.relay.PairingPolicy
import com.dbchbin.ompgui.remote.relay.RelayModelOption
import com.dbchbin.ompgui.remote.relay.RelayProtocol
import com.dbchbin.ompgui.remote.relay.ServerFrame
import com.dbchbin.ompgui.remote.relay.SlashExpansion
import com.dbchbin.ompgui.remote.relay.expandWebSlashCommand
import com.dbchbin.ompgui.remote.relay.model
import com.dbchbin.ompgui.remote.relay.parseModelRef
import com.dbchbin.ompgui.remote.relay.parsePairingUri
import com.dbchbin.ompgui.remote.relay.parseSubagentChips
import com.dbchbin.ompgui.remote.relay.parseTodoPhases
import com.dbchbin.ompgui.remote.store.DeviceStore
import com.dbchbin.ompgui.remote.store.EncryptedDeviceStore
import com.dbchbin.ompgui.remote.store.PairedDevice
import com.dbchbin.ompgui.remote.ui.RemoteScreen
import com.dbchbin.ompgui.remote.ui.RemoteUiState
import com.dbchbin.ompgui.remote.relay.RelayRequestException
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import org.json.JSONObject

/**
 * Process-scoped owner of the relay WebSocket and all connection/UI state.
 *
 * The socket must survive Activity recreation and task swipes that only tear
 * down the UI, so it lives here (created from [RemoteApplication]) instead of
 * in [com.dbchbin.ompgui.remote.ui.RemoteViewModel], which is a thin facade.
 */
class RelayClient private constructor(
    private val app: Application,
    private val store: DeviceStore = EncryptedDeviceStore(app),
) {
    private val deviceLabel: String = Build.MODEL.take(RelayProtocol.MAX_LABEL_CHARS)
    private val handler = Handler(Looper.getMainLooper())
    private val connection = RelayConnection(
        transportFactory = { OkHttpRelayTransport(it) },
        mainHandler = { handler.post(it) },
        schedule = { delay, runnable -> handler.postDelayed(runnable, delay) },
    )

    private val _ui = MutableStateFlow(RemoteUiState(paired = store.load() != null))
    val uiState: StateFlow<RemoteUiState> = _ui

    private val usageData = MutableStateFlow<JSONObject?>(null)
    val usage: StateFlow<JSONObject?> = usageData

    private val settingsData = MutableStateFlow<JSONObject?>(null)
    val settings: StateFlow<JSONObject?> = settingsData

    private val requestScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private fun scopedRequest(domain: String, action: String, args: JSONObject, apply: (JSONObject) -> Unit) {
        val generation = sessionGeneration
        requestScope.launch {
            try {
                val result = request(domain, action, args)
                if (generation == sessionGeneration) apply(result)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                if (generation == sessionGeneration) _ui.update { it.copy(error = error.message) }
            }
        }
    }

    private var nextReq = 1
    private var sessionGeneration = 0L
    private data class PendingRequest(
        val generation: Long,
        val continuation: CancellableContinuation<JSONObject>,
    )
    private val pendingRequests = mutableMapOf<Int, PendingRequest>()

    suspend fun request(domain: String, action: String, args: JSONObject): JSONObject =
        withContext(Dispatchers.Main.immediate) {
            val requestGeneration = sessionGeneration
            withTimeout<JSONObject>(300_000L) {
                suspendCancellableCoroutine { continuation ->
                    if (connection.state != ConnectionState.Connected) {
                        continuation.resumeWithException(RelayRequestException("disconnected", "Relay is not connected"))
                        return@suspendCancellableCoroutine
                    }
                    val req = nextReq++
                    val pending = PendingRequest(sessionGeneration, continuation)
                    pendingRequests[req] = pending
                    continuation.invokeOnCancellation {
                        handler.post { if (pendingRequests[req] === pending) pendingRequests.remove(req) }
                    }
                    if (!connection.send(ClientFrame.Request(req, domain, action, args)) && pendingRequests.remove(req) === pending) {
                        if (continuation.isActive) {
                            continuation.resumeWithException(RelayRequestException("send_failed", "Could not send relay request"))
                        }
                    }
                }
            }.also { result ->
                if (requestGeneration == sessionGeneration && domain == "sessions" && action == "command" &&
                    args.optString("id") == openedSessionId) {
                    val command = args.optJSONObject("command")
                    val type = command?.optString("type")
                    val behavior = command?.optString("streamingBehavior")
                    val steering = type == "steer" || (type == "prompt" && behavior == "steer")
                    val followUp = type == "follow_up" || (type == "prompt" && behavior == "followUp")
                    if (steering || followUp) {
                        queueMutatedAtMs = android.os.SystemClock.elapsedRealtime()
                        _ui.update { it.copy(queue = EventProjector.queueAfterSend(it.queue, command?.optString("message").orEmpty(), steering)) }
                    }
                    if (type == "get_state") applyQueueCount(result.optJSONObject("result") ?: result)
                }
            }
        }

    private var queueMutatedAtMs = 0L

    private fun applyQueueCount(data: JSONObject) {
        val count = if (data.has("queuedMessageCount")) data.optInt("queuedMessageCount", -1) else -1
        if (count < 0) return
        val now = android.os.SystemClock.elapsedRealtime()
        _ui.update { it.copy(queue = EventProjector.queueAfterServerCount(it.queue, count, queueMutatedAtMs, now)) }
    }

    private fun invalidateRequests(code: String, message: String) {
        sessionGeneration++
        val pending = pendingRequests.values.toList()
        pendingRequests.clear()
        pendingCmds.clear()
        fileVersions.clear()
        pendingSettings = 0
        for (request in pending) {
            if (request.continuation.isActive) {
                request.continuation.resumeWithException(RelayRequestException(code, message))
            }
        }
    }

    private fun resetSessionState() {
        historicalView = false
        invalidateRequests("session_changed", "The selected session changed")
        _ui.update { it.copy(
            messages = emptyList(), running = false, draft = "", chatTitle = "",
            currentModel = null, pickerOpen = false, todos = emptyList(), subagents = emptyList(),
            contextFraction = null, sessionThinkingLevel = null, sessionCwd = null,
            files = emptyList(), filesPath = "", fileContent = null, branches = emptyList(),
            branchLeafId = null, gitStatusCwd = "", gitIsRepo = false, gitRoot = null,
            gitFiles = emptyList(), gitDiff = null, exportResult = null,
            worktrees = emptyList(), worktreesCwd = "", worktreesGit = false, currentWorktreePath = null,
            fileMatches = emptyList(), fileMatchQuery = "", creatingSession = false,
            skills = emptyList(), plugins = emptyList(), mcp = emptyList(), agents = emptyList(),
            skillResults = emptyList(), skillSearchQuery = "",
            extensionDialogs = emptyList(), chatNotices = emptyList(),
            extensionStatus = emptyMap(), extensionWidgets = emptyMap(), queue = EventProjector.ChatQueue(),
        ) }
    }
    private var historicalView = false
    private var awaitingSnapshot = false
    private var openedSessionId: String? = null
    private var pendingSessionId: String? = null
    private var pairingOfferUrl: String? = null
    private var pairingServerId: String? = null
    /** True while a pairing-secret hello is in flight (not a token reconnect). */
    private var pairingAttempt = false
    /** In-flight settings.update count; remote snapshots must not clobber newer local patches. */
    private var pendingSettings = 0
    /** req -> cmd type for in-flight prompt/abort/get_state/set_model commands. */
    private val pendingCmds = mutableMapOf<Int, String>()
    private val fileVersions = mutableMapOf<String, Pair<String, String>>()

    init {
        connection.setListener(object : RelayConnection.Listener {
            override fun onState(state: ConnectionState) {
                if (state != ConnectionState.Connected) {
                    invalidateRequests("disconnected", "Relay connection changed")
                    pendingSessionId = openedSessionId
                    awaitingSnapshot = openedSessionId != null
                    _ui.update { it.copy(extensionDialogs = emptyList(), extensionStatus = emptyMap(), extensionWidgets = emptyMap()) }
                }
                _ui.update { it.copy(connection = state) }
                when (state) {
                    ConnectionState.Connected -> {
                        RelayForegroundService.start(app)
                        flushPendingSession()
                    }
                    ConnectionState.Failed, ConnectionState.Idle -> {
                        RelayForegroundService.stop(app)
                    }
                    ConnectionState.Connecting -> Unit
                }
            }

            override fun onFrame(frame: ServerFrame) = handleFrame(frame)

            override fun onProtocolError(message: String) {
                _ui.update { it.copy(error = message) }
            }
        })
        val device = store.load()
        if (device != null) {
            _ui.update { it.copy(screen = RemoteScreen.Sessions, paired = true) }
            connection.connectToken(device.relayUrl, device.deviceId, device.token, deviceLabel)
        } else if (!store.isAvailable()) {
            _ui.update {
                it.copy(
                    screen = RemoteScreen.Pairing,
                    paired = false,
                    error = app.getString(R.string.pair_store_failed),
                )
            }
        }
    }

    fun setPairingUri(value: String) {
        _ui.update { it.copy(pairingUri = value, error = null) }
    }

    fun setPassword(value: String) {
        _ui.update { it.copy(password = value) }
    }

    fun setDraft(value: String) {
        _ui.update { it.copy(draft = value.take(RelayProtocol.MAX_PROMPT_CHARS)) }
    }

    private fun dialogId(dialog: EventProjector.ChatExtensionRequest): String = when (dialog) {
        is EventProjector.ChatExtensionRequest.Select -> dialog.id
        is EventProjector.ChatExtensionRequest.Confirm -> dialog.id
        is EventProjector.ChatExtensionRequest.Input -> dialog.id
        is EventProjector.ChatExtensionRequest.Editor -> dialog.id
    }

    fun dismissChatNotice(id: String) {
        _ui.update { state -> state.copy(chatNotices = state.chatNotices.filterNot { it.id == id }) }
    }

    fun dismissExtensionDialog(id: String) {
        _ui.update { state -> state.copy(extensionDialogs = state.extensionDialogs.filterNot { dialogId(it) == id }) }
    }

    fun consumePairingUri(raw: String?, autoConnect: Boolean = false) {
        if (raw.isNullOrBlank()) return
        if (PairingPolicy.shouldIgnoreStalePairing(_ui.value.paired)) return
        _ui.update { it.copy(pairingUri = raw, screen = RemoteScreen.Pairing) }
        if (autoConnect && parsePairingUri(raw) != null) {
            pair()
        }
    }

    fun isPaired(): Boolean = _ui.value.paired

    fun getServerUrl(): String = pairingOfferUrl ?: store.load()?.relayUrl.orEmpty()

    fun getDeviceId(): String = store.load()?.deviceId.orEmpty()

    fun pair() {
        val offer = parsePairingUri(_ui.value.pairingUri)
        if (offer == null) {
            _ui.update { it.copy(error = "Invalid pairing link") }
            return
        }
        pairingOfferUrl = offer.url
        pairingServerId = offer.serverId
        pairingAttempt = true
        val password = _ui.value.password.takeIf { it.isNotEmpty() }
        _ui.update { it.copy(error = null) }
        connection.connectPairing(offer.url, offer.secret, deviceLabel, password)
    }

    fun refreshSessions() {
        connection.send(ClientFrame.SessionsList)
    }

    fun openModelPicker() {
        val current = _ui.value
        if (current.running || current.models.isEmpty()) return
        _ui.update { it.copy(pickerOpen = true) }
    }

    fun closeModelPicker() {
        _ui.update { it.copy(pickerOpen = false) }
    }

    /** Sends set_model for the picked option; blocked while the agent is running. */
    fun setModel(option: RelayModelOption) {
        if (_ui.value.running) return
        val req = nextReq++
        pendingCmds[req] = "set_model"
        if (!connection.send(ClientFrame.Cmd(req = req, type = "set_model", provider = option.provider, modelId = option.id))) {
            pendingCmds.remove(req)
            return
        }
        _ui.update { it.copy(pickerOpen = false) }
    }

    fun openSession(id: String) {
        resetSessionState()
        awaitingSnapshot = true
        openedSessionId = id
        pendingSessionId = null
        pendingCmds.clear()
        _ui.update {
            it.copy(
                screen = RemoteScreen.Chat(id),
                chatTitle = it.sessions.find { session -> session.id == id }?.name
                    ?: it.sessions.find { session -> session.id == id }?.firstMessage
                    ?: id,
                messages = emptyList(),
                running = false,
                error = null,
                currentModel = null,
                pickerOpen = false,
                todos = emptyList(),
                subagents = emptyList(),
                contextFraction = null,
                sessionThinkingLevel = null,
                sessionCwd = it.sessions.find { session -> session.id == id }?.cwd,
                files = emptyList(),
            )
        }
        RelayNotifications.cancelAgentDone(app, id)
        if (connection.state == ConnectionState.Connected) {
            connection.send(ClientFrame.SessionOpen(id))
        } else {
            pendingSessionId = id
        }
    }

    fun closeSession() {
        resetSessionState()
        connection.send(ClientFrame.SessionClose)
        openedSessionId = null
        pendingSessionId = null
        _ui.update { it.copy(screen = RemoteScreen.Sessions, messages = emptyList(), draft = "") }
        connection.send(ClientFrame.SessionsList)
    }

    fun sendPrompt() {
        val text = _ui.value.draft.trim()
        if (text.isEmpty()) return
        sendPrompt(text)
    }

    fun sendPrompt(text: String, images: List<AttachedImage>? = null): Boolean {
        val trimmed = text.trim()
        if ((trimmed.isEmpty() && images.isNullOrEmpty()) || _ui.value.running) return false
        val outgoing = when (val expansion = expandWebSlashCommand(trimmed)) {
            is SlashExpansion.Expand -> expansion.prompt
            is SlashExpansion.UsageError -> {
                _ui.update { it.copy(error = "${expansion.command} needs arguments") }
                return false
            }
            SlashExpansion.NotWeb -> trimmed
        }
        val req = nextReq++
        pendingCmds[req] = "prompt"
        val displayMsg = if (outgoing.isEmpty()) "[Attached Image]" else trimmed
        if (!connection.send(ClientFrame.Cmd(req = req, type = "prompt", message = outgoing, images = images))) {
            pendingCmds.remove(req)
            _ui.update { it.copy(error = "Could not send prompt (connection or attachment limit)") }
            return false
        }
        _ui.update {
            it.copy(
                draft = "",
                running = true,
                error = null,
                messages = it.messages + DisplayMessage(role = "user", text = displayMsg),
            )
        }
        return true
    }

    fun fetchUsage() {
        connection.send(ClientFrame.Usage)
    }

    fun fetchSettings() {
        connection.send(ClientFrame.SettingsGet)
    }

    fun updateSettings(patch: JSONObject) {
        pendingSettings++
        connection.send(ClientFrame.SettingsUpdate(patch))
    }

    fun updateSetting(key: String, value: Any?) {
        val patch = JSONObject()
        val parts = key.split(".")
        if (parts.size == 1) {
            patch.put(key, value ?: JSONObject.NULL)
        } else {
            var current = patch
            for (i in 0 until parts.size - 1) {
                val nested = JSONObject()
                current.put(parts[i], nested)
                current = nested
            }
            current.put(parts.last(), value ?: JSONObject.NULL)
        }
        val current = settingsData.value?.let { JSONObject(it.toString()) } ?: JSONObject()
        deepMerge(current, patch)
        settingsData.value = current
        pendingSettings++
        connection.send(ClientFrame.SettingsUpdate(patch))
    }

    private fun deepMerge(target: JSONObject, source: JSONObject) {
        val keys = source.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            val value = source.get(key)
            if (value is JSONObject) {
                val existing = target.optJSONObject(key) ?: JSONObject().also { target.put(key, it) }
                deepMerge(existing, value)
            } else {
                target.put(key, value)
            }
        }
    }

    fun abort() {
        val req = nextReq++
        pendingCmds[req] = "abort"
        if (!connection.send(ClientFrame.Cmd(req = req, type = "abort"))) {
            pendingCmds.remove(req)
        }
    }

    fun fetchProjects() {
        connection.send(ClientFrame.ProjectsList)
    }

    fun fetchSlash() {
        connection.send(ClientFrame.SlashList)
    }

    fun fetchFiles(path: String? = null) {
        val args = JSONObject().put("path", path ?: _ui.value.sessionCwd)
        scopedRequest("files", "list", args) { result ->
            val entries = result.optJSONArray("entries")
            val files = buildList {
                if (entries != null) for (index in 0 until entries.length()) {
                    val entry = entries.optJSONObject(index) ?: continue
                    add(com.dbchbin.ompgui.remote.relay.RelayFileEntry(
                        entry.getString("name"), entry.getString("path"), entry.getBoolean("dir"),
                    ))
                }
            }
            _ui.update { it.copy(files = files, filesPath = result.getString("path")) }
        }
    }

    fun readFile(path: String) {
        val filePath = path.trim()
        if (filePath.isEmpty()) return
        scopedRequest("files", "read", JSONObject().put("path", filePath)) { result ->
            fileVersions.remove(filePath)
            if (result.getBoolean("complete") && result.has("contentHash")) {
                fileVersions[filePath] = result.getString("revision") to result.getString("contentHash")
            }
            _ui.update { it.copy(fileContent = com.dbchbin.ompgui.remote.relay.RelayFileContent(
                path = result.getString("path"), name = result.getString("name"),
                language = result.optString("language").takeIf(String::isNotBlank),
                text = result.getString("text"), truncated = !result.getBoolean("complete"),
                bytes = result.getLong("size"),
            ), error = null) }
        }
    }

    fun clearFileContent() {
        _ui.update { it.copy(fileContent = null) }
    }

    fun deleteSession(id: String) {
        connection.send(ClientFrame.SessionDelete(id))
    }

    fun archiveSession(id: String) {
        connection.send(ClientFrame.SessionArchive(id))
    }

    fun renameSession(id: String, name: String) {
        val title = name.trim()
        if (title.isEmpty()) return
        connection.send(ClientFrame.SessionRename(id, title))
    }

    fun fetchArchives() {
        connection.send(ClientFrame.ArchivesList)
    }

    fun restoreArchive(key: String) {
        val archiveKey = key.trim()
        if (archiveKey.isEmpty()) return
        connection.send(ClientFrame.SessionRestore(archiveKey))
    }

    fun fetchWorktrees(cwd: String) {
        val directory = cwd.trim()
        if (directory.isEmpty()) return
        scopedRequest("sessions", "worktrees.list", JSONObject().put("cwd", directory)) { result ->
            val entries = result.getJSONArray("worktrees")
            val worktrees = buildList {
                for (index in 0 until entries.length()) {
                    val entry = entries.getJSONObject(index)
                    add(com.dbchbin.ompgui.remote.relay.RelayWorktree(entry.getString("path"),
                        entry.optString("branch").takeIf(String::isNotBlank), entry.optBoolean("isMain")))
                }
            }
            _ui.update { it.copy(worktrees = worktrees, worktreesCwd = result.getString("cwd"),
                worktreesGit = result.getBoolean("isGit"),
                currentWorktreePath = result.optString("currentWorktreePath").takeIf { path -> path.isNotBlank() && path != "null" }) }
        }
    }

    fun addWorktree(cwd: String, branch: String) {
        val directory = cwd.trim()
        val branchName = branch.trim()
        if (directory.isEmpty() || branchName.isEmpty()) return
        scopedRequest("sessions", "worktrees.add", JSONObject().put("cwd", directory).put("branch", branchName)) {
            fetchWorktrees(directory)
        }
    }

    fun writeFile(path: String, text: String) {
        val filePath = path.trim()
        if (filePath.isEmpty()) return
        val version = fileVersions[filePath]
        if (version == null) {
            _ui.update { it.copy(error = "Read the complete file before saving changes") }
            return
        }
        scopedRequest("files", "write", JSONObject().put("path", filePath).put("text", text)
            .put("revision", version.first).put("baseContentHash", version.second)) {
            fileVersions.remove(filePath)
            readFile(filePath)
        }
    }

    fun fetchGitStatus(cwd: String) {
        val directory = cwd.trim()
        if (directory.isEmpty()) return
        scopedRequest("files", "gitStatus", JSONObject().put("cwd", directory)) { result ->
            val entries = result.getJSONArray("files")
            val files = buildList {
                for (index in 0 until entries.length()) {
                    val entry = entries.getJSONObject(index)
                    add(com.dbchbin.ompgui.remote.relay.RelayGitFile(
                        entry.getString("filePath"), entry.getString("status"), entry.getString("code"),
                    ))
                }
            }
            _ui.update { it.copy(gitStatusCwd = result.getString("cwd"),
                gitIsRepo = result.getBoolean("isGitRepository"),
                gitRoot = result.optString("repositoryRoot").takeIf { root -> root.isNotBlank() && root != "null" },
                gitFiles = files, gitDiff = null, error = null) }
        }
    }

    fun fetchGitDiff(cwd: String, path: String) {
        val directory = cwd.trim()
        val filePath = path.trim()
        if (directory.isEmpty() || filePath.isEmpty()) return
        scopedRequest("files", "gitDiff", JSONObject().put("cwd", directory).put("path", filePath)) { result ->
            _ui.update { it.copy(gitDiff = com.dbchbin.ompgui.remote.relay.RelayGitDiff(
                path = result.getString("path"), supported = result.getBoolean("supported"),
                status = result.optString("status").takeIf(String::isNotBlank),
                patch = result.optString("patch").takeIf(String::isNotBlank),
                truncated = result.optBoolean("truncated"),
            ), error = null) }
        }
    }

    fun fetchBranches(id: String) {
        val sessionId = id.trim()
        if (sessionId.isEmpty()) return
        scopedRequest("sessions", "branches", JSONObject().put("id", sessionId)) { result ->
            if (openedSessionId != sessionId) return@scopedRequest
            val entries = result.getJSONArray("branches")
            val branches = buildList {
                for (index in 0 until entries.length()) {
                    val entry = entries.getJSONObject(index)
                    add(com.dbchbin.ompgui.remote.relay.RelayBranch(entry.getString("id"),
                        entry.optString("label"), entry.optString("role").takeIf(String::isNotBlank)))
                }
            }
            _ui.update { it.copy(branches = branches,
                branchLeafId = result.optString("leafId").takeIf { leaf -> leaf.isNotBlank() && leaf != "null" }) }
        }
    }

    fun setLeaf(id: String, leafId: String) {
        val sessionId = id.trim()
        val leaf = leafId.trim()
        if (sessionId.isEmpty() || leaf.isEmpty()) return
        if (sessionId == openedSessionId && connection.send(ClientFrame.SessionLeaf(sessionId, leaf))) {
            historicalView = true
        }
    }

    fun exportSession(id: String) {
        val sessionId = id.trim()
        if (sessionId.isEmpty()) return
        connection.send(ClientFrame.SessionExport(sessionId))
    }

    fun fetchSkills(cwd: String) {
        val directory = cwd.trim()
        if (directory.isEmpty()) return
        connection.send(ClientFrame.SkillsList(directory))
    }

    fun toggleSkill(cwd: String, filePath: String, disable: Boolean) {
        val directory = cwd.trim()
        val skillPath = filePath.trim()
        if (directory.isEmpty() || skillPath.isEmpty()) return
        connection.send(ClientFrame.SkillsToggle(directory, skillPath, disable))
    }

    fun fetchPlugins(cwd: String) {
        val directory = cwd.trim()
        if (directory.isEmpty()) return
        connection.send(ClientFrame.PluginsList(directory))
    }

    fun pluginAction(cwd: String, action: String, source: String? = null, scope: String? = null) {
        val directory = cwd.trim()
        val pluginAction = action.trim()
        if (directory.isEmpty() || pluginAction.isEmpty()) return
        connection.send(ClientFrame.PluginsAction(directory, pluginAction, source?.trim(), scope?.trim()))
    }

    fun fetchMcp(cwd: String? = null) {
        connection.send(ClientFrame.McpList(cwd?.trim()?.takeIf { it.isNotEmpty() }))
    }

    fun deleteMcp(cwd: String, name: String) {
        val directory = cwd.trim()
        val serverName = name.trim()
        if (directory.isEmpty() || serverName.isEmpty()) return
        connection.send(ClientFrame.McpDelete(directory, serverName))
    }

    fun upsertMcp(
        cwd: String,
        name: String,
        type: String,
        command: String? = null,
        url: String? = null,
        args: List<String>? = null,
    ) {
        val directory = cwd.trim()
        val serverName = name.trim()
        val serverType = type.trim()
        if (directory.isEmpty() || serverName.isEmpty() || serverType.isEmpty()) return
        connection.send(
            ClientFrame.McpUpsert(
                directory,
                serverName,
                serverType,
                command?.trim(),
                url?.trim(),
                args,
            ),
        )
    }

    fun importSession(fileName: String, content: String) {
        val name = fileName.trim()
        if (name.isEmpty() || content.length > 180_000) return
        connection.send(ClientFrame.SessionImport(name, content))
    }

    fun searchSkills(query: String, limit: Int = 10) {
        val text = query.trim()
        if (text.isEmpty()) return
        _ui.update { it.copy(skillSearchQuery = text) }
        connection.send(ClientFrame.SkillsSearch(text, limit.coerceIn(1, 20)))
    }

    fun installSkill(pkg: String, scope: String, cwd: String?) {
        val packageName = pkg.trim()
        val installScope = scope.trim()
        if (packageName.isEmpty()) return
        if (installScope != "global" && installScope != "project") return
        connection.send(ClientFrame.SkillsInstall(packageName, installScope, cwd?.trim()?.takeIf { it.isNotEmpty() }))
    }

    fun fetchAgents(cwd: String?) {
        connection.send(ClientFrame.AgentsList(cwd?.trim()?.takeIf { it.isNotEmpty() }))
    }

    fun saveAgent(name: String, description: String, systemPrompt: String, scope: String, cwd: String?) {
        val agentName = name.trim()
        val agentScope = scope.trim()
        if (agentName.isEmpty()) return
        if (agentScope != "user" && agentScope != "project") return
        connection.send(
            ClientFrame.AgentsSave(
                agentName,
                description.trim(),
                systemPrompt,
                agentScope,
                cwd?.trim()?.takeIf { it.isNotEmpty() },
            ),
        )
    }

    fun deleteAgent(name: String, scope: String, cwd: String?) {
        val agentName = name.trim()
        val agentScope = scope.trim()
        if (agentName.isEmpty()) return
        if (agentScope != "user" && agentScope != "project") return
        connection.send(
            ClientFrame.AgentsDelete(agentName, agentScope, cwd?.trim()?.takeIf { it.isNotEmpty() }),
        )
    }

    fun fetchAuthProviders() {
        connection.send(ClientFrame.AuthProviders)
    }

    fun searchFiles(cwd: String, query: String) {
        val directory = cwd.trim()
        val text = query.trim()
        if (directory.isEmpty() || text.isEmpty()) return
        _ui.update { it.copy(fileMatchQuery = text) }
        scopedRequest("files", "search", JSONObject().put("cwd", directory).put("query", text)) { result ->
            if (_ui.value.fileMatchQuery != text) return@scopedRequest
            val entries = result.getJSONArray("matches")
            val matches = buildList {
                for (index in 0 until entries.length()) {
                    val entry = entries.getJSONObject(index)
                    add(com.dbchbin.ompgui.remote.relay.RelayFileMatch(entry.getString("path"), entry.optBoolean("isDir")))
                }
            }
            _ui.update { it.copy(fileMatches = matches, error = null) }
        }
    }

    fun addProject(cwd: String) {
        val directory = cwd.trim()
        if (directory.isEmpty()) return
        connection.send(ClientFrame.ProjectsAdd(directory))
    }

    fun removeProject(cwd: String) {
        val directory = cwd.trim()
        if (directory.isEmpty()) return
        connection.send(ClientFrame.ProjectsRemove(directory))
    }

    fun clearExport() {
        _ui.update { it.copy(exportResult = null) }
    }

    fun clearGitDiff() {
        _ui.update { it.copy(gitDiff = null) }
    }

    fun createSession(
        cwd: String,
        message: String? = null,
        provider: String? = null,
        modelId: String? = null,
        thinkingLevel: String? = null,
    ) {
        val directory = cwd.trim()
        if (directory.isEmpty()) return
        _ui.update { it.copy(creatingSession = true, error = null) }
        if (!connection.send(
                ClientFrame.SessionCreate(
                    cwd = directory,
                    message = message,
                    provider = provider,
                    modelId = modelId,
                    thinkingLevel = thinkingLevel,
                ),
            )
        ) {
            _ui.update { it.copy(creatingSession = false, error = "Could not create session") }
        }
    }

    fun setSessionThinkingLevel(level: String) {
        val trimmed = level.trim()
        if (trimmed.isEmpty() || _ui.value.running) return
        val req = nextReq++
        pendingCmds[req] = "set_thinking_level"
        if (!connection.send(ClientFrame.Cmd(req = req, type = "set_thinking_level", level = trimmed))) {
            pendingCmds.remove(req)
            return
        }
        _ui.update { it.copy(sessionThinkingLevel = trimmed) }
    }

    fun compactSession() {
        if (_ui.value.running) return
        val req = nextReq++
        pendingCmds[req] = "compact"
        if (!connection.send(ClientFrame.Cmd(req = req, type = "compact"))) {
            pendingCmds.remove(req)
        }
    }

    private fun requestSessionState() {
        val stateReq = nextReq++
        pendingCmds[stateReq] = "get_state"
        if (!connection.send(ClientFrame.Cmd(req = stateReq, type = "get_state"))) {
            pendingCmds.remove(stateReq)
        }
        val subReq = nextReq++
        pendingCmds[subReq] = "get_subagents"
        if (!connection.send(ClientFrame.Cmd(req = subReq, type = "get_subagents"))) {
            pendingCmds.remove(subReq)
        }
    }

    fun unpair() {
        val opened = openedSessionId
        val pending = pendingSessionId
        store.clear()
        usageData.value = null
        settingsData.value = null
        openedSessionId = null
        pendingSessionId = null
        pairingOfferUrl = null
        pairingServerId = null
        pairingAttempt = false
        pendingSettings = 0
        pendingCmds.clear()
        if (opened != null) RelayNotifications.cancelAgentDone(app, opened)
        if (pending != null && pending != opened) RelayNotifications.cancelAgentDone(app, pending)
        RelayForegroundService.stop(app)
        connection.close()
        _ui.value = RemoteUiState(screen = RemoteScreen.Pairing, paired = false)
    }

    private fun flushPendingSession() {
        val pending = pendingSessionId ?: return
        pendingSessionId = null
        connection.send(ClientFrame.SessionOpen(pending))
    }

    private fun handleFrame(frame: ServerFrame) {
        when (frame) {
            is ServerFrame.Result -> {
                val pending = pendingRequests.remove(frame.req) ?: return
                if (pending.generation != sessionGeneration || !pending.continuation.isActive) return
                if (frame.success) {
                    pending.continuation.resume(frame.data ?: JSONObject())
                } else {
                    val error = frame.error
                    pending.continuation.resumeWithException(RelayRequestException(
                        error?.optString("code") ?: "request_failed",
                        error?.optString("message") ?: "Relay request failed",
                        error?.optJSONObject("details"),
                    ))
                }
            }
            is ServerFrame.HelloOk -> {
                pairingAttempt = false
                val url = pairingOfferUrl ?: store.load()?.relayUrl
                val serverId = pairingServerId ?: store.load()?.serverId
                val token = frame.token ?: store.load()?.token
                var saveFailed = false
                if (url != null && serverId != null && token != null) {
                    val saved = store.save(
                        PairedDevice(
                            relayUrl = url,
                            serverId = serverId,
                            deviceId = frame.deviceId,
                            token = token,
                        ),
                    )
                    if (!saved) saveFailed = true
                }
                pairingOfferUrl = url
                pairingServerId = serverId
                if (url != null && token != null) {
                    connection.promoteToToken(url, frame.deviceId, token, deviceLabel)
                }
                _ui.update {
                    it.copy(
                        screen = if (it.screen is RemoteScreen.Chat) it.screen else RemoteScreen.Sessions,
                        paired = true,
                        error = if (saveFailed) app.getString(R.string.pair_store_failed) else null,
                        pairingUri = "",
                        password = "",
                    )
                }
                connection.send(ClientFrame.SessionsList)
                connection.send(ClientFrame.ModelsList)
                connection.send(ClientFrame.SettingsGet)
                connection.send(ClientFrame.ProjectsList)
                connection.send(ClientFrame.SlashList)
                connection.send(ClientFrame.ArchivesList)
            }
            is ServerFrame.HelloErr -> {
                val attempt = pairingAttempt
                pairingAttempt = false
                val saved = store.load()
                val hasSavedDevice = saved != null
                when {
                    PairingPolicy.shouldClearCredentials(frame.code, hasSavedDevice, attempt) -> {
                        store.clear()
                        RelayForegroundService.stop(app)
                        _ui.update {
                            it.copy(
                                screen = RemoteScreen.Pairing,
                                paired = false,
                                error = frame.message,
                            )
                        }
                    }
                    PairingPolicy.shouldReconnectWithSavedDevice(frame.code, hasSavedDevice, attempt) -> {
                        val device = saved!!
                        _ui.update {
                            it.copy(
                                screen = if (it.screen is RemoteScreen.Chat) it.screen else RemoteScreen.Sessions,
                                paired = true,
                                error = frame.message,
                            )
                        }
                        connection.connectToken(device.relayUrl, device.deviceId, device.token, deviceLabel)
                    }
                    frame.code == "password_required" -> {
                        RelayForegroundService.stop(app)
                        if (!hasSavedDevice && pairingOfferUrl != null) {
                            store.clear()
                        }
                        _ui.update {
                            it.copy(
                                screen = RemoteScreen.Pairing,
                                paired = hasSavedDevice,
                                error = frame.message,
                            )
                        }
                    }
                    else -> {
                        _ui.update { it.copy(error = frame.message) }
                    }
                }
            }
            is ServerFrame.Sessions -> {
                _ui.update {
                    it.copy(
                        sessions = frame.sessions,
                        runningIds = frame.runningIds.toSet(),
                    )
                }
            }
            is ServerFrame.Models -> {
                _ui.update { it.copy(models = frame.models) }
            }
            is ServerFrame.Snapshot -> {
                if (frame.id != openedSessionId) return
                awaitingSnapshot = false
                requestSessionState()
                fetchBranches(frame.id)
                if (!frame.cwd.isNullOrBlank()) {
                    fetchFiles(frame.cwd)
                }
                val snapshotModel = frame.agent.model
                val promptInFlight = pendingCmds.containsValue("prompt")
                _ui.update {
                    it.copy(
                        chatTitle = frame.title?.takeIf { title -> title.isNotBlank() }
                            ?: it.chatTitle,
                        messages = EventProjector.mergeSnapshotMessages(
                            current = it.messages,
                            snapshot = frame.messages,
                            promptInFlight = promptInFlight,
                        ),
                        running = if (promptInFlight) true else frame.agent.running,
                        currentModel = snapshotModel ?: it.currentModel,
                        sessionCwd = frame.cwd ?: it.sessionCwd,
                        branchLeafId = frame.leafId,
                        creatingSession = false,
                    )
                }
            }
            is ServerFrame.SessionCreated -> {
                if (!_ui.value.creatingSession) return
                resetSessionState()
                awaitingSnapshot = true
                openedSessionId = frame.id
                pendingSessionId = null
                pendingCmds.clear()
                connection.send(ClientFrame.SessionsList)
                _ui.update {
                    it.copy(
                        screen = RemoteScreen.Chat(frame.id),
                        chatTitle = frame.cwd.substringAfterLast('/').ifBlank { frame.id },
                        messages = emptyList(),
                        running = false,
                        error = null,
                        currentModel = it.currentModel,
                        pickerOpen = false,
                        sessionCwd = frame.cwd,
                        creatingSession = false,
                        todos = emptyList(),
                        subagents = emptyList(),
                        contextFraction = null,
                    )
                }
            }
            is ServerFrame.Projects -> {
                _ui.update { it.copy(projects = frame.projects) }
            }
            is ServerFrame.Files -> Unit // File panels use generation-correlated domain requests.
            is ServerFrame.Slash -> {
                _ui.update { it.copy(slashCommands = frame.commands) }
            }
            is ServerFrame.FileContent -> Unit // File reads are correlated above.
            is ServerFrame.Archives -> {
                _ui.update { it.copy(archives = frame.archives) }
            }
            is ServerFrame.Worktrees, is ServerFrame.WorktreeAdded -> Unit // Generation-correlated requests own worktree state.
            is ServerFrame.FileWritten -> Unit // Writes require correlated revision-checked results.
            is ServerFrame.GitStatusResult, is ServerFrame.GitDiffResult -> Unit // Correlated domain requests own Git state.
            is ServerFrame.Branches -> {
                if (frame.id != openedSessionId) return
                _ui.update { it.copy(branches = frame.branches, branchLeafId = frame.leafId) }
            }
            is ServerFrame.SessionExported -> {
                if (frame.export.id != openedSessionId) return
                _ui.update { it.copy(exportResult = frame.export, error = null) }
            }
            is ServerFrame.Skills -> {
                _ui.update { it.copy(skills = frame.skills, error = null) }
            }
            is ServerFrame.SkillUpdated -> {
                _ui.update { state ->
                    state.copy(
                        skills = state.skills.map { skill ->
                            if (skill.filePath == frame.filePath) {
                                skill.copy(disableModelInvocation = frame.disableModelInvocation)
                            } else {
                                skill
                            }
                        },
                        error = null,
                    )
                }
            }
            is ServerFrame.Plugins -> {
                _ui.update { it.copy(plugins = frame.packages, error = null) }
            }
            is ServerFrame.Mcp -> {
                _ui.update { it.copy(mcp = frame.inventory, error = null) }
            }
            is ServerFrame.McpDeleted, is ServerFrame.McpUpserted -> {
                _ui.update { it.copy(error = null) }
            }
            is ServerFrame.SessionImported -> {
                _ui.update { it.copy(error = null) }
            }
            is ServerFrame.SkillResults -> {
                _ui.update { it.copy(skillResults = frame.results, skillSearchQuery = frame.query, error = null) }
            }
            is ServerFrame.SkillInstalled -> {
                _ui.update { it.copy(error = null) }
            }
            is ServerFrame.Agents -> {
                _ui.update { it.copy(agents = frame.agents, error = null) }
            }
            is ServerFrame.AgentSaved, is ServerFrame.AgentDeleted -> {
                _ui.update { it.copy(error = null) }
            }
            is ServerFrame.AuthProvidersResult -> {
                _ui.update { it.copy(authProviders = frame.providers, error = null) }
            }
            is ServerFrame.FilesIndexResult -> Unit // Correlated searches also discard superseded queries.
            is ServerFrame.ProjectAdded, is ServerFrame.ProjectRemoved -> {
                _ui.update { it.copy(error = null) }
            }
            is ServerFrame.SessionDeleted, is ServerFrame.SessionArchived -> {
                val removedId = when (frame) {
                    is ServerFrame.SessionDeleted -> frame.id
                    is ServerFrame.SessionArchived -> frame.id
                    else -> ""
                }
                dropOpenSession(removedId)
            }
            is ServerFrame.SessionRenamed -> {
                _ui.update { state ->
                    state.copy(
                        chatTitle = if ((state.screen as? RemoteScreen.Chat)?.sessionId == frame.id) frame.name else state.chatTitle,
                        sessions = state.sessions.map { session ->
                            if (session.id == frame.id) session.copy(name = frame.name) else session
                        },
                    )
                }
            }
            is ServerFrame.SessionRestored -> {
                _ui.update { it.copy(error = null) }
            }
            is ServerFrame.SessionErr -> {
                if (frame.id != null && frame.id != openedSessionId) return
                _ui.update { it.copy(error = frame.message, creatingSession = false) }
            }
            is ServerFrame.Event -> {
                if (frame.id != openedSessionId || awaitingSnapshot || historicalView) return
                val wasRunning = _ui.value.running
                val terminal = EventProjector.isTerminalStop(wasRunning, frame.payload)
                val dialog = EventProjector.parseExtensionDialog(frame.payload)
                val sideEffect = EventProjector.parseExtensionSideEffect(frame.payload)
                val notice = sideEffect?.notice ?: EventProjector.parseNotice(frame.payload)
                val status = EventProjector.parseExtensionStatus(frame.payload)
                val widget = EventProjector.parseExtensionWidget(frame.payload)
                val editorText = EventProjector.parseEditorTextInsert(frame.payload)
                val title = EventProjector.parseExtensionTitle(frame.payload)
                _ui.update { state ->
                    val messages = EventProjector.applyMessages(state.messages, frame.payload)
                    var dialogs = state.extensionDialogs
                    sideEffect?.clearDialogId?.let { id -> dialogs = dialogs.filterNot { dialogId(it) == id } }
                    if (dialog != null) dialogs = dialogs.filterNot { dialogId(it) == dialogId(dialog) } + dialog
                    val statuses = if (status == null) state.extensionStatus else {
                        val value = status.second
                        if (value == null) state.extensionStatus - status.first else state.extensionStatus + (status.first to value)
                    }
                    val widgets = if (widget == null) state.extensionWidgets else {
                        val lines = widget.second
                        if (lines == null) state.extensionWidgets - widget.first else state.extensionWidgets + (widget.first to lines)
                    }
                    val deliveredUser = frame.payload.optString("type") == "message_end" &&
                        frame.payload.optJSONObject("message")?.optString("role") == "user" &&
                        messages.size > state.messages.size && messages.lastOrNull()?.role == "user"
                    state.copy(
                        messages = messages,
                        running = EventProjector.applyRunning(state.running, frame.payload),
                        extensionDialogs = dialogs,
                        chatNotices = if (notice == null) state.chatNotices else state.chatNotices.filterNot { it.id == notice.id } + notice,
                        extensionStatus = statuses, extensionWidgets = widgets,
                        draft = editorText?.take(RelayProtocol.MAX_PROMPT_CHARS) ?: state.draft,
                        chatTitle = title ?: state.chatTitle,
                        queue = if (deliveredUser) EventProjector.queueAfterDelivered(state.queue, messages.lastOrNull()?.text.orEmpty()) else state.queue,
                    )
                }
                if (terminal) {
                    requestSessionState()
                    if (!AppForeground.isForeground()) {
                        RelayNotifications.showAgentDone(
                            app,
                            sessionId = frame.id,
                            title = _ui.value.chatTitle.ifBlank { frame.id },
                        )
                    }
                }
            }
            is ServerFrame.CmdErr -> {
                val kind = pendingCmds.remove(frame.req) ?: return
                _ui.update { current ->
                    current.copy(
                        error = frame.message,
                        running = if (kind == "prompt") false else current.running,
                    )
                }
            }
            is ServerFrame.CmdOk -> {
                when (pendingCmds.remove(frame.req)) {
                    "get_state", "set_model" -> applySessionState(frame)
                    "get_subagents" -> {
                        val items = frame.data?.optJSONArray("items")
                            ?: frame.data?.optJSONArray("subagents")
                        val chips = parseSubagentChips(items)
                        _ui.update { it.copy(subagents = chips) }
                    }
                    "set_thinking_level" -> {
                        val level = frame.data?.optString("thinkingLevel")
                            ?.takeIf { it.isNotBlank() }
                            ?: frame.data?.optString("level")?.takeIf { it.isNotBlank() }
                        if (level != null) {
                            _ui.update { it.copy(sessionThinkingLevel = level) }
                        }
                    }
                    else -> Unit
                }
            }
            is ServerFrame.Error -> {
                _ui.update { it.copy(error = frame.message) }
            }
            is ServerFrame.Usage -> {
                usageData.value = frame.data
            }
            is ServerFrame.Settings -> {
                if (pendingSettings == 0) settingsData.value = frame.settings
            }
            is ServerFrame.SettingsUpdated -> {
                pendingSettings = (pendingSettings - 1).coerceAtLeast(0)
                if (frame.success && frame.settings != null && pendingSettings == 0) {
                    settingsData.value = frame.settings
                } else if (!frame.success) {
                    connection.send(ClientFrame.SettingsGet)
                    val message = frame.error?.takeIf { it.isNotBlank() } ?: "Settings update failed"
                    _ui.update { it.copy(error = message) }
                }
            }
        }
    }

    private fun applySessionState(frame: ServerFrame.CmdOk) {
        val data = frame.data ?: return
        applyQueueCount(data)
        val model = frame.model()
            ?: data.optJSONObject("model")?.let(::parseModelRef)
            ?: parseModelRef(data.optJSONObject("state"))
        val thinking = data.optString("thinkingLevel").trim().takeIf { it.isNotEmpty() }
        val todos = parseTodoPhases(data.optJSONArray("todoPhases"))
        val usage = data.optJSONObject("contextUsage")
        val fraction = usage?.let { obj ->
            if (obj.isNull("percent")) null else obj.optDouble("percent", Double.NaN)
        }?.takeIf { !it.isNaN() }?.div(100.0)
        val cwd = data.optString("cwd").trim().takeIf { it.isNotEmpty() }
        _ui.update {
            it.copy(
                currentModel = model ?: it.currentModel,
                sessionThinkingLevel = thinking ?: it.sessionThinkingLevel,
                todos = todos,
                contextFraction = fraction ?: it.contextFraction,
                sessionCwd = cwd ?: it.sessionCwd,
            )
        }
    }

    private fun dropOpenSession(id: String) {
        if (openedSessionId == id) {
            resetSessionState()
            openedSessionId = null
            pendingSessionId = null
            pendingCmds.clear()
            connection.send(ClientFrame.SessionClose)
            _ui.update {
                it.copy(
                    screen = RemoteScreen.Sessions,
                    messages = emptyList(),
                    running = false,
                    chatTitle = "",
                    fileContent = null,
                    todos = emptyList(),
                    subagents = emptyList(),
                )
            }
        }
    }

    companion object {
        @Volatile
        private var instance: RelayClient? = null

        fun get(context: Context): RelayClient {
            return instance ?: synchronized(this) {
                instance ?: RelayClient(context.applicationContext as Application).also {
                    instance = it
                }
            }
        }
    }
}
