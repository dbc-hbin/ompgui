package com.dbchbin.ompgui.remote.relay

import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CodingErrorAction
import java.util.Base64
import java.util.UUID

object RelayProtocol {
    const val VERSION = 1
    const val MAX_FRAME_BYTES = 256 * 1024
    const val MAX_CHUNK_BYTES = 48 * 1024
    const val MAX_CHUNKS = 342
    const val MAX_LOGICAL_BYTES = 16 * 1024 * 1024
    const val MAX_TRANSFERS = 4
    const val CHUNK_DEADLINE_MS = 30_000L
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

    data class Request(val req: Int, val domain: String, val action: String, val args: JSONObject) : ClientFrame()

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
        val level: String? = null,
    ) : ClientFrame()
    data object Usage : ClientFrame()
    data object SettingsGet : ClientFrame()
    data class SettingsUpdate(val settings: JSONObject) : ClientFrame()
    data object ProjectsList : ClientFrame()
    data object SlashList : ClientFrame()
    data class FilesList(val path: String? = null) : ClientFrame()
    data class SessionCreate(
        val cwd: String,
        val message: String? = null,
        val provider: String? = null,
        val modelId: String? = null,
        val thinkingLevel: String? = null,
    ) : ClientFrame()
    data class FilesRead(val path: String) : ClientFrame()
    data class SessionDelete(val id: String) : ClientFrame()
    data class SessionArchive(val id: String) : ClientFrame()
    data class SessionRename(val id: String, val name: String) : ClientFrame()
    data object ArchivesList : ClientFrame()
    data class SessionRestore(val key: String) : ClientFrame()
    data class WorktreesList(val cwd: String) : ClientFrame()
    data class WorktreesAdd(val cwd: String, val branch: String) : ClientFrame()
    data class FilesWrite(val path: String, val text: String) : ClientFrame()
    data class GitStatus(val cwd: String) : ClientFrame()
    data class GitDiff(val cwd: String, val path: String) : ClientFrame()
    data class SessionBranches(val id: String) : ClientFrame()
    data class SessionLeaf(val id: String, val leafId: String) : ClientFrame()
    data class SessionExport(val id: String) : ClientFrame()
    data class SkillsList(val cwd: String) : ClientFrame()
    data class SkillsToggle(val cwd: String, val filePath: String, val disableModelInvocation: Boolean) : ClientFrame()
    data class PluginsList(val cwd: String) : ClientFrame()
    data class PluginsAction(val cwd: String, val action: String, val source: String? = null, val scope: String? = null) : ClientFrame()
    data class McpList(val cwd: String? = null) : ClientFrame()
    data class McpDelete(val cwd: String, val name: String) : ClientFrame()
    data class McpUpsert(
        val cwd: String,
        val name: String,
        val type: String,
        val command: String? = null,
        val url: String? = null,
        val args: List<String>? = null,
    ) : ClientFrame()
    data class SessionImport(val fileName: String, val content: String) : ClientFrame()
    data class SkillsSearch(val query: String, val limit: Int = 10) : ClientFrame()
    data class SkillsInstall(val pkg: String, val scope: String, val cwd: String? = null) : ClientFrame()
    data class AgentsList(val cwd: String? = null) : ClientFrame()
    data class AgentsSave(
        val name: String,
        val description: String,
        val systemPrompt: String,
        val scope: String,
        val cwd: String? = null,
    ) : ClientFrame()
    data class AgentsDelete(val name: String, val scope: String, val cwd: String? = null) : ClientFrame()
    data object AuthProviders : ClientFrame()
    data class FilesIndex(val cwd: String, val query: String) : ClientFrame()
    data class ProjectsAdd(val cwd: String) : ClientFrame()
    data class ProjectsRemove(val cwd: String) : ClientFrame()
}

sealed class ServerFrame {
    data class Result(val req: Int, val success: Boolean, val data: JSONObject?, val error: JSONObject?) : ServerFrame()
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
    data class SessionCreated(val id: String, val cwd: String) : ServerFrame()
    data class Projects(val projects: List<RelayProject>) : ServerFrame()
    data class Files(val path: String, val entries: List<RelayFileEntry>) : ServerFrame()
    data class Slash(val commands: List<RelaySlashCommand>) : ServerFrame()
    data class FileContent(val file: RelayFileContent) : ServerFrame()
    data class SessionDeleted(val id: String) : ServerFrame()
    data class SessionArchived(val id: String) : ServerFrame()
    data class SessionRenamed(val id: String, val name: String) : ServerFrame()
    data class SessionRestored(val id: String) : ServerFrame()
    data class Archives(val archives: List<RelayArchive>) : ServerFrame()
    data class Worktrees(
        val cwd: String,
        val projectRoot: String,
        val isGit: Boolean,
        val currentWorktreePath: String?,
        val worktrees: List<RelayWorktree>,
    ) : ServerFrame()
    data class WorktreeAdded(val path: String, val branch: String) : ServerFrame()
    data class FileWritten(val path: String, val bytes: Long) : ServerFrame()
    data class GitStatusResult(
        val cwd: String,
        val isGitRepository: Boolean,
        val repositoryRoot: String?,
        val files: List<RelayGitFile>,
    ) : ServerFrame()
    data class GitDiffResult(val diff: RelayGitDiff) : ServerFrame()
    data class Branches(val id: String, val leafId: String?, val branches: List<RelayBranch>) : ServerFrame()
    data class SessionExported(val export: RelayExport) : ServerFrame()
    data class Skills(val cwd: String, val skills: List<RelaySkill>) : ServerFrame()
    data class SkillUpdated(val filePath: String, val disableModelInvocation: Boolean) : ServerFrame()
    data class Plugins(val cwd: String, val packages: List<RelayPlugin>) : ServerFrame()
    data class Mcp(val inventory: List<RelayMcp>) : ServerFrame()
    data class McpDeleted(val name: String) : ServerFrame()
    data class McpUpserted(val name: String) : ServerFrame()
    data class SessionImported(val id: String, val cwd: String) : ServerFrame()
    data class SkillResults(val query: String, val results: List<RelaySkillResult>) : ServerFrame()
    data class SkillInstalled(val pkg: String, val scope: String) : ServerFrame()
    data class Agents(val cwd: String?, val agents: List<RelayAgent>) : ServerFrame()
    data class AgentSaved(val name: String, val filePath: String?) : ServerFrame()
    data class AgentDeleted(val name: String) : ServerFrame()
    data class AuthProvidersResult(val providers: List<RelayAuthProvider>) : ServerFrame()
    data class FilesIndexResult(val cwd: String, val query: String, val matches: List<RelayFileMatch>) : ServerFrame()
    data class ProjectAdded(val path: String, val name: String?) : ServerFrame()
    data class ProjectRemoved(val path: String) : ServerFrame()
}

