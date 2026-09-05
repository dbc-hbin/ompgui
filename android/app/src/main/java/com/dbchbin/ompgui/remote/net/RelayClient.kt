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
import com.dbchbin.ompgui.remote.relay.model
import com.dbchbin.ompgui.remote.relay.parseModelRef
import com.dbchbin.ompgui.remote.relay.parsePairingUri
import com.dbchbin.ompgui.remote.store.DeviceStore
import com.dbchbin.ompgui.remote.store.EncryptedDeviceStore
import com.dbchbin.ompgui.remote.store.PairedDevice
import com.dbchbin.ompgui.remote.ui.RemoteScreen
import com.dbchbin.ompgui.remote.ui.RemoteUiState
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

    private var nextReq = 1
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

    init {
        connection.setListener(object : RelayConnection.Listener {
            override fun onState(state: ConnectionState) {
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
        openedSessionId = id
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
        val req = nextReq++
        pendingCmds[req] = "prompt"
        val displayMsg = if (trimmed.isEmpty()) "[Attached Image]" else trimmed
        if (!connection.send(ClientFrame.Cmd(req = req, type = "prompt", message = trimmed, images = images))) {
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

    fun unpair() {
        val opened = openedSessionId
        val pending = pendingSessionId
        store.clear()
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
                    )
                }
                connection.send(ClientFrame.SessionsList)
                connection.send(ClientFrame.ModelsList)
                connection.send(ClientFrame.SettingsGet)
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
                val snapshotModel = frame.agent.model
                if (snapshotModel == null) {
                    val req = nextReq++
                    pendingCmds[req] = "get_state"
                    connection.send(ClientFrame.Cmd(req = req, type = "get_state"))
                }
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
                    )
                }
            }
            is ServerFrame.SessionErr -> {
                _ui.update { it.copy(error = frame.message) }
            }
            is ServerFrame.Event -> {
                if (frame.id != openedSessionId) return
                val wasRunning = _ui.value.running
                val terminal = EventProjector.isTerminalStop(wasRunning, frame.payload)
                _ui.update {
                    it.copy(
                        messages = EventProjector.applyMessages(it.messages, frame.payload),
                        running = EventProjector.applyRunning(it.running, frame.payload),
                    )
                }
                if (terminal && !AppForeground.isForeground()) {
                    RelayNotifications.showAgentDone(
                        app,
                        sessionId = frame.id,
                        title = _ui.value.chatTitle.ifBlank { frame.id },
                    )
                }
            }
            is ServerFrame.CmdErr -> {
                val kind = pendingCmds.remove(frame.req)
                _ui.update { current ->
                    current.copy(
                        error = frame.message,
                        running = if (kind == "prompt") false else current.running,
                    )
                }
            }
            is ServerFrame.CmdOk -> {
                when (pendingCmds.remove(frame.req)) {
                    "get_state", "set_model" -> {
                        val model = frame.model()
                            ?: frame.data?.optJSONObject("model")?.let(::parseModelRef)
                            ?: parseModelRef(frame.data?.optJSONObject("state"))
                        if (model != null) {
                            _ui.update { it.copy(currentModel = model) }
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
