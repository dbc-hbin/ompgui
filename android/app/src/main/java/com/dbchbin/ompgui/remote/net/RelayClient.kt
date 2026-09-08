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
import com.dbchbin.ompgui.remote.relay.RelayMessageQueue
import com.dbchbin.ompgui.remote.relay.parseMessageQueue
import com.dbchbin.ompgui.remote.relay.parseRecalledDraft
import com.dbchbin.ompgui.remote.relay.reconcileMessageQueue
import com.dbchbin.ompgui.remote.relay.AttachmentSource
import com.dbchbin.ompgui.remote.relay.AttachmentTransfer
import com.dbchbin.ompgui.remote.relay.ClientFrame
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
import com.dbchbin.ompgui.remote.relay.SubagentChip
import com.dbchbin.ompgui.remote.relay.parseSubagentChips
import com.dbchbin.ompgui.remote.relay.mergeSubagentChips
import com.dbchbin.ompgui.remote.relay.reconcileSubagentChips
import com.dbchbin.ompgui.remote.relay.RelayUiErrorKind
import com.dbchbin.ompgui.remote.relay.RelayUiErrors
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
import kotlinx.coroutines.async
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

    private var uiErrorKind: RelayUiErrorKind? = null
    private var uiErrorCode: String? = null

    private fun setUiError(message: String?, kind: RelayUiErrorKind, code: String? = null) {
        val text = message?.trim()?.takeIf { it.isNotEmpty() } ?: return
        uiErrorKind = kind
        uiErrorCode = code
        _ui.update { it.copy(error = text) }
    }

    private fun setUiError(error: Throwable, kind: RelayUiErrorKind) {
        val coded = error as? RelayRequestException
        setUiError(error.message, kind, coded?.code)
    }

    private fun clearUiErrors(kinds: Set<RelayUiErrorKind>? = null) {
        val current = uiErrorKind
        if (current == null) {
            if (_ui.value.error != null) _ui.update { it.copy(error = null) }
            uiErrorCode = null
            return
        }
        if (kinds == null || current in kinds) {
            uiErrorKind = null
            uiErrorCode = null
            _ui.update { it.copy(error = null) }
        }
    }

    private fun clearConnectedErrors() {
        if (RelayUiErrors.shouldClearOnConnected(uiErrorKind, uiErrorCode)) {
            uiErrorKind = null
            uiErrorCode = null
            _ui.update { it.copy(error = null) }
        }
    }

    /**
     * @param onError local owner; null means this request owns the global Request banner.
     * Stale generations never apply success or paint failure.
     */
    private fun scopedRequest(
        domain: String,
        action: String,
        args: JSONObject,
        onError: ((Exception) -> Unit)? = null,
        apply: (JSONObject) -> Unit,
    ) {
        val generation = sessionGeneration
        requestScope.launch {
            try {
                val result = request(domain, action, args)
                if (!RelayUiErrors.isCurrentGeneration(generation, sessionGeneration)) return@launch
                apply(result)
                if (onError == null) clearUiErrors(setOf(RelayUiErrorKind.Request))
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                if (!RelayUiErrors.isCurrentGeneration(generation, sessionGeneration)) return@launch
                if (onError != null) onError(error)
                else setUiError(error, RelayUiErrorKind.Request)
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
            val command = args.optJSONObject("command")
            if (domain == "sessions" && action == "command" && command?.optString("type") == "extension_ui_response") {
                if (args.optString("id") != openedSessionId || historicalView || awaitingSnapshot) {
                    throw RelayRequestException("session_changed", app.getString(R.string.chat_response_failed))
                }
            }
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
                if (requestGeneration != sessionGeneration) {
                    throw CancellationException("Relay request belongs to an obsolete session")
                }
                if (domain == "sessions" && action == "command" &&
                    args.optString("id") == openedSessionId) {
                    applyMessageQueue(result.optJSONObject("result") ?: result)
                }
            }
        }

    // Retain the visible queue across reconnect, but the server may have recreated its
    // wrapper. The first valid current-generation snapshot establishes its revision
    // domain. An event arriving before get_state consumes this allowance, so a late
    // acknowledgement cannot overwrite that event with an older snapshot.
    private var queueBaselinePending = true

    private fun applyMessageQueue(data: JSONObject) {
        val incoming = parseMessageQueue(data.optJSONObject("messageQueue") ?: data.optJSONObject("queue")) ?: return
        val establishBaseline = queueBaselinePending
        queueBaselinePending = false
        _ui.update { it.copy(messageQueue = reconcileMessageQueue(it.messageQueue, incoming, establishBaseline)) }
    }

    fun refreshMessageQueue() {
        val session = openedSessionId ?: return
        scopedRequest("sessions", "command", JSONObject().put("id", session)
            .put("command", JSONObject().put("type", "get_message_queue"))) { result ->
            applyMessageQueue(result.optJSONObject("result") ?: result)
        }
    }

    fun consumeRecalledDraft(id: String) {
        _ui.update { if (it.recalledDraft?.id == id) it.copy(recalledDraft = null) else it }
    }

    suspend fun recallQueuedMessage(id: String): Boolean =
        requestScope.async { mutateQueue("recall_queued_message", id) }.await()

    fun deleteQueuedMessage(id: String) {
        requestScope.launch { mutateQueue("delete_queued_message", id) }
    }

    fun promoteQueuedMessage(id: String) {
        requestScope.launch { mutateQueue("promote_queued_message", id) }
    }

    private suspend fun mutateQueue(type: String, id: String): Boolean = withContext(Dispatchers.Main.immediate) {
        val session = openedSessionId ?: return@withContext false
        val state = _ui.value
        val item = state.messageQueue.items.firstOrNull { it.id == id } ?: return@withContext false
        if (state.queueOperationPending || promptSending || awaitingSnapshot || queueBaselinePending || historicalView ||
            state.recalledDraft != null || item.status == "sending" || state.messageQueue.revision < 0 ||
            (type == "promote_queued_message" && item.lane != "followUp")) return@withContext false
        val generation = sessionGeneration
        _ui.update { it.copy(queueOperationPending = true) }
        try {
            val response = request("sessions", "command", JSONObject().put("id", session).put("command",
                JSONObject().put("type", type).put("id", id).put("expectedRevision", state.messageQueue.revision)))
            if (generation != sessionGeneration) return@withContext false
            val data = response.optJSONObject("result") ?: response
            applyMessageQueue(data)
            if (type == "recall_queued_message") {
                val recalled = parseRecalledDraft(data.optJSONObject("recalled"))
                    ?: throw IllegalStateException("Relay returned an invalid recalled message")
                check(recalled.id == id) { "Relay returned a different recalled message" }
                _ui.update { it.copy(recalledDraft = recalled) }
            }
            clearUiErrors(setOf(RelayUiErrorKind.Request))
            true
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            if (generation == sessionGeneration) {
                setUiError(error, RelayUiErrorKind.Request)
                if ((error as? RelayRequestException)?.code == "queue_stale_revision") refreshMessageQueue()
            }
            false
        } finally {
            if (generation == sessionGeneration) _ui.update { it.copy(queueOperationPending = false) }
        }
    }

    private fun invalidateRequests(message: String) {
        sessionGeneration++
        queueBaselinePending = true
        _ui.update { it.copy(queueOperationPending = false) }
        val pending = pendingRequests.values.toList()
        pendingRequests.clear()
        pendingCmds.clear()
        pendingSubagentRosters.clear()
        for (request in pending) {
            if (request.continuation.isActive) {
                request.continuation.cancel(CancellationException(message))
            }
        }
    }

    private fun resetSessionState() {
        historicalView = false
        requestedLeafId = null
        invalidateRequests("The selected session changed")
        _ui.update { it.copy(
            messages = emptyList(), running = false, draft = "", chatTitle = "",
            currentModel = null, pickerOpen = false, todos = emptyList(), subagents = emptyList(),
            contextFraction = null, sessionThinkingLevel = null, sessionCwd = null,
            filesPath = "", branches = emptyList(), branchLeafId = null,
            worktrees = emptyList(), worktreesGit = false, worktreesError = null,
            fileMatches = emptyList(), creatingSession = false,
            extensionDialogs = emptyList(), chatNotices = emptyList(),
            extensionStatus = emptyMap(), extensionWidgets = emptyMap(), messageQueue = RelayMessageQueue(),
            recalledDraft = null, queueOperationPending = false,
        ) }
    }
    private var historicalView = false
    private var requestedLeafId: String? = null
    private var awaitingSnapshot = false
    private var openedSessionId: String? = null
    private var pendingSessionId: String? = null
    private var pairingOfferUrl: String? = null
    private var pairingServerId: String? = null
    /** True while a pairing-secret hello is in flight (not a token reconnect). */
    private var pairingAttempt = false
    /** req -> cmd type for in-flight session commands. */
    private val pendingCmds = mutableMapOf<Int, String>()
    private val pendingSubagentRosters = mutableMapOf<Int, List<SubagentChip>>()
    private var fileMatchQuery = ""

    init {
        connection.setListener(object : RelayConnection.Listener {
            override fun onState(state: ConnectionState) {
                if (state != ConnectionState.Connected) {
                    invalidateRequests("Relay connection changed")
                    pendingSessionId = openedSessionId
                    awaitingSnapshot = openedSessionId != null
                    _ui.update { it.copy(extensionStatus = emptyMap(), extensionWidgets = emptyMap()) }
                }
                _ui.update { it.copy(connection = state) }
                when (state) {
                    ConnectionState.Connected -> {
                        clearConnectedErrors()
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
                setUiError(message, RelayUiErrorKind.Protocol)
            }
        })
        val device = store.load()
        if (device != null) {
            _ui.update { it.copy(screen = RemoteScreen.Sessions, paired = true) }
            connection.connectToken(device.relayUrl, device.deviceId, device.token, deviceLabel)
        } else if (!store.isAvailable()) {
            uiErrorKind = RelayUiErrorKind.Pairing
            uiErrorCode = null
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
        clearUiErrors()
        _ui.update { it.copy(pairingUri = value, error = null) }
    }

    fun setPassword(value: String) {
        _ui.update { it.copy(password = value) }
    }

    fun setDraft(value: String) {
        _ui.update { it.copy(draft = value) }
    }

    fun dismissChatNotice(id: String) {
        _ui.update { state -> state.copy(chatNotices = state.chatNotices.filterNot { it.id == id }) }
    }

    fun dismissExtensionDialog(id: String) {
        _ui.update { state -> state.copy(extensionDialogs = state.extensionDialogs.filterNot { it.id == id }) }
    }

    fun consumePairingUri(raw: String?, autoConnect: Boolean = false) {
        if (raw.isNullOrBlank()) return
        if (PairingPolicy.shouldIgnoreStalePairing(_ui.value.paired)) return
        _ui.update { it.copy(pairingUri = raw, screen = RemoteScreen.Pairing) }
        if (autoConnect && parsePairingUri(raw) != null) {
            pair()
        }
    }

    fun getServerUrl(): String = pairingOfferUrl ?: store.load()?.relayUrl.orEmpty()

    fun getDeviceId(): String = store.load()?.deviceId.orEmpty()

    fun pair() {
        val offer = parsePairingUri(_ui.value.pairingUri)
        if (offer == null) {
            setUiError("Invalid pairing link", RelayUiErrorKind.Pairing)
            return
        }
        pairingOfferUrl = offer.url
        pairingServerId = offer.serverId
        pairingAttempt = true
        val password = _ui.value.password.takeIf { it.isNotEmpty() }
        clearUiErrors()
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
        if (_ui.value.queueOperationPending || _ui.value.recalledDraft != null) return
        resetSessionState()
        awaitingSnapshot = true
        openedSessionId = id
        pendingSessionId = null
        pendingCmds.clear()
        pendingSubagentRosters.clear()
        clearUiErrors()
        _ui.update {
            it.copy(
                screen = RemoteScreen.Chat(id),
                viewedSessionId = id,
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
            )
        }
        RelayNotifications.cancelAgentDone(app, id)
        if (connection.state == ConnectionState.Connected) {
            connection.send(ClientFrame.SessionOpen(id))
        } else {
            pendingSessionId = id
        }
    }

    fun openFork(id: String, text: String, images: List<com.dbchbin.ompgui.remote.relay.AttachedImage>) {
        if (_ui.value.queueOperationPending || _ui.value.recalledDraft != null) return
        openSession(id)
        _ui.update { state ->
            if ((state.screen as? RemoteScreen.Chat)?.sessionId == id) {
                state.copy(draft = text, recalledDraft = com.dbchbin.ompgui.remote.relay.RelayRecalledDraft("fork:$id", text, images))
            } else state
        }
    }

    fun closeSession() {
        if (_ui.value.queueOperationPending || _ui.value.recalledDraft != null) return
        resetSessionState()
        connection.send(ClientFrame.SessionClose)
        openedSessionId = null
        pendingSessionId = null
        clearUiErrors(RelayUiErrors.clearKindsOnLeaveChat())
        _ui.update { it.copy(screen = RemoteScreen.Sessions, messages = emptyList(), draft = "") }
        connection.send(ClientFrame.SessionsList)
    }

    private var promptSending = false

    fun sendPrompt() {
        val text = _ui.value.draft
        requestScope.launch { sendPrompt(text) }
    }

    suspend fun sendPrompt(
        text: String,
        images: List<AttachmentSource> = emptyList(),
        commandType: String = "prompt",
    ): Boolean =
        withContext(Dispatchers.Main.immediate) {
            val session = openedSessionId ?: return@withContext false
            val generation = sessionGeneration
            val originalDraft = _ui.value.draft
            if (promptSending || _ui.value.queueOperationPending || _ui.value.recalledDraft != null || awaitingSnapshot || historicalView) return@withContext false
            val enqueue = _ui.value.running || commandType == "steer" || commandType == "follow_up"
            val trimmed = text.trim()
            if (trimmed.isEmpty() && images.isEmpty()) return@withContext false
            val staged = mutableListOf<String>()
            var accepted = false
            fun checkSession() {
                if (sessionGeneration != generation || openedSessionId != session) {
                    throw CancellationException("Session or connection changed; prompt was not sent")
                }
                check(connection.state == ConnectionState.Connected) { "Relay is not connected" }
            }
            promptSending = true
            try {
                require(commandType == "prompt" || commandType == "steer" || commandType == "follow_up") {
                    "Unsupported attachment command: $commandType"
                }
                checkSession()
                require(images.size <= AttachmentTransfer.MAX_PER_KIND) { "At most 10 images are allowed" }
                val outgoing = when (val expansion = expandWebSlashCommand(trimmed)) {
                    is SlashExpansion.Expand -> expansion.prompt
                    is SlashExpansion.UsageError -> throw IllegalArgumentException("${expansion.command} needs arguments")
                    SlashExpansion.NotWeb -> trimmed
                }
                require(outgoing.length <= RelayProtocol.MAX_PROMPT_CHARS) { "Composed prompt exceeds 3 Mi characters" }
                for (image in images) {
                    AttachmentTransfer.stage(image, { action, args ->
                        withContext(Dispatchers.Main.immediate) {
                            checkSession()
                            request("sessions", action, args).also { checkSession() }
                        }
                    }, ::checkSession, staged::add)
                }
                checkSession()
                clearUiErrors(setOf(RelayUiErrorKind.Request, RelayUiErrorKind.Session))
                _ui.update { it.copy(error = null) }
                request("sessions", "command", JSONObject().put("id", session).put("command",
                    JSONObject().put("type", if (enqueue) "enqueue_message" else "prompt")
                        .apply { if (enqueue) put("lane", if (commandType == "follow_up") "followUp" else "steer") }
                        .put("message", outgoing).put("attachmentIds", org.json.JSONArray(staged))))
                checkSession()
                accepted = true
                clearUiErrors(setOf(RelayUiErrorKind.Request, RelayUiErrorKind.Session))
                _ui.update { it.copy(draft = if (it.draft == originalDraft) "" else it.draft, error = null) }
                true
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                if (sessionGeneration == generation) {
                    setUiError(failure, RelayUiErrorKind.Session)
                }
                false
            } finally {
                if (!accepted) {
                    kotlinx.coroutines.withContext(kotlinx.coroutines.NonCancellable) {
                        for (id in staged) {
                            try {
                                withTimeout(5_000L) { request("sessions", "attachments.abort", JSONObject().put("attachmentId", id)) }
                            } catch (_: Exception) { /* Disconnect also disposes device staging. */ }
                        }
                    }
                }
                promptSending = false
            }
        }

    fun fetchUsage() {
        connection.send(ClientFrame.Usage)
    }

    fun fetchSettings() {
        connection.send(ClientFrame.SettingsGet)
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
        _ui.update { it.copy(worktreesError = null) }
        scopedRequest(
            "sessions",
            "worktrees.list",
            JSONObject().put("cwd", directory),
            onError = { error ->
                _ui.update {
                    it.copy(
                        worktrees = emptyList(),
                        worktreesGit = false,
                        worktreesError = error.message?.trim()?.takeIf { msg -> msg.isNotEmpty() }
                            ?: "Relay request failed",
                    )
                }
            },
        ) { result ->
            val entries = result.getJSONArray("worktrees")
            val worktrees = buildList {
                for (index in 0 until entries.length()) {
                    val entry = entries.getJSONObject(index)
                    add(com.dbchbin.ompgui.remote.relay.RelayWorktree(entry.getString("path"),
                        entry.optString("branch").takeIf(String::isNotBlank), entry.optBoolean("isMain")))
                }
            }
            _ui.update {
                it.copy(
                    worktrees = worktrees,
                    worktreesGit = result.optBoolean("isGit"),
                    worktreesError = null,
                )
            }
        }
    }

    fun addWorktree(cwd: String, branch: String) {
        val directory = cwd.trim()
        val branchName = branch.trim()
        if (directory.isEmpty() || branchName.isEmpty()) return
        _ui.update { it.copy(worktreesError = null) }
        scopedRequest(
            "sessions",
            "worktrees.add",
            JSONObject().put("cwd", directory).put("branch", branchName),
            onError = { error ->
                _ui.update {
                    it.copy(
                        worktreesError = error.message?.trim()?.takeIf { msg -> msg.isNotEmpty() }
                            ?: "Relay request failed",
                    )
                }
            },
        ) {
            fetchWorktrees(directory)
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
                branchLeafId = requestedLeafId ?: result.optString("leafId").takeIf { leaf -> leaf.isNotBlank() && leaf != "null" }) }
        }
    }

    fun setLeaf(id: String, leafId: String) {
        if (_ui.value.queueOperationPending || _ui.value.recalledDraft != null) return
        val sessionId = id.trim()
        val leaf = leafId.trim()
        if (sessionId.isEmpty() || leaf.isEmpty()) return
        if (sessionId == openedSessionId && connection.send(ClientFrame.SessionLeaf(sessionId, leaf))) {
            invalidateRequests("The selected branch changed")
            requestedLeafId = leaf
            historicalView = true
            awaitingSnapshot = true
            _ui.update { it.copy(messages = emptyList(), branchLeafId = leaf) }
        }
    }

    fun searchFiles(cwd: String, query: String) {
        val directory = cwd.trim()
        val text = query.trim()
        if (directory.isEmpty() || text.isEmpty()) return
        fileMatchQuery = text
        scopedRequest("files", "search", JSONObject().put("cwd", directory).put("query", text)) { result ->
            if (fileMatchQuery != text) return@scopedRequest
            val entries = result.getJSONArray("matches")
            val matches = buildList {
                for (index in 0 until entries.length()) {
                    val entry = entries.getJSONObject(index)
                    add(com.dbchbin.ompgui.remote.relay.RelayFileMatch(entry.getString("path"), entry.optBoolean("isDir")))
                }
            }
            _ui.update { it.copy(fileMatches = matches) }
        }
    }

    fun addProject(cwd: String) {
        val directory = cwd.trim()
        if (directory.isEmpty()) return
        connection.send(ClientFrame.ProjectsAdd(directory))
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

    private fun requestSessionState() {
        val stateReq = nextReq++
        pendingCmds[stateReq] = "get_state"
        if (!connection.send(ClientFrame.Cmd(req = stateReq, type = "get_state"))) {
            pendingCmds.remove(stateReq)
        }
        val subReq = nextReq++
        pendingCmds[subReq] = "get_subagents"
        pendingSubagentRosters[subReq] = _ui.value.subagents
        if (!connection.send(ClientFrame.Cmd(req = subReq, type = "get_subagents"))) {
            pendingCmds.remove(subReq)
            pendingSubagentRosters.remove(subReq)
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
        pendingCmds.clear()
        pendingSubagentRosters.clear()
        uiErrorKind = null
        uiErrorCode = null
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
        requestedLeafId?.let { connection.send(ClientFrame.SessionLeaf(pending, it)) }
    }

    private fun handleFrame(frame: ServerFrame) {
        when (frame) {
            is ServerFrame.Result -> {
                val pending = pendingRequests.remove(frame.req) ?: return
                if (pending.generation != sessionGeneration) {
                    // Old connection epoch — never apply success or paint its failure.
                    if (pending.continuation.isActive) {
                        pending.continuation.cancel(CancellationException("Relay request belongs to an obsolete session"))
                    }
                    return
                }
                if (!pending.continuation.isActive) return
                if (frame.success) {
                    pending.continuation.resume(frame.data ?: JSONObject())
                } else {
                    val error = frame.error
                    pending.continuation.resumeWithException(RelayRequestException(
                        error?.optString("code")?.takeIf { it.isNotBlank() } ?: "request_failed",
                        error?.optString("message")?.takeIf { it.isNotBlank() } ?: "Relay request failed",
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
                if (saveFailed) {
                    uiErrorKind = RelayUiErrorKind.Pairing
                } else {
                    uiErrorKind = null
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
                        setUiError(frame.message, RelayUiErrorKind.Pairing, frame.code)
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
                        setUiError(frame.message, RelayUiErrorKind.Connection, frame.code)
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
                        setUiError(frame.message, RelayUiErrorKind.Pairing, frame.code)
                        _ui.update {
                            it.copy(
                                screen = RemoteScreen.Pairing,
                                paired = hasSavedDevice,
                                error = frame.message,
                            )
                        }
                    }
                    else -> {
                        setUiError(frame.message, RelayUiErrorKind.Connection, frame.code)
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
                if (requestedLeafId != null && frame.leafId != requestedLeafId) return
                awaitingSnapshot = false
                requestSessionState()
                fetchBranches(frame.id)
                val snapshotModel = frame.agent.model
                _ui.update {
                    it.copy(
                        chatTitle = frame.title?.takeIf { title -> title.isNotBlank() }
                            ?: it.chatTitle,
                        messages = frame.messages,
                        running = frame.agent.running,
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
                pendingSubagentRosters.clear()
                connection.send(ClientFrame.SessionsList)
                clearUiErrors()
                _ui.update {
                    it.copy(
                        screen = RemoteScreen.Chat(frame.id),
                        viewedSessionId = frame.id,
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
            is ServerFrame.SessionExported, is ServerFrame.Skills, is ServerFrame.SkillUpdated,
            is ServerFrame.Plugins, is ServerFrame.Mcp, is ServerFrame.McpDeleted, is ServerFrame.McpUpserted,
            is ServerFrame.SessionImported, is ServerFrame.SkillResults, is ServerFrame.SkillInstalled,
            is ServerFrame.Agents, is ServerFrame.AgentSaved, is ServerFrame.AgentDeleted,
            is ServerFrame.AuthProvidersResult -> Unit // Panels own their correlated requests.
            is ServerFrame.FilesIndexResult -> Unit // Correlated searches also discard superseded queries.
            is ServerFrame.ProjectAdded, is ServerFrame.ProjectRemoved -> {
                clearUiErrors(setOf(RelayUiErrorKind.Request, RelayUiErrorKind.Session))
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
                clearUiErrors(setOf(RelayUiErrorKind.Request, RelayUiErrorKind.Session))
                _ui.update { it.copy(error = null) }
            }
            is ServerFrame.SessionErr -> {
                if (frame.id != null && frame.id != openedSessionId) return
                setUiError(frame.message, RelayUiErrorKind.Session, frame.code)
                _ui.update { it.copy(creatingSession = false) }
            }
            is ServerFrame.Event -> {
                // Wrapper teardown resets the server queue even when the relay socket
                // stays connected. Handle this lifecycle boundary before transcript
                // filtering, including historical views, and fence its pending acks.
                if (frame.id == openedSessionId && frame.payload.optString("type") == "session_closed") {
                    val wasRunning = _ui.value.running
                    invalidateRequests("The session runtime closed")
                    _ui.update { it.copy(messageQueue = RelayMessageQueue(), running = false) }
                    if (wasRunning && !AppForeground.isForeground()) {
                        RelayNotifications.showAgentDone(app, sessionId = frame.id,
                            title = _ui.value.chatTitle.ifBlank { frame.id })
                    }
                    return
                }
                // Pending UI replay may precede the opening snapshot. Unlike transcript
                // deltas it is independent of that snapshot and must not be discarded.
                if (!EventProjector.acceptsSessionEvent(frame.id, openedSessionId, awaitingSnapshot, historicalView, frame.payload)) return
                val eventType = frame.payload.optString("type")
                if (eventType == "extension_ui_pending") {
                    _ui.update { state -> state.copy(extensionDialogs = EventProjector.applyExtensionDialogs(state.extensionDialogs, frame.payload)) }
                    return
                }
                if (eventType == "message_queue_update") applyMessageQueue(frame.payload)
                val wasRunning = _ui.value.running
                val terminal = EventProjector.isTerminalStop(wasRunning, frame.payload)
                val sideEffect = EventProjector.parseExtensionSideEffect(frame.payload)
                val notice = sideEffect?.notice ?: EventProjector.parseNotice(frame.payload)
                val status = EventProjector.parseExtensionStatus(frame.payload)
                val widget = EventProjector.parseExtensionWidget(frame.payload)
                val editorText = EventProjector.parseEditorTextInsert(frame.payload)
                val title = EventProjector.parseExtensionTitle(frame.payload)
                val subagentUpdate = EventProjector.applySubagentEvent(_ui.value.subagents, frame.payload)
                _ui.update { state ->
                    val messages = EventProjector.applyMessages(state.messages, frame.payload)
                    val dialogs = EventProjector.applyExtensionDialogs(state.extensionDialogs, frame.payload)
                    val statuses = if (status == null) state.extensionStatus else {
                        val value = status.second
                        if (value == null) state.extensionStatus - status.first else state.extensionStatus + (status.first to value)
                    }
                    val widgets = if (widget == null) state.extensionWidgets else {
                        val lines = widget.second
                        if (lines == null) state.extensionWidgets - widget.first else state.extensionWidgets + (widget.first to lines)
                    }
                    state.copy(
                        messages = messages,
                        running = EventProjector.applyRunning(state.running, frame.payload),
                        extensionDialogs = dialogs,
                        chatNotices = if (notice == null) state.chatNotices else state.chatNotices.filterNot { it.id == notice.id } + notice,
                        extensionStatus = statuses, extensionWidgets = widgets,
                        draft = editorText ?: state.draft,
                        chatTitle = title ?: state.chatTitle,
                        subagents = subagentUpdate ?: state.subagents,
                    )
                }
                if (terminal) {
                    requestSessionState()
                    refreshHistoricalSubagents()
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
                pendingSubagentRosters.remove(frame.req)
                pendingCmds.remove(frame.req) ?: return
                setUiError(frame.message, RelayUiErrorKind.Command, frame.code)
            }
            is ServerFrame.CmdOk -> {
                when (pendingCmds.remove(frame.req)) {
                    "get_state", "set_model" -> {
                        clearUiErrors(setOf(RelayUiErrorKind.Command))
                        applySessionState(frame)
                    }
                    "get_subagents" -> {
                        clearUiErrors(setOf(RelayUiErrorKind.Command))
                        val items = frame.data?.optJSONArray("items")
                            ?: frame.data?.optJSONArray("subagents")
                        val snapshot = parseSubagentChips(items, live = true)
                        val atRequest = pendingSubagentRosters.remove(frame.req).orEmpty()
                        _ui.update { state ->
                            state.copy(subagents = reconcileSubagentChips(state.subagents, snapshot, atRequest))
                        }
                        refreshHistoricalSubagents()
                    }
                    "set_thinking_level" -> {
                        clearUiErrors(setOf(RelayUiErrorKind.Command))
                        val level = frame.data?.optString("thinkingLevel")
                            ?.takeIf { it.isNotBlank() }
                            ?: frame.data?.optString("level")?.takeIf { it.isNotBlank() }
                        if (level != null) {
                            _ui.update { it.copy(sessionThinkingLevel = level) }
                        }
                    }
                    "abort" -> clearUiErrors(setOf(RelayUiErrorKind.Command))
                    else -> Unit
                }
            }
            is ServerFrame.Error -> {
                setUiError(frame.message, RelayUiErrorKind.Protocol, frame.code)
            }
            is ServerFrame.Usage -> {
                usageData.value = frame.data
            }
            is ServerFrame.Settings -> {
                settingsData.value = frame.settings
            }
            is ServerFrame.SettingsUpdated -> Unit // Settings panel owns its correlated update.

        }
    }

    private fun refreshHistoricalSubagents() {
        val session = openedSessionId ?: return
        val atRequest = _ui.value.subagents.associateBy { it.id }
        // Best-effort enrichment onto an already-owned live roster; failures must
        // not steal the global banner or erase chips from get_subagents.
        scopedRequest(
            "sessions",
            "subagents",
            JSONObject().put("id", session),
            onError = { /* live roster remains authoritative */ },
        ) { result ->
            if (openedSessionId != session) return@scopedRequest
            val historical = parseSubagentChips(result.optJSONArray("subagents"), live = false)
            if (historical.isEmpty()) return@scopedRequest
            _ui.update { state ->
                val changedIds = state.subagents.filter { it != atRequest[it.id] }.mapTo(HashSet()) { it.id }
                state.copy(subagents = mergeSubagentChips(state.subagents, historical.filter { it.id !in changedIds }))
            }
        }
    }

    private fun applySessionState(frame: ServerFrame.CmdOk) {
        val data = frame.data ?: return
        applyMessageQueue(data)
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
        _ui.update { if (it.viewedSessionId == id) it.copy(viewedSessionId = null) else it }
        if (openedSessionId == id) {
            resetSessionState()
            openedSessionId = null
            pendingSessionId = null
            pendingCmds.clear()
            pendingSubagentRosters.clear()
            connection.send(ClientFrame.SessionClose)
            _ui.update {
                it.copy(
                    screen = RemoteScreen.Sessions,
                    messages = emptyList(),
                    running = false,
                    chatTitle = "",
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
