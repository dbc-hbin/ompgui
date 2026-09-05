package com.dbchbin.ompgui.remote.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import com.dbchbin.ompgui.remote.net.ConnectionState
import com.dbchbin.ompgui.remote.net.RelayClient
import com.dbchbin.ompgui.remote.relay.AttachedImage
import com.dbchbin.ompgui.remote.relay.DisplayMessage
import com.dbchbin.ompgui.remote.relay.EventProjector
import com.dbchbin.ompgui.remote.relay.ModelRef
import com.dbchbin.ompgui.remote.relay.RelayAgent
import com.dbchbin.ompgui.remote.relay.RelayArchive
import com.dbchbin.ompgui.remote.relay.RelayAuthProvider
import com.dbchbin.ompgui.remote.relay.RelayBranch
import com.dbchbin.ompgui.remote.relay.RelayExport
import com.dbchbin.ompgui.remote.relay.RelayFileContent
import com.dbchbin.ompgui.remote.relay.RelayFileEntry
import com.dbchbin.ompgui.remote.relay.RelayFileMatch
import com.dbchbin.ompgui.remote.relay.RelayGitFile
import com.dbchbin.ompgui.remote.relay.RelayGitDiff
import com.dbchbin.ompgui.remote.relay.RelayMcp
import com.dbchbin.ompgui.remote.relay.RelayModelOption
import com.dbchbin.ompgui.remote.relay.RelayPlugin
import com.dbchbin.ompgui.remote.relay.RelayProject
import com.dbchbin.ompgui.remote.relay.RelaySkill
import com.dbchbin.ompgui.remote.relay.RelaySkillResult
import com.dbchbin.ompgui.remote.relay.RelaySlashCommand
import com.dbchbin.ompgui.remote.relay.RelayWorktree
import com.dbchbin.ompgui.remote.relay.SessionListItem
import com.dbchbin.ompgui.remote.relay.SubagentChip
import com.dbchbin.ompgui.remote.relay.TodoPhase
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
    val projects: List<RelayProject> = emptyList(),
    val files: List<RelayFileEntry> = emptyList(),
    val filesPath: String = "",
    val slashCommands: List<RelaySlashCommand> = emptyList(),
    val todos: List<TodoPhase> = emptyList(),
    val subagents: List<SubagentChip> = emptyList(),
    val contextFraction: Double? = null,
    val sessionThinkingLevel: String? = null,
    val sessionCwd: String? = null,
    val creatingSession: Boolean = false,
    val fileContent: RelayFileContent? = null,
    val archives: List<RelayArchive> = emptyList(),
    val worktrees: List<RelayWorktree> = emptyList(),
    val worktreesCwd: String = "",
    val worktreesGit: Boolean = false,
    val currentWorktreePath: String? = null,
    val gitStatusCwd: String = "",
    val gitIsRepo: Boolean = false,
    val gitRoot: String? = null,
    val gitFiles: List<RelayGitFile> = emptyList(),
    val gitDiff: RelayGitDiff? = null,
    val branches: List<RelayBranch> = emptyList(),
    val branchLeafId: String? = null,
    val exportResult: RelayExport? = null,
    val skills: List<RelaySkill> = emptyList(),
    val plugins: List<RelayPlugin> = emptyList(),
    val mcp: List<RelayMcp> = emptyList(),
    val skillResults: List<RelaySkillResult> = emptyList(),
    val skillSearchQuery: String = "",
    val agents: List<RelayAgent> = emptyList(),
    val authProviders: List<RelayAuthProvider> = emptyList(),
    val fileMatches: List<RelayFileMatch> = emptyList(),
    val fileMatchQuery: String = "",
    val extensionDialogs: List<EventProjector.ChatExtensionRequest> = emptyList(),
    val chatNotices: List<EventProjector.ChatNotice> = emptyList(),
    val extensionStatus: Map<String, String> = emptyMap(),
    val extensionWidgets: Map<String, List<String>> = emptyMap(),
    val queue: EventProjector.ChatQueue = EventProjector.ChatQueue(),
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

    val uiState: StateFlow<RemoteUiState> get() = client().uiState

    fun setPairingUri(value: String) = client().setPairingUri(value)

    fun setPassword(value: String) = client().setPassword(value)

    fun setDraft(value: String) = client().setDraft(value)

    fun dismissChatNotice(id: String) = client().dismissChatNotice(id)

    fun dismissExtensionDialog(id: String) = client().dismissExtensionDialog(id)

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

    fun fetchProjects() = client().fetchProjects()

    fun fetchSlash() = client().fetchSlash()

    fun fetchFiles(path: String? = null) = client().fetchFiles(path)

    fun createSession(
        cwd: String,
        message: String? = null,
        provider: String? = null,
        modelId: String? = null,
        thinkingLevel: String? = null,
    ) = client().createSession(cwd, message, provider, modelId, thinkingLevel)

    fun setSessionThinkingLevel(level: String) = client().setSessionThinkingLevel(level)

    fun compactSession() = client().compactSession()

    fun readFile(path: String) = client().readFile(path)

    fun clearFileContent() = client().clearFileContent()

    fun deleteSession(id: String) = client().deleteSession(id)

    fun archiveSession(id: String) = client().archiveSession(id)

    fun renameSession(id: String, name: String) = client().renameSession(id, name)

    fun fetchArchives() = client().fetchArchives()

    fun restoreArchive(key: String) = client().restoreArchive(key)

    fun fetchWorktrees(cwd: String) = client().fetchWorktrees(cwd)

    fun addWorktree(cwd: String, branch: String) = client().addWorktree(cwd, branch)

    fun writeFile(path: String, text: String) = client().writeFile(path, text)

    fun fetchGitStatus(cwd: String) = client().fetchGitStatus(cwd)

    fun fetchGitDiff(cwd: String, path: String) = client().fetchGitDiff(cwd, path)

    fun fetchBranches(id: String) = client().fetchBranches(id)

    fun setLeaf(id: String, leafId: String) = client().setLeaf(id, leafId)

    fun exportSession(id: String) = client().exportSession(id)

    fun clearExport() = client().clearExport()

    fun clearGitDiff() = client().clearGitDiff()

    fun fetchSkills(cwd: String) = client().fetchSkills(cwd)

    fun toggleSkill(cwd: String, filePath: String, disable: Boolean) =
        client().toggleSkill(cwd, filePath, disable)

    fun fetchPlugins(cwd: String) = client().fetchPlugins(cwd)

    fun pluginAction(cwd: String, action: String, source: String? = null, scope: String? = null) =
        client().pluginAction(cwd, action, source, scope)

    fun fetchMcp(cwd: String? = null) = client().fetchMcp(cwd)

    fun deleteMcp(cwd: String, name: String) = client().deleteMcp(cwd, name)

    fun upsertMcp(
        cwd: String,
        name: String,
        type: String,
        command: String? = null,
        url: String? = null,
        args: List<String>? = null,
    ) = client().upsertMcp(cwd, name, type, command, url, args)

    fun importSession(fileName: String, content: String) = client().importSession(fileName, content)

    fun searchSkills(query: String, limit: Int = 10) = client().searchSkills(query, limit)

    fun installSkill(pkg: String, scope: String, cwd: String?) = client().installSkill(pkg, scope, cwd)

    fun fetchAgents(cwd: String?) = client().fetchAgents(cwd)

    fun saveAgent(
        name: String,
        description: String,
        systemPrompt: String,
        scope: String,
        cwd: String?,
    ) = client().saveAgent(name, description, systemPrompt, scope, cwd)

    fun deleteAgent(name: String, scope: String, cwd: String?) = client().deleteAgent(name, scope, cwd)

    fun fetchAuthProviders() = client().fetchAuthProviders()

    fun searchFiles(cwd: String, query: String) = client().searchFiles(cwd, query)

    fun addProject(cwd: String) = client().addProject(cwd)

    fun removeProject(cwd: String) = client().removeProject(cwd)

    override fun onCleared() {
        super.onCleared()
    }
}