data class RelayGitFile(val filePath: String, val status: String, val code: String)

data class RelayGitDiff(
    val path: String,
    val supported: Boolean,
    val status: String? = null,
    val patch: String? = null,
    val truncated: Boolean = false,
)

data class RelayBranch(val id: String, val label: String, val role: String? = null)

data class RelayExport(
    val id: String,
    val fileName: String,
    val bytes: Long,
    val path: String? = null,
    val html: String? = null,
)

data class RelaySkill(
    val name: String,
    val description: String,
    val filePath: String,
    val disableModelInvocation: Boolean,
    val scope: String? = null,
)

data class RelayPluginCounts(
    val extensions: Int = 0,
    val skills: Int = 0,
    val prompts: Int = 0,
    val themes: Int = 0,
)

data class RelayPlugin(
    val source: String,
    val scope: String,
    val status: String,
    val disabled: Boolean,
    val version: String? = null,
    val counts: RelayPluginCounts? = null,
)

data class RelayMcp(
    val name: String,
    val source: String,
    val status: String,
    val type: String? = null,
    val enabled: Boolean? = null,
)

data class RelayProject(val path: String, val name: String, val addedAt: String? = null)

data class RelaySkillResult(
    val packageName: String,
    val installs: String? = null,
    val url: String? = null,
)

data class RelayAgent(
    val name: String,
    val description: String,
    val source: String,
    val filePath: String? = null,
    val systemPrompt: String? = null,
    val disabled: Boolean = false,
)

data class RelayAuthProvider(
    val id: String,
    val name: String,
    val loggedIn: Boolean,
)

data class RelayFileMatch(
    val path: String,
    val isDir: Boolean = false,
)

data class RelayFileEntry(val name: String, val path: String, val dir: Boolean)

data class RelaySlashCommand(val name: String, val requiresArgs: Boolean, val hint: String)

data class TodoItem(val content: String, val status: String)

data class TodoPhase(val name: String, val tasks: List<TodoItem>)

data class SubagentChip(
    val id: String,
    val agent: String,
    val status: String,
    val task: String,
)

data class RelayArchive(val key: String, val name: String? = null, val id: String? = null, val archivedAt: String? = null)

data class RelayWorktree(val path: String, val branch: String? = null, val isMain: Boolean = false)

