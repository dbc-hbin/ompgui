package com.dbchbin.ompgui.remote.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import com.dbchbin.ompgui.remote.net.ConnectionState
import com.dbchbin.ompgui.remote.net.RelayClient
import com.dbchbin.ompgui.remote.relay.AttachedImage
import com.dbchbin.ompgui.remote.relay.DisplayMessage
import com.dbchbin.ompgui.remote.relay.ModelRef
import com.dbchbin.ompgui.remote.relay.RelayModelOption
import com.dbchbin.ompgui.remote.relay.SessionListItem
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONObject

sealed class RemoteScreen {
    data object Pairing : RemoteScreen()
    data object Sessions : RemoteScreen()
    data class Chat(val sessionId: String) : RemoteScreen()
}

data class RemoteUiState(
    val screen: RemoteScreen = RemoteScreen.Pairing,
    val pairingUri: String = "",
    val password: String = "",
    val connection: ConnectionState = ConnectionState.Idle,
    val error: String? = null,
    val sessions: List<SessionListItem> = emptyList(),
    val runningIds: Set<String> = emptySet(),
    val chatTitle: String = "",
    val messages: List<DisplayMessage> = emptyList(),
    val running: Boolean = false,
    val draft: String = "",
    val paired: Boolean = false,
    val models: List<RelayModelOption> = emptyList(),
    val currentModel: ModelRef? = null,
    val pickerOpen: Boolean = false,
)

/**
 * Thin facade over the process-scoped [RelayClient], which owns the relay
 * WebSocket and all connection/UI state. The socket must survive Activity
 * recreation, so this ViewModel never touches the connection lifecycle.
 */
class RemoteViewModel(
    application: Application,
) : AndroidViewModel(application) {
    private fun client(): RelayClient = RelayClient.get(getApplication())

    val uiState: StateFlow<RemoteUiState> get() = client().uiState

    fun setPairingUri(value: String) = client().setPairingUri(value)

    fun setPassword(value: String) = client().setPassword(value)

    fun setDraft(value: String) = client().setDraft(value)

    fun consumePairingUri(raw: String?, autoConnect: Boolean = false) =
        client().consumePairingUri(raw, autoConnect)

    fun isPaired(): Boolean = client().isPaired()

    fun getServerUrl(): String = client().getServerUrl()

    fun getDeviceId(): String = client().getDeviceId()

    fun pair() = client().pair()

    fun refreshSessions() = client().refreshSessions()

    fun openModelPicker() = client().openModelPicker()

    fun closeModelPicker() = client().closeModelPicker()

    fun setModel(option: RelayModelOption) = client().setModel(option)

    fun openSession(id: String) = client().openSession(id)

    fun closeSession() = client().closeSession()

    fun sendPrompt() = client().sendPrompt()

    fun sendPrompt(text: String, images: List<AttachedImage>? = null): Boolean = client().sendPrompt(text, images)

    val usage: StateFlow<JSONObject?> get() = client().usage

    fun fetchUsage() = client().fetchUsage()

    val settings: StateFlow<JSONObject?> get() = client().settings

    fun fetchSettings() = client().fetchSettings()

    fun updateSettings(patch: JSONObject) = client().updateSettings(patch)

    fun updateSetting(key: String, value: Any?) = client().updateSetting(key, value)

    fun abort() = client().abort()

    fun unpair() = client().unpair()

    override fun onCleared() {
        super.onCleared()
    }
}
