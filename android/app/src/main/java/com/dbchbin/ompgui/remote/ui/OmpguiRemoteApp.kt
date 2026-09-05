package com.dbchbin.ompgui.remote.ui

import android.content.SharedPreferences
import android.content.res.Configuration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import com.dbchbin.ompgui.remote.store.AppPreferences
import java.util.Locale
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.ui.Modifier
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.setValue
import com.dbchbin.ompgui.remote.net.ConnectionState

@Composable
fun OmpguiRemoteApp(viewModel: RemoteViewModel) {
    val context = LocalContext.current
    val preferences = remember(context) { AppPreferences.prefs(context) }
    var language by remember { mutableStateOf(AppPreferences.getLanguage(context, Locale.getDefault().language)) }
    DisposableEffect(preferences) {
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, changedKey ->
            if (changedKey == AppPreferences.KEY_LANGUAGE) language = AppPreferences.getLanguage(context, Locale.getDefault().language)
        }
        preferences.registerOnSharedPreferenceChangeListener(listener)
        onDispose { preferences.unregisterOnSharedPreferenceChangeListener(listener) }
    }
    val configuration = LocalConfiguration.current
    val localizedConfiguration = remember(configuration, language) {
        Configuration(configuration).apply { setLocale(Locale(AppPreferences.languageCode(language))) }
    }
    val localizedContext = remember(context, localizedConfiguration) { context.createConfigurationContext(localizedConfiguration) }
    Locale.setDefault(Locale(AppPreferences.languageCode(language)))
    val state by viewModel.uiState.collectAsState()
    val usageData by viewModel.usage.collectAsState()
    val settings by viewModel.settings.collectAsState()
    var chatSettingsOpen by remember { mutableStateOf(false) }
    var chatUsageOpen by remember { mutableStateOf(false) }

    val drafts = remember { mutableStateMapOf<String, String>() }
    var newSessionDraft by remember { mutableStateOf("") }
    var filePreview by remember { mutableStateOf<Pair<String, String>?>(null) }
    var chatPaletteOpen by remember { mutableStateOf(false) }
    var newSessionOpen by remember { mutableStateOf(false) }
    var archivesOpen by remember { mutableStateOf(false) }
    fun openSession(id: String) {
        (state.screen as? RemoteScreen.Chat)?.let { drafts[it.sessionId] = state.draft }
        newSessionDraft = ""
        filePreview = null
        chatSettingsOpen = false
        chatUsageOpen = false
        chatPaletteOpen = false
        archivesOpen = false
        viewModel.openSession(id)
        viewModel.setDraft(drafts[id].orEmpty())
    }

    CompositionLocalProvider(LocalContext provides localizedContext, LocalConfiguration provides localizedConfiguration) {
    key(language) {
    RemoteTheme {
        Surface {
            when (val screen = state.screen) {
                is RemoteScreen.Pairing -> PairingScreen(
                    uri = state.pairingUri,
                    password = state.password,
                    error = state.error,
                    connecting = state.connection == ConnectionState.Connecting,
                    onUriChange = viewModel::setPairingUri,
                    onPasswordChange = viewModel::setPassword,
                    onConnect = viewModel::pair,
                )
                is RemoteScreen.Sessions -> SessionListScreen(
                    requester = viewModel.requester,
                    initialDraft = newSessionDraft,
                    onSlashSelected = { newSessionDraft = it },
                    onOpenSessionFilePreview = { cwd, path -> filePreview = cwd to path },
                    sessions = state.sessions,
                    runningIds = state.runningIds,
                    connection = state.connection,
                    error = state.error,
                    refreshing = state.connection == ConnectionState.Connecting,
                    onRefresh = viewModel::refreshSessions,
                    onOpen = ::openSession,
                    onUnpair = { drafts.clear(); newSessionDraft = ""; filePreview = null; viewModel.unpair() },
                    onPrepareNewSession = {
                        viewModel.fetchProjects()
                        viewModel.fetchSlash()
                    },
                    onCreateSession = { cwd, message, provider, modelId, thinking ->
                        viewModel.createSession(cwd, message, provider, modelId, thinking)
                    },
                    projects = state.projects,
                    creatingSession = state.creatingSession,
                    archives = state.archives,
                    slashCommands = state.slashCommands,
                    worktrees = state.worktrees,
                    worktreesGit = state.worktreesGit,
                    onDeleteSession = viewModel::deleteSession,
                    onArchiveSession = viewModel::archiveSession,
                    onRenameSession = viewModel::renameSession,
                    onFetchArchives = viewModel::fetchArchives,
                    onRestoreArchive = viewModel::restoreArchive,
                    onFetchWorktrees = viewModel::fetchWorktrees,
                    onAddWorktree = viewModel::addWorktree,
                    onExportSession = viewModel::exportSession,
                    lastExport = state.exportResult,
                    onClearExport = viewModel::clearExport,
                    skills = state.skills,
                    plugins = state.plugins,
                    mcp = state.mcp,
                    onFetchSkills = viewModel::fetchSkills,
                    onToggleSkill = viewModel::toggleSkill,
                    onFetchPlugins = viewModel::fetchPlugins,
                    onPluginAction = { cwd, action, source, scope -> viewModel.pluginAction(cwd, action, source, scope) },
                    onFetchMcp = viewModel::fetchMcp,
                    onDeleteMcp = viewModel::deleteMcp,
                    onUpsertMcp = { cwd, name, type, command, url, args ->
                        viewModel.upsertMcp(cwd, name, type, command, url, args)
                    },
                    serverUrl = viewModel.getServerUrl(),
                    deviceId = viewModel.getDeviceId(),
                    currentModel = state.currentModel,
                    models = state.models,
                    usageData = usageData,
                    onRefreshUsage = viewModel::fetchUsage,
                    settings = settings,
                    onUpdateSetting = { key, value -> viewModel.updateSetting(key, value) },
                    onOpenSettings = {
                        val cwd = state.projects.firstOrNull()?.path.orEmpty()
                        viewModel.fetchSettings()
                        if (cwd.isNotBlank()) {
                            viewModel.fetchSkills(cwd)
                            viewModel.fetchPlugins(cwd)
                            viewModel.fetchMcp(cwd)
                            viewModel.fetchAgents(cwd)
                        } else {
                            viewModel.fetchAgents(null)
                        }
                        viewModel.fetchAuthProviders()
                    },
                    onOpenUsage = viewModel::fetchUsage,
                    onImportSession = viewModel::importSession,
                    fileMatches = state.fileMatches,
                    onSearchFiles = viewModel::searchFiles,
                    agents = state.agents,
                    onSaveAgent = viewModel::saveAgent,
                    onDeleteAgent = viewModel::deleteAgent,
                    skillResults = state.skillResults,
                    skillSearchQuery = state.skillSearchQuery,
                    onSearchSkills = viewModel::searchSkills,
                    onInstallSkill = viewModel::installSkill,
                    authProviders = state.authProviders,
                    onAddProject = viewModel::addProject,
                    onRemoveProject = viewModel::removeProject,
                )
                is RemoteScreen.Chat -> {
                    val thinkingLevel = state.sessionThinkingLevel
                        ?: settings?.optString("defaultThinkingLevel")?.takeIf { it.isNotBlank() }
                        ?: "auto"
                    val usageFraction = state.contextFraction
                    LaunchedEffect(screen.sessionId) {
                        viewModel.fetchUsage()
                        viewModel.fetchBranches(screen.sessionId)
                    }
                    key(screen.sessionId) {
                    ChatScreen(
                        requester = viewModel.requester,
                        onOpenSession = ::openSession,
                        extensionDialogs = state.extensionDialogs,
                        chatNotices = state.chatNotices,
                        extensionStatus = state.extensionStatus,
                        extensionWidgets = state.extensionWidgets,
                        onDismissExtensionDialog = viewModel::dismissExtensionDialog,
                        onDismissChatNotice = viewModel::dismissChatNotice,
                        queueSteering = state.queue.steering,
                        queueFollowUp = state.queue.followUp,
                        onOpenPalette = { viewModel.fetchSlash(); chatPaletteOpen = true },
                        title = state.chatTitle.ifBlank { screen.sessionId },
                        messages = state.messages,
                        draft = state.draft,
                        running = state.running,
                        connection = state.connection,
                        error = state.error,
                        models = state.models,
                        currentModel = state.currentModel,
                        pickerOpen = state.pickerOpen,
                        onDraftChange = { drafts[screen.sessionId] = it; viewModel.setDraft(it) },
                        onSend = viewModel::sendPrompt,
                        onAbort = viewModel::abort,
                        onBack = {
                            drafts[screen.sessionId] = state.draft
                            chatSettingsOpen = false
                            chatUsageOpen = false
                            viewModel.closeSession()
                        },
                        onOpenPicker = viewModel::openModelPicker,
                        onClosePicker = viewModel::closeModelPicker,
                        onSelectModel = viewModel::setModel,
                        onSendWithAttachments = { text, images -> viewModel.sendPrompt(text, images) },
                        onOpenUsage = {
                            viewModel.fetchUsage()
                            chatUsageOpen = true
                        },
                        onOpenSettings = {
                            val cwd = state.sessionCwd
                                ?: state.projects.firstOrNull()?.path.orEmpty()
                            viewModel.fetchSettings()
                            if (cwd.isNotBlank()) {
                                viewModel.fetchSkills(cwd)
                                viewModel.fetchPlugins(cwd)
                                viewModel.fetchMcp(cwd)
                                viewModel.fetchAgents(cwd)
                            } else {
                                viewModel.fetchAgents(null)
                            }
                            viewModel.fetchAuthProviders()
                            chatSettingsOpen = true
                        },
                        thinkingLevel = thinkingLevel,
                        onThinkingLevelChange = viewModel::setSessionThinkingLevel,
                        usageFraction = usageFraction,
                        slashCommands = state.slashCommands,
                        todos = state.todos,
                        subagents = state.subagents,
                        filesPath = state.filesPath,
                        sessionId = screen.sessionId,
                        sessionCwd = state.sessionCwd.orEmpty(),
                        branches = state.branches,
                        branchLeafId = state.branchLeafId,
                        onSetLeaf = viewModel::setLeaf,
                        onFetchBranches = viewModel::fetchBranches,
                    )
                    }
                    if (chatSettingsOpen) {
                        val settingsCwd = state.sessionCwd
                            ?: state.projects.firstOrNull()?.path.orEmpty()
                        SettingsSheet(
                            requester = viewModel.requester,
                            serverUrl = viewModel.getServerUrl(),
                            deviceId = viewModel.getDeviceId(),
                            connection = state.connection,
                            currentModel = state.currentModel,
                            settings = settings,
                            settingsCwd = settingsCwd,
                            onUnpair = {
                                chatSettingsOpen = false
                                drafts.clear()
                                viewModel.unpair()
                            },
                            onDismiss = { chatSettingsOpen = false },
                        )
                    }
                    if (chatUsageOpen) {
                        UsageSheet(
                            requester = viewModel.requester,
                            usageData = usageData,
                            onDismiss = { chatUsageOpen = false },
                        )
                    }
                }
            }
            if (chatPaletteOpen) {
                CommandPaletteSheet(
                    requester = viewModel.requester,
                    sessions = state.sessions,
                    slashCommands = state.slashCommands,
                    archives = state.archives,
                    currentSessionId = (state.screen as? RemoteScreen.Chat)?.sessionId,
                    currentCwd = state.sessionCwd,
                    onOpenSession = ::openSession,
                    onNewSession = { viewModel.fetchProjects(); newSessionDraft = ""; newSessionOpen = true },
                    onOpenSettings = { viewModel.fetchSettings(); chatSettingsOpen = true },
                    onOpenUsage = { chatUsageOpen = true },
                    onOpenArchives = { viewModel.fetchArchives(); archivesOpen = true },
                    onRestoreArchive = viewModel::restoreArchive,
                    onDismiss = { chatPaletteOpen = false },
                    onExportSession = viewModel::exportSession,
                    onGitStatus = viewModel::fetchGitStatus,
                    fileMatches = state.fileMatches,
                    onSearchFiles = viewModel::searchFiles,
                    onOpenFile = { path -> filePreview = state.sessionCwd.orEmpty() to path },
                    onSlashSelected = { value ->
                        (state.screen as? RemoteScreen.Chat)?.let { drafts[it.sessionId] = value }
                        viewModel.setDraft(value)
                    },
                    onOpenSessionFilePreview = { cwd, path -> filePreview = cwd to path },
                )
            }
            if (newSessionOpen) {
                NewSessionSheet(
                    requester = viewModel.requester,
                    projects = state.projects,
                    models = state.models,
                    creating = state.creatingSession,
                    worktrees = state.worktrees,
                    worktreesGit = state.worktreesGit,
                    onFetchWorktrees = viewModel::fetchWorktrees,
                    onAddWorktree = viewModel::addWorktree,
                    onAddProject = viewModel::addProject,
                    initialMessage = newSessionDraft,
                    onCreated = { id -> newSessionOpen = false; viewModel.refreshSessions(); openSession(id) },
                    onDismiss = { newSessionOpen = false },
                )
            }
            if (archivesOpen) {
                AlertDialog(
                    onDismissRequest = { archivesOpen = false },
                    title = { Text(if (language == "한국어") "보관함" else "Archives") },
                    text = {
                        Column(Modifier.verticalScroll(rememberScrollState())) {
                            state.archives.forEach { archive ->
                                TextButton(onClick = { viewModel.restoreArchive(archive.key); archivesOpen = false }) {
                                    Text(archive.name ?: archive.id ?: archive.key)
                                }
                            }
                            state.error?.let { Text(it) }
                        }
                    },
                    confirmButton = { TextButton(onClick = { archivesOpen = false }) { Text(if (language == "한국어") "닫기" else "Close") } },
                )
            }
            filePreview?.let { (cwd, path) ->
                key((state.screen as? RemoteScreen.Chat)?.sessionId, cwd, path) {
                    FileBrowserSheet(requester = viewModel.requester, path = path, cwd = cwd, onDismiss = { filePreview = null })
                }
            }
        }
    }
    }
    }
}