data class RelayFileContent(
    val path: String,
    val name: String,
    val language: String? = null,
    val text: String? = null,
    val truncated: Boolean = false,
    val bytes: Long? = null,
    val mime: String? = null,
    val encoding: String? = null,
)

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
        is ClientFrame.Request -> {
            require(req > 0) { "request.req must be positive" }
            require(domain in setOf("files", "sessions", "models", "extensions", "system")) { "Invalid request domain" }
            require(action.isNotBlank()) { "request.action is required" }
            json.put("op", "request").put("req", req).put("domain", domain).put("action", action).put("args", args)
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
        is ClientFrame.ProjectsList -> json.put("op", "projects.list")
        is ClientFrame.SlashList -> json.put("op", "slash.list")
        is ClientFrame.FilesList -> {
            json.put("op", "files.list")
            val directory = path?.trim()
            if (!directory.isNullOrEmpty()) json.put("path", directory.take(1024))
        }
        is ClientFrame.SessionCreate -> {
            val directory = cwd.trim()
            require(directory.isNotEmpty()) { "cwd is required" }
            json.put("op", "session.create")
            json.put("cwd", directory.take(1024))
            message?.trim()?.takeIf { it.isNotEmpty() }?.let { json.put("message", it.take(RelayProtocol.MAX_PROMPT_CHARS)) }
            provider?.trim()?.takeIf { it.isNotEmpty() }?.let { json.put("provider", it) }
            modelId?.trim()?.takeIf { it.isNotEmpty() }?.let { json.put("modelId", it) }
            thinkingLevel?.trim()?.takeIf { it.isNotEmpty() }?.let { json.put("thinkingLevel", it) }
        }
        is ClientFrame.FilesRead -> {
            val filePath = path.trim()
            require(filePath.isNotEmpty()) { "path is required" }
            json.put("op", "files.read")
            json.put("path", filePath.take(1024))
        }
        is ClientFrame.SessionDelete -> {
            val sessionId = id.trim()
            require(RelayProtocol.SESSION_ID.matches(sessionId)) { "Invalid session id" }
            json.put("op", "session.delete")
            json.put("id", sessionId)
        }
        is ClientFrame.SessionArchive -> {
            val sessionId = id.trim()
            require(RelayProtocol.SESSION_ID.matches(sessionId)) { "Invalid session id" }
            json.put("op", "session.archive")
            json.put("id", sessionId)
        }
        is ClientFrame.SessionRename -> {
            val sessionId = id.trim()
            val title = name.trim()
            require(RelayProtocol.SESSION_ID.matches(sessionId)) { "Invalid session id" }
            require(title.isNotEmpty()) { "name is required" }
            json.put("op", "session.rename")
            json.put("id", sessionId)
            json.put("name", title.take(200))
        }
        is ClientFrame.ArchivesList -> json.put("op", "sessions.archives")
        is ClientFrame.SessionRestore -> {
            val archiveKey = key.trim()
            require(archiveKey.isNotEmpty()) { "archive key is required" }
            json.put("op", "session.restore")
            json.put("key", archiveKey.take(1024))
        }
        is ClientFrame.WorktreesList -> {
            val directory = cwd.trim()
            require(directory.isNotEmpty()) { "cwd is required" }
            json.put("op", "worktrees.list")
            json.put("cwd", directory.take(1024))
        }
        is ClientFrame.WorktreesAdd -> {
            val directory = cwd.trim()
            val branchName = branch.trim()
            require(directory.isNotEmpty()) { "cwd is required" }
            require(branchName.isNotEmpty()) { "branch is required" }
            json.put("op", "worktrees.add")
            json.put("cwd", directory.take(1024))
            json.put("branch", branchName.take(128))
        }
        is ClientFrame.FilesWrite -> {
            val filePath = path.trim()
            require(filePath.isNotEmpty()) { "path is required" }
            json.put("op", "files.write")
            json.put("path", filePath.take(1024))
            json.put("text", text)
        }
        is ClientFrame.GitStatus -> {
            val directory = cwd.trim()
            require(directory.isNotEmpty()) { "cwd is required" }
            json.put("op", "git.status")
            json.put("cwd", directory.take(1024))
        }
        is ClientFrame.GitDiff -> {
            val directory = cwd.trim()
            val filePath = path.trim()
            require(directory.isNotEmpty()) { "cwd is required" }
            require(filePath.isNotEmpty()) { "path is required" }
            json.put("op", "git.diff")
            json.put("cwd", directory.take(1024))
            json.put("path", filePath.take(1024))
        }
        is ClientFrame.SessionBranches -> {
            val sessionId = id.trim()
            require(RelayProtocol.SESSION_ID.matches(sessionId)) { "Invalid session id" }
            json.put("op", "session.branches")
            json.put("id", sessionId)
        }
        is ClientFrame.SessionLeaf -> {
            val sessionId = id.trim()
            val leaf = leafId.trim()
            require(RelayProtocol.SESSION_ID.matches(sessionId)) { "Invalid session id" }
            require(leaf.isNotEmpty()) { "leafId is required" }
            json.put("op", "session.leaf")
            json.put("id", sessionId)
            json.put("leafId", leaf.take(200))
        }
        is ClientFrame.SessionExport -> {
            val sessionId = id.trim()
            require(RelayProtocol.SESSION_ID.matches(sessionId)) { "Invalid session id" }
            json.put("op", "session.export")
            json.put("id", sessionId)
        }
        is ClientFrame.SkillsList -> {
            val directory = cwd.trim()
            require(directory.isNotEmpty()) { "cwd is required" }
            json.put("op", "skills.list")
            json.put("cwd", directory.take(1024))
        }
        is ClientFrame.SkillsToggle -> {
            val directory = cwd.trim()
            val skillPath = filePath.trim()
            require(directory.isNotEmpty()) { "cwd is required" }
            require(skillPath.isNotEmpty()) { "filePath is required" }
            json.put("op", "skills.toggle")
            json.put("cwd", directory.take(1024))
            json.put("filePath", skillPath.take(1024))
            json.put("disableModelInvocation", disableModelInvocation)
        }
        is ClientFrame.PluginsList -> {
            val directory = cwd.trim()
            require(directory.isNotEmpty()) { "cwd is required" }
            json.put("op", "plugins.list")
            json.put("cwd", directory.take(1024))
        }
        is ClientFrame.PluginsAction -> {
            val directory = cwd.trim()
            val pluginAction = action.trim()
            require(directory.isNotEmpty()) { "cwd is required" }
            require(pluginAction in setOf("install", "remove", "update", "disable", "enable")) {
                "plugin action is required"
            }
            val pluginSource = source?.trim().orEmpty()
            if (pluginAction != "update") {
                require(pluginSource.isNotEmpty()) { "source is required" }
            }
            require(pluginSource.length <= 512) { "source is too long" }
            json.put("op", "plugins.action")
            json.put("cwd", directory.take(1024))
            json.put("action", pluginAction)
            if (pluginSource.isNotEmpty()) json.put("source", pluginSource.take(512))
            scope?.trim()?.takeIf { it.isNotEmpty() }?.let {
                require(it == "global" || it == "project") { "scope must be global or project" }
                json.put("scope", it)
            }
        }
        is ClientFrame.McpList -> {
            json.put("op", "mcp.list")
            val directory = cwd?.trim()
            if (!directory.isNullOrEmpty()) json.put("cwd", directory.take(1024))
        }
        is ClientFrame.McpDelete -> {
            val directory = cwd.trim()
            val serverName = name.trim()
            require(directory.isNotEmpty()) { "cwd is required" }
            require(serverName.isNotEmpty()) { "name is required" }
            json.put("op", "mcp.delete")
            json.put("cwd", directory.take(1024))
            json.put("name", serverName.take(128))
        }
        is ClientFrame.McpUpsert -> {
            val directory = cwd.trim()
            val serverName = name.trim()
            val serverType = type.trim()
            require(directory.isNotEmpty()) { "cwd is required" }
            require(serverName.isNotEmpty()) { "name is required" }
            require(serverType in setOf("stdio", "http", "sse")) { "type must be stdio, http, or sse" }
            json.put("op", "mcp.upsert")
            json.put("cwd", directory.take(1024))
            json.put("name", serverName.take(128))
            json.put("type", serverType)
            command?.trim()?.takeIf { it.isNotEmpty() }?.let { json.put("command", it.take(1024)) }
            url?.trim()?.takeIf { it.isNotEmpty() }?.let { json.put("url", it.take(2048)) }
            if (!args.isNullOrEmpty()) {
                val array = JSONArray()
                for (arg in args) array.put(arg.take(1024))
                json.put("args", array)
            }
        }
        is ClientFrame.SessionImport -> {
            val name = fileName.trim()
            require(name.isNotEmpty()) { "fileName is required" }
            json.put("op", "session.import")
            json.put("fileName", name.take(200))
            json.put("content", content)
        }
        is ClientFrame.SkillsSearch -> {
            val text = query.trim()
            require(text.isNotEmpty()) { "query is required" }
            json.put("op", "skills.search")
            json.put("query", text.take(200))
            json.put("limit", limit.coerceIn(1, 20))
        }
        is ClientFrame.SkillsInstall -> {
            val packageName = pkg.trim()
            val installScope = scope.trim()
            require(packageName.isNotEmpty()) { "package is required" }
            require(installScope == "global" || installScope == "project") { "scope must be global or project" }
            json.put("op", "skills.install")
            json.put("package", packageName.take(256))
            json.put("scope", installScope)
            val directory = cwd?.trim()
            if (!directory.isNullOrEmpty()) json.put("cwd", directory.take(1024))
        }
        is ClientFrame.AgentsList -> {
            json.put("op", "agents.list")
            val directory = cwd?.trim()
            if (!directory.isNullOrEmpty()) json.put("cwd", directory.take(1024))
        }
        is ClientFrame.AgentsSave -> {
            val agentName = name.trim()
            val agentScope = scope.trim()
            require(agentName.isNotEmpty()) { "name is required" }
            require(agentScope == "user" || agentScope == "project") { "scope must be user or project" }
            json.put("op", "agents.save")
            json.put("name", agentName.take(64))
            json.put("description", description.trim().take(500))
            require(systemPrompt.length <= 20_000) { "systemPrompt is too long" }
            json.put("systemPrompt", systemPrompt)
            json.put("scope", agentScope)
            val directory = cwd?.trim()
            if (!directory.isNullOrEmpty()) json.put("cwd", directory.take(1024))
        }
        is ClientFrame.AgentsDelete -> {
            val agentName = name.trim()
            val agentScope = scope.trim()
            require(agentName.isNotEmpty()) { "name is required" }
            require(agentScope == "user" || agentScope == "project") { "scope must be user or project" }
            json.put("op", "agents.delete")
            json.put("name", agentName.take(64))
            json.put("scope", agentScope)
            val directory = cwd?.trim()
            if (!directory.isNullOrEmpty()) json.put("cwd", directory.take(1024))
        }
        is ClientFrame.AuthProviders -> json.put("op", "auth.providers")
        is ClientFrame.FilesIndex -> {
            val directory = cwd.trim()
            val text = query.trim()
            require(directory.isNotEmpty()) { "cwd is required" }
            require(text.isNotEmpty()) { "query is required" }
            json.put("op", "files.index")
            json.put("cwd", directory.take(1024))
            json.put("query", text.take(100))
        }
        is ClientFrame.ProjectsAdd -> {
            val directory = cwd.trim()
            require(directory.isNotEmpty()) { "cwd is required" }
            json.put("op", "projects.add")
            json.put("cwd", directory.take(1024))
        }
        is ClientFrame.ProjectsRemove -> {
            val directory = cwd.trim()
            require(directory.isNotEmpty()) { "cwd is required" }
            json.put("op", "projects.remove")
            json.put("cwd", directory.take(1024))
        }
        is ClientFrame.Cmd -> {
            require(req >= 1) { "cmd.req must be a positive integer" }
            val command = type.trim()
            require(command in setOf(
                "prompt",
                "abort",
                "get_state",
                "set_model",
                "set_thinking_level",
                "compact",
                "get_subagents",
                "get_available_commands",
            )) {
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
                "set_thinking_level" -> {
                    val levelName = level?.trim()
                    require(!levelName.isNullOrEmpty()) { "set_thinking_level requires level" }
                    json.put("level", levelName)
                }
            }
        }
    }
    val encoded = json.toString()
    require(utf8Size(encoded) <= RelayProtocol.MAX_LOGICAL_BYTES) { "Frame is too large" }
    return encoded
}

