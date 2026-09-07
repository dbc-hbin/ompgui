package com.dbchbin.ompgui.remote.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.dbchbin.ompgui.remote.net.ConnectionState
import com.dbchbin.ompgui.remote.net.RelayClient
import com.dbchbin.ompgui.remote.relay.RelayMessageQueue
import com.dbchbin.ompgui.remote.relay.RelayRecalledDraft
import com.dbchbin.ompgui.remote.relay.AttachmentSource
import com.dbchbin.ompgui.remote.relay.DisplayMessage
import com.dbchbin.ompgui.remote.relay.EventProjector
import com.dbchbin.ompgui.remote.relay.ModelRef
import com.dbchbin.ompgui.remote.relay.RelayArchive
import com.dbchbin.ompgui.remote.relay.RelayBranch
import com.dbchbin.ompgui.remote.relay.RelayFileMatch
import com.dbchbin.ompgui.remote.relay.RelayModelOption
import com.dbchbin.ompgui.remote.relay.RelayProject
import com.dbchbin.ompgui.remote.relay.RelaySlashCommand
import com.dbchbin.ompgui.remote.relay.RelayWorktree
import com.dbchbin.ompgui.remote.relay.SessionListItem
import com.dbchbin.ompgui.remote.relay.SubagentChip
import com.dbchbin.ompgui.remote.relay.TodoPhase
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
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
    val projects: List<RelayProject> = emptyList(),
    val filesPath: String = "",
    val slashCommands: List<RelaySlashCommand> = emptyList(),
    val todos: List<TodoPhase> = emptyList(),
    val subagents: List<SubagentChip> = emptyList(),
    val contextFraction: Double? = null,
    val sessionThinkingLevel: String? = null,
    val sessionCwd: String? = null,
    val creatingSession: Boolean = false,
    val archives: List<RelayArchive> = emptyList(),
    val worktrees: List<RelayWorktree> = emptyList(),
    val worktreesGit: Boolean = false,
    /** Local owner for worktrees.list/add — never the global session banner. */
    val worktreesError: String? = null,
    val branches: List<RelayBranch> = emptyList(),
    val branchLeafId: String? = null,
    val fileMatches: List<RelayFileMatch> = emptyList(),
    val extensionDialogs: List<EventProjector.ChatExtensionRequest> = emptyList(),
    val chatNotices: List<EventProjector.ChatNotice> = emptyList(),
    val extensionStatus: Map<String, String> = emptyMap(),
    val extensionWidgets: Map<String, List<String>> = emptyMap(),
    val messageQueue: RelayMessageQueue = RelayMessageQueue(),
    val queueOperationPending: Boolean = false,
    val recalledDraft: RelayRecalledDraft? = null,
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

    val requester = com.dbchbin.ompgui.remote.relay.RelayRequester { domain, action, args ->
        client().request(domain, action, args)
    }

    private val removedProjects = mutableSetOf<String>()
    private val projectRemoval = Mutex()
    private val _uiState = MutableStateFlow(client().uiState.value)
    val uiState: StateFlow<RemoteUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            var previousProjects = client().uiState.value.projects
            client().uiState.collect { state ->
                // Unrelated state updates must not replace the correlated project
                // refresh with the client's older cached list.
                if (!state.paired) removedProjects.clear()
                val projects = if (state.paired && state.projects == previousProjects) _uiState.value.projects else state.projects
                previousProjects = state.projects
                _uiState.value = if (removedProjects.isEmpty() && projects == state.projects) state else state.copy(
                    projects = projects.filterNot { it.path in removedProjects },
                    sessions = state.sessions.filterNot { (it.projectRoot ?: it.cwd) in removedProjects },
                )
            }
        }
    }

    fun setPairingUri(value: String) = client().setPairingUri(value)

    fun setPassword(value: String) = client().setPassword(value)

    fun setDraft(value: String) = client().setDraft(value)

    fun dismissChatNotice(id: String) = client().dismissChatNotice(id)

    fun dismissExtensionDialog(id: String) = client().dismissExtensionDialog(id)

    fun consumePairingUri(raw: String?, autoConnect: Boolean = false) =
        client().consumePairingUri(raw, autoConnect)

    fun getServerUrl(): String = client().getServerUrl()

    fun getDeviceId(): String = client().getDeviceId()

    fun pair() = client().pair()

    fun refreshSessions() = client().refreshSessions()

    fun openModelPicker() = client().openModelPicker()

    fun closeModelPicker() = client().closeModelPicker()

    fun setModel(option: RelayModelOption) = client().setModel(option)

    fun openSession(id: String) = client().openSession(id)

    fun openFork(id: String, text: String, images: List<com.dbchbin.ompgui.remote.relay.AttachedImage>) = client().openFork(id, text, images)

    fun closeSession() = client().closeSession()

    fun refreshMessageQueue() = client().refreshMessageQueue()

    suspend fun recallQueuedMessage(id: String): Boolean = client().recallQueuedMessage(id)

    fun deleteQueuedMessage(id: String) = client().deleteQueuedMessage(id)

    fun promoteQueuedMessage(id: String) = client().promoteQueuedMessage(id)

    fun consumeRecalledDraft(id: String) = client().consumeRecalledDraft(id)

    fun sendPrompt() = client().sendPrompt()

    suspend fun sendPrompt(
        text: String,
        images: List<AttachmentSource> = emptyList(),
        commandType: String = "prompt",
    ): Boolean = client().sendPrompt(text, images, commandType)

    val usage: StateFlow<JSONObject?> get() = client().usage

    fun fetchUsage() = client().fetchUsage()

    val settings: StateFlow<JSONObject?> get() = client().settings

    fun abort() = client().abort()

    fun unpair() = client().unpair()

    fun fetchProjects() = client().fetchProjects()

    fun fetchSlash() = client().fetchSlash()

    fun setSessionThinkingLevel(level: String) = client().setSessionThinkingLevel(level)

    fun fetchArchives() = client().fetchArchives()

    fun restoreArchive(key: String) = client().restoreArchive(key)

    fun fetchWorktrees(cwd: String) = client().fetchWorktrees(cwd)

    fun addWorktree(cwd: String, branch: String) = client().addWorktree(cwd, branch)

    fun fetchBranches(id: String) = client().fetchBranches(id)

    fun setLeaf(id: String, leafId: String) = client().setLeaf(id, leafId)

    fun searchFiles(cwd: String, query: String) = client().searchFiles(cwd, query)

    fun addProject(cwd: String) {
        removedProjects.remove(cwd.trim())
        client().addProject(cwd)
    }

    suspend fun removeProject(cwd: String) {
        // Keep acknowledgement/state reconciliation alive if the list leaves composition.
        viewModelScope.async {
            val directory = cwd.trim()
            require(directory.isNotEmpty()) { "Project path is required" }
            check(projectRemoval.tryLock()) { "A project removal is already in progress" }
            try {
                if (directory !in removedProjects) {
                    val result = requester.request("sessions", "projects.remove", JSONObject().put("cwd", directory))
                    val entries = result.getJSONArray("projects")
                    val projects = List(entries.length()) { index ->
                        val entry = entries.getJSONObject(index)
                        RelayProject(
                            path = entry.getString("path"),
                            name = entry.getString("name"),
                            addedAt = entry.optString("addedAt").takeIf { it.isNotBlank() && it != "null" },
                        )
                    }
                    removedProjects.add(directory)
                    removedProjects.add(result.getString("path"))
                    _uiState.update { state ->
                        state.copy(
                            projects = projects.filterNot { it.path in removedProjects },
                            sessions = state.sessions.filterNot { (it.projectRoot ?: it.cwd) in removedProjects },
                        )
                    }
                    client().fetchProjects()
                    client().refreshSessions()
                }
            } finally {
                projectRemoval.unlock()
            }
        }.await()
    }
}