fun parseServerFrame(raw: String): ServerFrame? {
    if (raw.isEmpty() || utf8Size(raw) > RelayProtocol.MAX_FRAME_BYTES) return null
    return parseLogicalServerFrame(raw)
}

private fun parseLogicalServerFrame(raw: String): ServerFrame? {
    val parsed = try {
        JSONObject(raw)
    } catch (_: Exception) {
        return null
    }
    return when (parsed.optString("op", "")) {
        "result" -> {
            val req = strictInteger(parsed.opt("req")) ?: return null
            if (req < 1) return null
            val success = parsed.opt("success") as? Boolean ?: return null
            val data = parsed.opt("data") as? JSONObject
            val error = parsed.opt("error") as? JSONObject
            if (success) {
                if (data == null || parsed.has("error")) return null
            } else {
                if (error == null || parsed.has("data")) return null
                if (error.opt("code") !is String || error.opt("message") !is String) return null
            }
            ServerFrame.Result(req, success, data, error)
        }
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
            val raw = parsed.opt("data")
            val data = when (raw) {
                is JSONObject -> raw
                is JSONArray -> JSONObject().put("items", raw)
                else -> null
            }
            ServerFrame.CmdOk(req, data = data)
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
        "session.created" -> {
            val id = parsed.optString("id").trim()
            if (!RelayProtocol.SESSION_ID.matches(id)) return null
            ServerFrame.SessionCreated(id = id, cwd = parsed.optString("cwd"))
        }
        "projects" -> ServerFrame.Projects(parseProjects(parsed.optJSONArray("projects")))
        "files" -> ServerFrame.Files(
            path = parsed.optString("path"),
            entries = parseFileEntries(parsed.optJSONArray("entries")),
        )
        "slash" -> ServerFrame.Slash(parseSlash(parsed.optJSONArray("commands")))
        "file" -> {
            val path = parsed.optString("path").trim()
            val name = parsed.optString("name").trim().ifEmpty { path.substringAfterLast('/') }
            if (path.isEmpty()) return null
            ServerFrame.FileContent(
                RelayFileContent(
                    path = path,
                    name = name,
                    language = parsed.optString("language").trim().takeIf { it.isNotEmpty() },
                    text = parsed.optString("text").takeIf { parsed.has("text") },
                    truncated = parsed.optBoolean("truncated", false),
                    bytes = if (parsed.has("bytes")) parsed.optLong("bytes") else null,
                    mime = parsed.optString("mime").trim().takeIf { it.isNotEmpty() },
                    encoding = parsed.optString("encoding").trim().takeIf { it.isNotEmpty() },
                ),
            )
        }
        "session.deleted" -> {
            val id = parsed.optString("id").trim()
            if (!RelayProtocol.SESSION_ID.matches(id)) return null
            ServerFrame.SessionDeleted(id)
        }
        "session.archived" -> {
            val id = parsed.optString("id").trim()
            if (!RelayProtocol.SESSION_ID.matches(id)) return null
            ServerFrame.SessionArchived(id)
        }
        "session.renamed" -> {
            val id = parsed.optString("id").trim()
            if (!RelayProtocol.SESSION_ID.matches(id)) return null
            ServerFrame.SessionRenamed(id, parsed.optString("name"))
        }
        "session.restored" -> {
            val id = parsed.optString("id").trim()
            if (!RelayProtocol.SESSION_ID.matches(id)) return null
            ServerFrame.SessionRestored(id)
        }
        "archives" -> ServerFrame.Archives(parseArchives(parsed.optJSONArray("archives")))
        "worktrees" -> ServerFrame.Worktrees(
            cwd = parsed.optString("cwd"),
            projectRoot = parsed.optString("projectRoot"),
            isGit = parsed.optBoolean("isGit", false),
            currentWorktreePath = parsed.optString("currentWorktreePath").trim().takeIf { it.isNotEmpty() },
            worktrees = parseWorktrees(parsed.optJSONArray("worktrees")),
        )
        "worktree.added" -> ServerFrame.WorktreeAdded(
            path = parsed.optString("path"),
            branch = parsed.optString("branch"),
        )
        "file.written" -> ServerFrame.FileWritten(
            path = parsed.optString("path"),
            bytes = if (parsed.has("bytes")) parsed.optLong("bytes") else 0L,
        )
        "git.status" -> ServerFrame.GitStatusResult(
            cwd = parsed.optString("cwd"),
            isGitRepository = parsed.optBoolean("isGitRepository", false),
            repositoryRoot = parsed.optString("repositoryRoot").trim().takeIf { it.isNotEmpty() },
            files = parseGitFiles(parsed.optJSONArray("files")),
        )
        "git.diff" -> ServerFrame.GitDiffResult(
            RelayGitDiff(
                path = parsed.optString("path"),
                supported = parsed.optBoolean("supported", false),
                status = parsed.optString("status").trim().takeIf { it.isNotEmpty() },
                patch = parsed.optString("patch").takeIf { parsed.has("patch") },
                truncated = parsed.optBoolean("truncated", false),
            ),
        )
        "branches" -> {
            val id = parsed.optString("id").trim()
            if (!RelayProtocol.SESSION_ID.matches(id)) return null
            ServerFrame.Branches(
                id = id,
                leafId = parsed.optString("leafId").trim().takeIf { it.isNotEmpty() },
                branches = parseBranches(parsed.optJSONArray("branches")),
            )
        }
        "session.exported" -> {
            val id = parsed.optString("id").trim()
            if (!RelayProtocol.SESSION_ID.matches(id)) return null
            ServerFrame.SessionExported(
                RelayExport(
                    id = id,
                    fileName = parsed.optString("fileName").trim().ifEmpty { "$id.html" },
                    bytes = if (parsed.has("bytes")) parsed.optLong("bytes") else 0L,
                    path = parsed.optString("path").trim().takeIf { it.isNotEmpty() },
                    html = parsed.optString("html").takeIf { parsed.has("html") },
                ),
            )
        }
        "skills" -> ServerFrame.Skills(
            cwd = parsed.optString("cwd"),
            skills = parseSkills(parsed.optJSONArray("skills")),
        )
        "skill.updated" -> ServerFrame.SkillUpdated(
            filePath = parsed.optString("filePath"),
            disableModelInvocation = parsed.optBoolean("disableModelInvocation", false),
        )
        "plugins" -> ServerFrame.Plugins(
            cwd = parsed.optString("cwd"),
            packages = parsePlugins(parsed.optJSONArray("packages")),
        )
        "mcp" -> ServerFrame.Mcp(parseMcp(parsed.optJSONArray("inventory")))
        "mcp.deleted" -> ServerFrame.McpDeleted(name = parsed.optString("name"))
        "mcp.upserted" -> ServerFrame.McpUpserted(name = parsed.optString("name"))
        "session.imported" -> {
            val id = parsed.optString("id").trim()
            if (!RelayProtocol.SESSION_ID.matches(id)) return null
            ServerFrame.SessionImported(id = id, cwd = parsed.optString("cwd"))
        }
        "skill.results" -> ServerFrame.SkillResults(
            query = parsed.optString("query"),
            results = parseSkillResults(parsed.optJSONArray("results")),
        )
        "skill.installed" -> ServerFrame.SkillInstalled(
            pkg = parsed.optString("package"),
            scope = parsed.optString("scope"),
        )
        "agents" -> ServerFrame.Agents(
            cwd = parsed.optString("cwd").trim().takeIf { it.isNotEmpty() },
            agents = parseAgents(parsed.optJSONArray("agents")),
        )
        "agent.saved" -> ServerFrame.AgentSaved(
            name = parsed.optString("name"),
            filePath = parsed.optString("filePath").trim().takeIf { it.isNotEmpty() },
        )
        "agent.deleted" -> ServerFrame.AgentDeleted(name = parsed.optString("name"))
        "auth.providers" -> ServerFrame.AuthProvidersResult(
            providers = parseAuthProviders(parsed.optJSONArray("providers")),
        )
        "files.index" -> ServerFrame.FilesIndexResult(
            cwd = parsed.optString("cwd"),
            query = parsed.optString("query"),
            matches = parseFileMatches(parsed.optJSONArray("matches")),
        )
        "project.added" -> ServerFrame.ProjectAdded(
            path = parsed.optString("path"),
            name = parsed.optString("name").trim().takeIf { it.isNotEmpty() },
        )
        "project.removed" -> ServerFrame.ProjectRemoved(path = parsed.optString("path"))
        else -> null
    }
}

private fun parseSkillResults(array: JSONArray?): List<RelaySkillResult> {
    if (array == null) return emptyList()
    val out = ArrayList<RelaySkillResult>(array.length())
    for (i in 0 until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        val packageName = item.optString("package").trim()
        if (packageName.isEmpty()) continue
        out.add(
            RelaySkillResult(
                packageName = packageName,
                installs = item.optString("installs").trim().takeIf { it.isNotEmpty() },
                url = item.optString("url").trim().takeIf { it.isNotEmpty() },
            ),
        )
    }
    return out
}

private fun parseAgents(array: JSONArray?): List<RelayAgent> {
    if (array == null) return emptyList()
    val out = ArrayList<RelayAgent>(array.length())
    for (i in 0 until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        val name = item.optString("name").trim()
        if (name.isEmpty()) continue
        out.add(
            RelayAgent(
                name = name,
                description = item.optString("description"),
                source = item.optString("source").trim(),
                filePath = item.optString("filePath").trim().takeIf { it.isNotEmpty() },
                systemPrompt = item.optString("systemPrompt").takeIf { item.has("systemPrompt") },
                disabled = item.optBoolean("disabled", false),
            ),
        )
    }
    return out
}

private fun parseAuthProviders(array: JSONArray?): List<RelayAuthProvider> {
    if (array == null) return emptyList()
    val out = ArrayList<RelayAuthProvider>(array.length())
    for (i in 0 until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        val id = item.optString("id").trim()
        if (id.isEmpty()) continue
        out.add(
            RelayAuthProvider(
                id = id,
                name = item.optString("name").trim().takeIf { it.isNotEmpty() } ?: id,
                loggedIn = item.optBoolean("loggedIn", false),
            ),
        )
    }
    return out
}

private fun parseFileMatches(array: JSONArray?): List<RelayFileMatch> {
    if (array == null) return emptyList()
    val out = ArrayList<RelayFileMatch>(array.length())
    for (i in 0 until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        val path = item.optString("path").trim()
        if (path.isEmpty()) continue
        out.add(RelayFileMatch(path = path, isDir = item.optBoolean("isDir", false)))
    }
    return out
}

private fun parseGitFiles(array: JSONArray?): List<RelayGitFile> {
    if (array == null) return emptyList()
    val out = ArrayList<RelayGitFile>(array.length())
    for (i in 0 until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        val filePath = item.optString("filePath").trim()
        if (filePath.isEmpty()) continue
        out.add(
            RelayGitFile(
                filePath = filePath,
                status = item.optString("status").trim(),
                code = item.optString("code").trim(),
            ),
        )
    }
    return out
}

private fun parseBranches(array: JSONArray?): List<RelayBranch> {
    if (array == null) return emptyList()
    val out = ArrayList<RelayBranch>(array.length())
    for (i in 0 until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        val id = item.optString("id").trim()
        if (id.isEmpty()) continue
        out.add(
            RelayBranch(
                id = id,
                label = item.optString("label").trim().takeIf { it.isNotEmpty() } ?: id,
                role = item.optString("role").trim().takeIf { it.isNotEmpty() },
            ),
        )
    }
    return out
}

private fun parseSkills(array: JSONArray?): List<RelaySkill> {
    if (array == null) return emptyList()
    val out = ArrayList<RelaySkill>(array.length())
    for (i in 0 until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        val name = item.optString("name").trim()
        val filePath = item.optString("filePath").trim()
        if (name.isEmpty() || filePath.isEmpty()) continue
        out.add(
            RelaySkill(
                name = name,
                description = item.optString("description"),
                filePath = filePath,
                disableModelInvocation = item.optBoolean("disableModelInvocation", false),
                scope = item.optString("scope").trim().takeIf { it.isNotEmpty() },
            ),
        )
    }
    return out
}

private fun parsePlugins(array: JSONArray?): List<RelayPlugin> {
    if (array == null) return emptyList()
    val out = ArrayList<RelayPlugin>(array.length())
    for (i in 0 until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        val source = item.optString("source").trim()
        if (source.isEmpty()) continue
        val counts = item.optJSONObject("counts")
        out.add(
            RelayPlugin(
                source = source,
                scope = item.optString("scope").trim().ifEmpty { "project" },
                status = item.optString("status").trim(),
                disabled = item.optBoolean("disabled", false),
                version = item.optString("version").trim().takeIf { it.isNotEmpty() },
                counts = counts?.let {
                    RelayPluginCounts(
                        extensions = it.optInt("extensions", 0),
                        skills = it.optInt("skills", 0),
                        prompts = it.optInt("prompts", 0),
                        themes = it.optInt("themes", 0),
                    )
                },
            ),
        )
    }
    return out
}

private fun parseMcp(array: JSONArray?): List<RelayMcp> {
    if (array == null) return emptyList()
    val out = ArrayList<RelayMcp>(array.length())
    for (i in 0 until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        val name = item.optString("name").trim()
        if (name.isEmpty()) continue
        out.add(
            RelayMcp(
                name = name,
                source = item.optString("source").trim(),
                status = item.optString("status").trim(),
                type = item.optString("type").trim().takeIf { it.isNotEmpty() },
                enabled = if (item.has("enabled") && !item.isNull("enabled")) {
                    item.optBoolean("enabled", true)
                } else {
                    null
                },
            ),
        )
    }
    return out
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

private fun parseArchives(array: JSONArray?): List<RelayArchive> {
    if (array == null) return emptyList()
    val out = ArrayList<RelayArchive>(array.length())
    for (i in 0 until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        val key = item.optString("key").trim()
        if (key.isEmpty()) continue
        out.add(
            RelayArchive(
                key = key,
                name = item.optString("name").trim().takeIf { it.isNotEmpty() },
                id = item.optString("id").trim().takeIf { it.isNotEmpty() },
                archivedAt = item.optString("archivedAt").trim().takeIf { it.isNotEmpty() },
            ),
        )
    }
    return out
}

private fun parseWorktrees(array: JSONArray?): List<RelayWorktree> {
    if (array == null) return emptyList()
    val out = ArrayList<RelayWorktree>(array.length())
    for (i in 0 until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        val path = item.optString("path").trim()
        if (path.isEmpty()) continue
        out.add(
            RelayWorktree(
                path = path,
                branch = item.optString("branch").trim().takeIf { it.isNotEmpty() },
                isMain = item.optBoolean("isMain", false),
            ),
        )
    }
    return out
}

private fun parseProjects(array: JSONArray?): List<RelayProject> {
    if (array == null) return emptyList()
    val out = ArrayList<RelayProject>(array.length())
    for (i in 0 until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        val path = item.optString("path").trim()
        if (path.isEmpty()) continue
        val name = item.optString("name").trim().takeIf { it.isNotEmpty() } ?: path.substringAfterLast('/')
        out.add(RelayProject(path = path, name = name, addedAt = item.optString("addedAt").trim().takeIf { it.isNotEmpty() }))
    }
    return out
}

private fun parseFileEntries(array: JSONArray?): List<RelayFileEntry> {
    if (array == null) return emptyList()
    val out = ArrayList<RelayFileEntry>(array.length())
    for (i in 0 until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        val name = item.optString("name").trim()
        val path = item.optString("path").trim()
        if (name.isEmpty() || path.isEmpty()) continue
        out.add(RelayFileEntry(name = name, path = path, dir = item.optBoolean("dir", false)))
    }
    return out
}

private fun parseSlash(array: JSONArray?): List<RelaySlashCommand> {
    if (array == null) return emptyList()
    val out = ArrayList<RelaySlashCommand>(array.length())
    for (i in 0 until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        val name = item.optString("name").trim()
        if (name.isEmpty()) continue
        out.add(
            RelaySlashCommand(
                name = name,
                requiresArgs = item.optBoolean("requiresArgs", false),
                hint = item.optString("hint").trim().ifEmpty { name },
            ),
        )
    }
    return out
}

fun parseTodoPhases(array: JSONArray?): List<TodoPhase> {
    if (array == null) return emptyList()
    val out = ArrayList<TodoPhase>(array.length())
    for (i in 0 until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        val name = item.optString("name").trim().ifEmpty { "Tasks" }
        val tasks = ArrayList<TodoItem>()
        val taskArray = item.optJSONArray("tasks")
        if (taskArray != null) {
            for (j in 0 until taskArray.length()) {
                val task = taskArray.optJSONObject(j) ?: continue
                val content = task.optString("content").trim()
                if (content.isEmpty()) continue
                tasks.add(TodoItem(content = content, status = task.optString("status").ifEmpty { "pending" }))
            }
        }
        out.add(TodoPhase(name = name, tasks = tasks))
    }
    return out
}

fun parseSubagentChips(array: JSONArray?): List<SubagentChip> {
    if (array == null) return emptyList()
    val out = ArrayList<SubagentChip>(array.length())
    for (i in 0 until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        val id = item.optString("id").trim()
        if (id.isEmpty()) continue
        out.add(
            SubagentChip(
                id = id,
                agent = item.optString("agent").trim().ifEmpty { "agent" },
                status = item.optString("status").trim().ifEmpty { "running" },
                task = item.optString("task").trim().ifEmpty { item.optString("description").trim() },
            ),
        )
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

private fun strictInteger(value: Any?): Int? = when (value) {
    is Int -> value
    is Long -> value.takeIf { it in Int.MIN_VALUE..Int.MAX_VALUE }?.toInt()
    else -> null
}

/** Emits one logical frame contiguously; callers serialize the entire invocation. */
fun sendRelayFrames(logical: String, send: (String) -> Boolean): Boolean {
    val buffer = StandardCharsets.UTF_8.newEncoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .encode(CharBuffer.wrap(logical))
    require(buffer.remaining() <= RelayProtocol.MAX_LOGICAL_BYTES) { "Frame is too large" }
    if (buffer.remaining() <= RelayProtocol.MAX_FRAME_BYTES) return send(logical)
    val count = (buffer.remaining() + RelayProtocol.MAX_CHUNK_BYTES - 1) / RelayProtocol.MAX_CHUNK_BYTES
    val transfer = UUID.randomUUID().toString()
    for (index in 0 until count) {
        val bytes = ByteArray(minOf(buffer.remaining(), RelayProtocol.MAX_CHUNK_BYTES))
        buffer.get(bytes)
        val wire = JSONObject().put("op", "chunk").put("transfer", transfer)
            .put("index", index).put("count", count)
            .put("data", Base64.getEncoder().encodeToString(bytes)).toString()
        if (!send(wire)) return false
    }
    return true
}

/** A connection owns one assembler. Null means a valid, incomplete transfer. */
class RelayFrameAssembler(private val nowMs: () -> Long = { System.nanoTime() / 1_000_000 }) {
    private class Transfer(val count: Int, val started: Long) {
        val parts = ArrayList<ByteArray>()
        var size = 0
    }
    private val transfers = HashMap<String, Transfer>()
    private var buffered = 0
    private val transferPattern = Regex("^[A-Za-z0-9_-]{1,64}$")
    private val base64Pattern = Regex("^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$")

    fun clear() {
        transfers.clear()
        buffered = 0
    }

    fun receive(wire: String): ServerFrame? {
        try {
            require(wire.isNotEmpty() && utf8Size(wire) <= RelayProtocol.MAX_FRAME_BYTES) { "Invalid wire size" }
            val now = nowMs()
            require(transfers.values.none { now - it.started >= RelayProtocol.CHUNK_DEADLINE_MS }) { "Chunk transfer timed out" }
            val json = JSONObject(wire)
            if (json.opt("op") != "chunk") {
                return requireNotNull(parseServerFrame(wire)) { "Invalid relay frame" }
            }
            val id = json.opt("transfer") as? String ?: error("Invalid transfer")
            require(transferPattern.matches(id)) { "Invalid transfer" }
            val index = strictInteger(json.opt("index")) ?: error("Invalid chunk index")
            val count = strictInteger(json.opt("count")) ?: error("Invalid chunk count")
            require(count in 1..RelayProtocol.MAX_CHUNKS && index in 0 until count) { "Invalid chunk bounds" }
            val data = json.opt("data") as? String ?: error("Invalid chunk data")
            require(data.length <= (RelayProtocol.MAX_CHUNK_BYTES / 3) * 4 && base64Pattern.matches(data)) { "Invalid base64" }
            val bytes = Base64.getDecoder().decode(data)
            require(Base64.getEncoder().encodeToString(bytes) == data) { "Noncanonical base64" }
            require(bytes.isNotEmpty() && bytes.size <= RelayProtocol.MAX_CHUNK_BYTES) { "Invalid chunk size" }
            val transfer = transfers[id] ?: run {
                require(index == 0 && transfers.size < RelayProtocol.MAX_TRANSFERS) { "Invalid transfer start" }
                Transfer(count, now).also { transfers[id] = it }
            }
            require(transfer.count == count && transfer.parts.size == index) { "Chunk ordering mismatch" }
            require(buffered + bytes.size <= RelayProtocol.MAX_LOGICAL_BYTES) { "Chunk buffer limit exceeded" }
            transfer.parts.add(bytes)
            transfer.size += bytes.size
            buffered += bytes.size
            if (index + 1 != count) return null
            transfers.remove(id)
            buffered -= transfer.size
            val assembled = ByteArray(transfer.size)
            var offset = 0
            for (part in transfer.parts) {
                part.copyInto(assembled, offset)
                offset += part.size
            }
            val logical = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(assembled)).toString()
            require(JSONObject(logical).opt("op") != "chunk") { "Nested chunk" }
            return requireNotNull(parseLogicalServerFrame(logical)) { "Invalid assembled frame" }
        } catch (error: Exception) {
            clear()
            throw IllegalArgumentException(error.message ?: "Invalid relay frame", error)
        }
    }
}
