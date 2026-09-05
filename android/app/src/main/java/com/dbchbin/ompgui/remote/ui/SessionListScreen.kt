package com.dbchbin.ompgui.remote.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.LinkOff
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dbchbin.ompgui.remote.R
import com.dbchbin.ompgui.remote.net.ConnectionState
import com.dbchbin.ompgui.remote.relay.ModelRef
import com.dbchbin.ompgui.remote.relay.RelayArchive
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.LocalContext
import com.dbchbin.ompgui.remote.relay.createCachedDownload
import com.dbchbin.ompgui.remote.relay.shareFile
import kotlinx.coroutines.launch
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import com.dbchbin.ompgui.remote.relay.RelayExport
import com.dbchbin.ompgui.remote.relay.RelayAgent
import com.dbchbin.ompgui.remote.relay.RelayAuthProvider
import com.dbchbin.ompgui.remote.relay.RelayFileMatch
import com.dbchbin.ompgui.remote.relay.RelaySkillResult
import com.dbchbin.ompgui.remote.relay.RelayMcp
import com.dbchbin.ompgui.remote.relay.RelayPlugin
import com.dbchbin.ompgui.remote.relay.RelaySkill
import com.dbchbin.ompgui.remote.relay.RelayModelOption
import com.dbchbin.ompgui.remote.relay.RelayProject
import com.dbchbin.ompgui.remote.relay.RelaySlashCommand
import com.dbchbin.ompgui.remote.relay.RelayRequester
import com.dbchbin.ompgui.remote.relay.RelayWorktree
import com.dbchbin.ompgui.remote.relay.SessionListItem
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private data class ProjectGroup(
    val key: String,
    val title: String,
    val branch: String?,
    val sessions: List<SessionListItem>,
)

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun SessionListScreen(
    requester: RelayRequester,
    sessions: List<SessionListItem>,
    runningIds: Set<String>,
    connection: ConnectionState,
    error: String?,
    refreshing: Boolean,
    onRefresh: () -> Unit,
    onOpen: (String) -> Unit,
    onUnpair: () -> Unit,
    onNewSession: () -> Unit = {},
    onPrepareNewSession: () -> Unit = {},
    onCreateSession: (cwd: String, message: String?, provider: String?, modelId: String?, thinkingLevel: String?) -> Unit = { _, _, _, _, _ -> },
    projects: List<RelayProject> = emptyList(),
    creatingSession: Boolean = false,
    archives: List<RelayArchive> = emptyList(),
    slashCommands: List<RelaySlashCommand> = emptyList(),
    worktrees: List<RelayWorktree> = emptyList(),
    worktreesGit: Boolean = false,
    onDeleteSession: (String) -> Unit = {},
    onArchiveSession: (String) -> Unit = {},
    onRenameSession: (String, String) -> Unit = { _, _ -> },
    onFetchArchives: () -> Unit = {},
    onRestoreArchive: (String) -> Unit = {},
    onFetchWorktrees: (String) -> Unit = {},
    onAddWorktree: (String, String) -> Unit = { _, _ -> },
    serverUrl: String = "",
    deviceId: String = "",
    currentModel: ModelRef? = null,
    models: List<RelayModelOption> = emptyList(),
    usageData: JSONObject? = null,
    settings: JSONObject? = null,
    onRefreshUsage: () -> Unit = {},
    onOpenSettings: () -> Unit = {},
    onOpenUsage: () -> Unit = {},
    onUpdateSetting: (String, Any?) -> Unit = { _, _ -> },
    onExportSession: (String) -> Unit = {},
    lastExport: RelayExport? = null,
    onClearExport: () -> Unit = {},
    skills: List<RelaySkill> = emptyList(),
    plugins: List<RelayPlugin> = emptyList(),
    mcp: List<RelayMcp> = emptyList(),
    onFetchSkills: (String) -> Unit = {},
    onToggleSkill: (String, String, Boolean) -> Unit = { _, _, _ -> },
    onFetchPlugins: (String) -> Unit = {},
    onPluginAction: (String, String, String?, String?) -> Unit = { _, _, _, _ -> },
    onFetchMcp: (String?) -> Unit = {},
    onDeleteMcp: (String, String) -> Unit = { _, _ -> },
    onUpsertMcp: (String, String, String, String?, String?, List<String>?) -> Unit = { _, _, _, _, _, _ -> },
    onImportSession: (String, String) -> Unit = { _, _ -> },
    fileMatches: List<RelayFileMatch> = emptyList(),
    onSearchFiles: (String, String) -> Unit = { _, _ -> },
    onOpenFile: ((String) -> Unit)? = null,
    onSlashSelected: (String) -> Unit,
    initialDraft: String,
    onOpenSessionFilePreview: (String, String) -> Unit,
    agents: List<RelayAgent> = emptyList(),
    onSaveAgent: (String, String, String, String, String?) -> Unit = { _, _, _, _, _ -> },
    onDeleteAgent: (String, String, String?) -> Unit = { _, _, _ -> },
    skillResults: List<RelaySkillResult> = emptyList(),
    skillSearchQuery: String = "",
    onSearchSkills: (String, Int) -> Unit = { _, _ -> },
    onInstallSkill: (String, String, String?) -> Unit = { _, _, _ -> },
    authProviders: List<RelayAuthProvider> = emptyList(),
    onAddProject: (String) -> Unit = {},
    onRemoveProject: (String) -> Unit = {},
) {
    val context = LocalContext.current
    var query by rememberSaveable { mutableStateOf("") }
    var runningOnly by rememberSaveable { mutableStateOf(false) }
    var projectOrder by rememberSaveable { mutableStateOf(emptyList<String>()) }
    var selectedProject by rememberSaveable { mutableStateOf<String?>(null) }
    var collapsed by rememberSaveable { mutableStateOf(emptySet<String>()) }
    var settingsOpen by remember { mutableStateOf(false) }
    var usageOpen by remember { mutableStateOf(false) }
    var newSessionOpen by remember { mutableStateOf(false) }
    var paletteOpen by remember { mutableStateOf(false) }
    var archivesOpen by remember { mutableStateOf(false) }
    var importOpen by remember { mutableStateOf(false) }
    var actionSession by remember { mutableStateOf<SessionListItem?>(null) }
    var renameText by remember { mutableStateOf("") }
    var confirmDelete by remember { mutableStateOf(false) }
    var confirmArchive by remember { mutableStateOf(false) }
    var selectedIds by remember { mutableStateOf(emptySet<String>()) }
    var pinnedIds by rememberSaveable { mutableStateOf(emptySet<String>()) }
    var autonamePending by remember { mutableStateOf<String?>(null) }
    var listActionError by remember { mutableStateOf<String?>(null) }
    var exportPending by remember { mutableStateOf<String?>(null) }
    var worktreeRemoveTarget by remember { mutableStateOf<Pair<String, String>?>(null) }
    var worktreeForceConfirm by remember { mutableStateOf(false) }
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val korean = remember { Locale.getDefault().language == "ko" }
    val now = System.currentTimeMillis()
    var mutationPending by remember { mutableStateOf(false) }
    fun mutate(action: String, ids: Set<String>, name: String? = null) {
        if (mutationPending) return
        mutationPending = true
        scope.launch {
            listActionError = null
            val failures = mutableListOf<String>()
            for (id in ids) {
                try {
                    val args = JSONObject().put("id", id)
                    name?.let { args.put("name", it) }
                    val result = requester.request("sessions", action, args)
                    selectedIds = selectedIds - id
                    if (result.optJSONArray("skippedChildren")?.length()?.let { it > 0 } == true) {
                        failures.add("$id: some child links could not be updated: ${result.getJSONArray("skippedChildren")}")
                    }
                } catch (e: Exception) { failures.add("$id: ${e.message}") }
            }
            listActionError = failures.takeIf { it.isNotEmpty() }?.joinToString("\n")
            mutationPending = false
            onRefresh()
        }
    }


    val groups = remember(sessions, runningIds, query, runningOnly, selectedProject, projectOrder) {
        val q = query.trim()
        val visible = sessions.filter { session ->
            (q.isBlank() ||
                sessionTitle(session).contains(q, ignoreCase = true) ||
                session.cwd.contains(q, ignoreCase = true) ||
                session.id.contains(q, ignoreCase = true)) &&
                (!runningOnly || session.id in runningIds) &&
                (selectedProject == null || (session.projectRoot ?: session.cwd) == selectedProject)
        }
        visible.groupBy { session ->
            session.projectRoot ?: session.cwd
        }.map { (key, list) ->
            ProjectGroup(
                key = key,
                title = key.substringAfterLast('/').ifBlank { key },
                branch = list.mapNotNull { it.worktreeBranch?.takeIf { b -> b.isNotBlank() } }
                    .firstOrNull(),
                sessions = list.sortedWith(
                    compareByDescending<SessionListItem> {
                        parseInstant(it.modified)?.toEpochMilli() ?: Long.MIN_VALUE
                    },
                ),
            )
        }.sortedWith(
            compareBy<ProjectGroup> { projectOrder.indexOf(it.key).let { index -> if (index < 0) Int.MAX_VALUE else index } }.thenByDescending { group ->
                group.sessions.mapNotNull { parseInstant(it.modified)?.toEpochMilli() }
                    .maxOrNull() ?: Long.MIN_VALUE
            }.thenBy { it.title.lowercase() },
        )
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(OmpColors.Bg)
            .safeDrawingPadding(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp)
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "ompgui",
                fontWeight = FontWeight.Bold,
                fontSize = 20.sp,
                letterSpacing = (-0.5).sp,
                color = OmpColors.Text,
            )
            Spacer(modifier = Modifier.width(6.dp))
            Text(
                text = "v0.6.5",
                fontSize = 12.sp,
                color = OmpColors.TextDim,
            )
            Spacer(modifier = Modifier.weight(1f))
            Box(
                modifier = Modifier
                    .height(36.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(OmpColors.AccentStrong)
                    .clickable(onClick = {
                        onPrepareNewSession()
                        onNewSession()
                        newSessionOpen = true
                    })
                    .padding(horizontal = 12.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "+ " + stringResource(R.string.new_session),
                    color = androidx.compose.ui.graphics.Color.White,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            Spacer(modifier = Modifier.width(4.dp))
            IconButton(onClick = onRefresh, modifier = Modifier.size(44.dp)) {
                Icon(
                    imageVector = Icons.Filled.Refresh,
                    contentDescription = stringResource(R.string.sessions_refresh),
                    tint = OmpColors.TextMuted,
                )
            }
            IconButton(
                onClick = { usageOpen = true; onOpenUsage() },
                modifier = Modifier.size(44.dp),
            ) {
                Icon(
                    imageVector = Icons.Filled.Speed,
                    contentDescription = "Usage",
                    tint = OmpColors.TextMuted,
                )
            }
            IconButton(
                onClick = { settingsOpen = true; onOpenSettings() },
                modifier = Modifier.size(44.dp),
            ) {
                Icon(
                    imageVector = Icons.Filled.Settings,
                    contentDescription = "Settings",
                    tint = OmpColors.TextMuted,
                )
            }
            IconButton(onClick = onUnpair, modifier = Modifier.size(44.dp)) {
                Icon(
                    imageVector = Icons.Filled.LinkOff,
                    contentDescription = stringResource(R.string.sessions_unpair),
                    tint = OmpColors.TextMuted,
                )
            }
        }
        if (connection != ConnectionState.Connected) {
            Text(
                text = when (connection) {
                    ConnectionState.Connecting -> stringResource(R.string.status_connecting)
                    ConnectionState.Failed -> stringResource(R.string.status_failed)
                    else -> stringResource(R.string.status_idle)
                },
                color = OmpColors.TextMuted,
                fontSize = 12.sp,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
        }
        if (!error.isNullOrBlank()) {
            Text(
                error,
                color = OmpColors.StatusError,
                fontSize = 12.sp,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
        }
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 4.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
                    .border(1.dp, OmpColors.Border, RoundedCornerShape(8.dp))
                    .background(OmpColors.BgPanel, RoundedCornerShape(8.dp))
                    .padding(horizontal = 12.dp),
                contentAlignment = Alignment.Center,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Filled.Search,
                        contentDescription = null,
                        tint = OmpColors.TextDim,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    BasicTextField(
                        value = query,
                        onValueChange = { query = it },
                        singleLine = true,
                        textStyle = TextStyle(
                            color = OmpColors.Text,
                            fontSize = 14.sp,
                        ),
                        cursorBrush = SolidColor(OmpColors.Text),
                        modifier = Modifier.fillMaxWidth(),
                        decorationBox = { inner ->
                            Box {
                                if (query.isEmpty()) {
                                    Text(
                                        text = stringResource(R.string.search_sessions_placeholder),
                                        color = OmpColors.TextDim,
                                        fontSize = 14.sp,
                                    )
                                }
                                inner()
                            }
                        },
                    )
                }
            }
            Row(
                modifier = Modifier
                    .clip(CircleShape)
                    .background(if (runningOnly) OmpColors.BgHover else androidx.compose.ui.graphics.Color.Transparent)
                    .border(
                        1.dp,
                        if (runningOnly) OmpColors.Accent else OmpColors.Border,
                        CircleShape,
                    )
                    .clickable { runningOnly = !runningOnly }
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier = Modifier
                        .size(6.dp)
                        .clip(CircleShape)
                        .background(
                            if (runningOnly) OmpColors.StatusSuccess else OmpColors.TextDim,
                        ),
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = stringResource(R.string.filter_running_only),
                    fontSize = 12.sp,
                    color = if (runningOnly) OmpColors.Text else OmpColors.TextMuted,
                )
            }
        }
        Row(modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
            Text("All projects", color = OmpColors.Accent, modifier = Modifier.clickable { selectedProject = null }.padding(12.dp))
            val orderedProjects = projects.sortedBy { projectOrder.indexOf(it.path).let { index -> if (index < 0) Int.MAX_VALUE else index } }
            orderedProjects.forEachIndexed { index, project ->
                Column {
                    Text(project.name, color = if (selectedProject == project.path) OmpColors.Accent else OmpColors.Text,
                        modifier = Modifier.clickable { selectedProject = project.path; onFetchWorktrees(project.path) }.padding(12.dp))
                    if (index > 0) Text("Move left", color = OmpColors.TextMuted, modifier = Modifier.clickable {
                        val paths = orderedProjects.map { it.path }.toMutableList()
                        paths[index] = paths[index - 1]; paths[index - 1] = project.path
                        projectOrder = paths
                    }.padding(12.dp))
                }
            }
        }
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = onRefresh,
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
        ) {
            if (groups.isEmpty()) {
                Text(
                    stringResource(R.string.sessions_empty),
                    color = OmpColors.TextMuted,
                    fontSize = 14.sp,
                    modifier = Modifier.padding(24.dp),
                )
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(groups, key = { it.key }) { group ->
                        val expanded = group.key !in collapsed
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .border(1.dp, OmpColors.Border, RoundedCornerShape(12.dp))
                                .background(OmpColors.BgPanel, RoundedCornerShape(12.dp))
                                .clip(RoundedCornerShape(12.dp)),
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        collapsed = if (expanded) {
                                            collapsed + group.key
                                        } else {
                                            collapsed - group.key
                                        }
                                    }
                                    .padding(horizontal = 14.dp, vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(
                                    imageVector = Icons.Filled.Folder,
                                    contentDescription = null,
                                    tint = OmpColors.Accent,
                                    modifier = Modifier.size(18.dp),
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    text = group.title,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 15.sp,
                                    color = OmpColors.Text,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f),
                                )
                                if (group.branch != null) {
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Box(
                                        modifier = Modifier
                                            .border(
                                                1.dp,
                                                OmpColors.Border,
                                                RoundedCornerShape(4.dp),
                                            )
                                            .background(
                                                OmpColors.BgHover,
                                                RoundedCornerShape(4.dp),
                                            )
                                            .padding(horizontal = 6.dp, vertical = 2.dp),
                                    ) {
                                        Text(
                                            text = group.branch,
                                            fontSize = 11.sp,
                                            color = OmpColors.TextMuted,
                                            maxLines = 1,
                                        )
                                    }
                                }
                                Spacer(modifier = Modifier.width(6.dp))
                                Box(
                                    modifier = Modifier
                                        .border(
                                            1.dp,
                                            OmpColors.Border,
                                            RoundedCornerShape(4.dp),
                                        )
                                        .background(
                                            OmpColors.BgHover,
                                            RoundedCornerShape(4.dp),
                                        )
                                        .padding(horizontal = 6.dp, vertical = 2.dp),
                                ) {
                                    Text(
                                        text = group.sessions.size.toString(),
                                        fontSize = 11.sp,
                                        color = OmpColors.TextDim,
                                    )
                                }
                                Icon(
                                    imageVector = if (expanded) {
                                        Icons.Filled.ExpandLess
                                    } else {
                                        Icons.Filled.ExpandMore
                                    },
                                    contentDescription = null,
                                    tint = OmpColors.TextMuted,
                                )
                            }
                            if (expanded) {
                                HorizontalDivider(
                                    color = OmpColors.Border,
                                    thickness = 1.dp,
                                )
                                // Pinned sessions float first; the rest stays recency-ordered.
                                val ordered = remember(group.sessions, pinnedIds) {
                                    group.sessions.sortedWith(
                                        compareByDescending<SessionListItem> { it.id in pinnedIds }
                                            .thenByDescending { parseInstant(it.modified)?.toEpochMilli() ?: Long.MIN_VALUE },
                                    )
                                }
                                ordered.forEach { session ->
                                    SessionItemRow(
                                        session = session,
                                        running = session.id in runningIds,
                                        now = now,
                                        korean = korean,
                                        selected = session.id in selectedIds,
                                        pinned = session.id in pinnedIds,
                                        onClick = {
                                            if (selectedIds.isNotEmpty()) {
                                                selectedIds = if (session.id in selectedIds) {
                                                    selectedIds - session.id
                                                } else {
                                                    selectedIds + session.id
                                                }
                                            } else {
                                                onOpen(session.id)
                                            }
                                        },
                                        onLongClick = { actionSession = session; renameText = session.name.orEmpty(); confirmDelete = false; confirmArchive = false },
                                        onToggleSelect = {
                                            selectedIds = if (session.id in selectedIds) {
                                                selectedIds - session.id
                                            } else {
                                                selectedIds + session.id
                                            }
                                        },
                                        onTogglePin = {
                                            pinnedIds = if (session.id in pinnedIds) {
                                                pinnedIds - session.id
                                            } else {
                                                pinnedIds + session.id
                                            }
                                        },
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(OmpColors.BgPanel)
                .padding(horizontal = 12.dp, vertical = 4.dp),
        ) {
            HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
            if (worktreesGit && worktrees.isNotEmpty()) {
                WorktreeManageRow(
                    worktrees = worktrees,
                    korean = korean,
                    onFetch = { (selectedProject ?: projects.firstOrNull()?.path)?.let { onFetchWorktrees(it) } },
                    onRemove = { path -> (selectedProject ?: projects.firstOrNull()?.path)?.let { worktreeForceConfirm = false; worktreeRemoveTarget = it to path } },
                )
            }
            FooterNavRow(
                icon = Icons.Filled.Settings,
                label = if (korean) "설정" else "Settings",
                onClick = { settingsOpen = true; onOpenSettings() },
            )
            FooterNavRow(
                icon = Icons.Filled.Speed,
                label = if (korean) "사용량" else "Usage",
                onClick = { usageOpen = true; onOpenUsage() },
            )
            FooterNavRow(
                icon = Icons.Filled.Search,
                label = if (korean) "명령" else "Command",
                onClick = { paletteOpen = true },
            )
            FooterNavRow(
                icon = Icons.Filled.Folder,
                label = if (korean) "보관함" else "Archives",
                onClick = { onFetchArchives(); archivesOpen = true },
            )
            FooterNavRow(
                icon = Icons.Filled.Folder,
                label = if (korean) "세션 가져오기" else "Import",
                onClick = { importOpen = true },
            )
        }
        if (settingsOpen) {
            SettingsSheet(
                requester = requester,
                serverUrl = serverUrl,
                deviceId = deviceId,
                connection = connection,
                currentModel = currentModel,
                settings = settings,
                settingsCwd = (selectedProject ?: projects.firstOrNull()?.path).orEmpty(),
                onUnpair = onUnpair,
                onDismiss = { settingsOpen = false },
            )
        }
        if (usageOpen) {
            UsageSheet(
                requester = requester,
                usageData = usageData,
                onDismiss = { usageOpen = false },
            )
        }
        if (newSessionOpen) {
            NewSessionSheet(
                requester = requester,
                projects = projects,
                models = models,
                creating = creatingSession,
                initialMessage = initialDraft,
                worktrees = worktrees,
                worktreesGit = worktreesGit,
                onFetchWorktrees = onFetchWorktrees,
                onAddWorktree = onAddWorktree,
                onAddProject = onAddProject,
                onDismiss = { newSessionOpen = false },
                onCreated = { id ->
                    newSessionOpen = false
                    onRefresh()
                    onOpen(id)
                },
            )
        }
        if (paletteOpen) {
            CommandPaletteSheet(
                requester = requester,
                sessions = sessions,
                slashCommands = slashCommands,
                archives = archives,
                onOpenSession = onOpen,
                onNewSession = {
                    onPrepareNewSession()
                    newSessionOpen = true
                },
                onOpenSettings = { settingsOpen = true; onOpenSettings() },
                onOpenUsage = { usageOpen = true; onOpenUsage() },
                onOpenArchives = { onFetchArchives(); archivesOpen = true },
                onRestoreArchive = onRestoreArchive,
                onDismiss = { paletteOpen = false },
                currentCwd = projects.firstOrNull()?.path,
                fileMatches = fileMatches,
                onSearchFiles = onSearchFiles,
                onOpenFile = onOpenFile,
                onSlashSelected = { draft ->
                    onSlashSelected(draft)
                    onPrepareNewSession()
                    newSessionOpen = true
                },
                onOpenSessionFilePreview = onOpenSessionFilePreview,
            )
        }
        if (importOpen) {
            ImportSessionSheet(
                requester = requester,
                onImported = { id, _ ->
                    importOpen = false
                    onRefresh()
                    onOpen(id)
                },
                onDismiss = { importOpen = false },
            )
        }
        if (archivesOpen) {
            ArchivesSheet(
                archives = archives,
                onRestore = { key ->
                    scope.launch {
                        try {
                            val result = requester.request("sessions", "restore", JSONObject().put("key", key))
                            archivesOpen = false; onRefresh(); onOpen(result.getString("id"))
                        } catch (e: Exception) { listActionError = e.message }
                    }
                },
                onDismiss = { archivesOpen = false },
            )
        }
        if (selectedIds.isNotEmpty()) {
            BulkActionBar(
                count = selectedIds.size,
                korean = korean,
                onClear = { selectedIds = emptySet() },
                onArchiveAll = {
                    mutate("archive", selectedIds)
                },
                onDeleteAll = {
                    mutate("delete", selectedIds)
                },
            )
        }
        listActionError?.let {
            Text(
                it,
                color = OmpColors.StatusError,
                fontSize = 12.sp,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
        }
        if (worktreeRemoveTarget != null) {
            WorktreeRemoveSheet(
                cwd = worktreeRemoveTarget!!.first,
                path = worktreeRemoveTarget!!.second,
                forceConfirm = worktreeForceConfirm,
                error = listActionError,
                onConfirm = { force ->
                    val (cwd, path) = worktreeRemoveTarget!!
                    scope.launch {
                        try {
                            requester.request(
                                "sessions",
                                "worktrees.remove",
                                JSONObject().put("cwd", cwd).put("path", path).put("force", force),
                            )
                            onFetchWorktrees(cwd)
                            listActionError = null
                            worktreeRemoveTarget = null
                            worktreeForceConfirm = false
                        } catch (e: Exception) {
                            val message = e.message ?: ""
                            if (!force && e is com.dbchbin.ompgui.remote.relay.RelayRequestException && e.code == "worktree_dirty" && e.details?.optBoolean("dirty") == true) {
                                worktreeForceConfirm = true
                            } else {
                                listActionError = message.ifBlank { "Worktree remove failed" }
                                worktreeForceConfirm = false
                            }
                        }
                    }
                },
                onDismiss = { worktreeRemoveTarget = null; worktreeForceConfirm = false },
            )
        }
        actionSession?.let { session ->
            SessionActionSheet(
                session = session,
                renameText = renameText,
                onRenameText = { renameText = it },
                confirmDelete = confirmDelete,
                confirmArchive = confirmArchive,
                onConfirmDelete = { confirmDelete = true },
                onConfirmArchive = { confirmArchive = true },
                onDelete = { mutate("delete", setOf(session.id)); actionSession = null },
                onArchive = { mutate("archive", setOf(session.id)); actionSession = null },
                onRename = {
                    mutate("rename", setOf(session.id), renameText)
                    actionSession = null
                },
                onExport = {
                    if (exportPending == null) {
                        exportPending = session.id
                        scope.launch {
                            try {
                                shareSessionExport(
                                    context = context,
                                    requester = requester,
                                    sessionId = session.id,
                                )
                                listActionError = null
                            } catch (e: Exception) {
                                listActionError = e.message ?: "Export failed"
                            } finally {
                                exportPending = null
                            }
                        }
                    }
                    actionSession = null
                },
                onAutoname = {
                    if (autonamePending == null) {
                        autonamePending = session.id
                        scope.launch {
                            try {
                                requester.request(
                                    "sessions",
                                    "autoname",
                                    JSONObject().put("id", session.id),
                                )
                                onRefresh()
                                listActionError = null
                            } catch (e: Exception) {
                                listActionError = e.message ?: "Autoname failed"
                            } finally {
                                autonamePending = null
                            }
                        }
                    }
                    actionSession = null
                },
                exportBusy = exportPending == session.id,
                autonameBusy = autonamePending == session.id,
                onDismiss = { actionSession = null },
            )
        }
    }
}

@Composable
private fun FooterNavRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 4.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = OmpColors.TextMuted,
            modifier = Modifier.size(20.dp),
        )
        Spacer(modifier = Modifier.width(12.dp))
        Text(
            text = label,
            fontSize = 14.sp,
            color = OmpColors.Text,
            modifier = Modifier.weight(1f),
        )
        Icon(
            imageVector = Icons.Filled.ChevronRight,
            contentDescription = null,
            tint = OmpColors.TextDim,
            modifier = Modifier.size(18.dp),
        )
    }
}

@Composable
@OptIn(ExperimentalFoundationApi::class)
private fun SessionItemRow(
    session: SessionListItem,
    running: Boolean,
    now: Long,
    korean: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit = {},
    selected: Boolean = false,
    pinned: Boolean = false,
    onToggleSelect: (() -> Unit)? = null,
    onTogglePin: (() -> Unit)? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(if (selected) OmpColors.BgHover else androidx.compose.ui.graphics.Color.Transparent)
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (running) {
            RunningDot()
            Spacer(modifier = Modifier.width(8.dp))
        }
        if (pinned) {
            Text("📌", fontSize = 12.sp, modifier = Modifier.padding(end = 4.dp))
        }
        Text(
            text = sessionTitle(session),
            color = OmpColors.Text,
            fontSize = 14.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        if (onTogglePin != null) {
            Text(
                text = if (pinned) "Unpin" else "Pin",
                color = OmpColors.TextMuted,
                fontSize = 11.sp,
                modifier = Modifier
                    .clickable(onClick = onTogglePin)
                    .padding(horizontal = 6.dp, vertical = 4.dp),
            )
        }
        if (onToggleSelect != null) {
            Text(
                text = if (selected) "✓" else "○",
                color = if (selected) OmpColors.Accent else OmpColors.TextDim,
                fontSize = 13.sp,
                modifier = Modifier
                    .clickable(onClick = onToggleSelect)
                    .padding(horizontal = 6.dp, vertical = 4.dp),
            )
        }
        Spacer(modifier = Modifier.width(8.dp))
        relativeLabel(session.modified, now, korean)?.let { label ->
            Text(
                text = label,
                color = OmpColors.TextDim,
                fontSize = 12.sp,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun RunningDot() {
    val transition = rememberInfiniteTransition(label = "running")
    val alpha by transition.animateFloat(
        initialValue = 1f,
        targetValue = 0.35f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 900),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "alpha",
    )
    Box(
        modifier = Modifier
            .size(8.dp)
            .clip(CircleShape)
            .background(OmpColors.StatusSuccess.copy(alpha = alpha)),
    )
}

private fun sessionTitle(session: SessionListItem): String =
    session.name?.takeIf { it.isNotBlank() }
        ?: session.firstMessage.takeIf { it.isNotBlank() }
        ?: session.id

private fun parseInstant(raw: String): Instant? {
    if (raw.isBlank()) return null
    try {
        return Instant.parse(raw)
    } catch (_: Exception) {
    }
    try {
        return OffsetDateTime.parse(raw).toInstant()
    } catch (_: Exception) {
    }
    return try {
        LocalDateTime.parse(raw).atZone(ZoneId.systemDefault()).toInstant()
    } catch (_: Exception) {
        null
    }
}

private fun relativeLabel(modified: String, now: Long, korean: Boolean): String? {
    val instant = parseInstant(modified) ?: return null
    val millis = instant.toEpochMilli()
    val minutes = maxOf(0L, (now - millis) / 60_000L)
    if (minutes < 1) return if (korean) "현재 분" else "now"
    if (minutes < 60) return if (korean) "${minutes}분 전" else "${minutes}m ago"
    val hours = minutes / 60
    if (hours < 24) return if (korean) "${hours}시간 전" else "${hours}h ago"
    val days = hours / 24
    if (days <= 1) return if (korean) "어제" else "yesterday"
    val zoned = instant.atZone(ZoneId.systemDefault())
    val thisYear = LocalDateTime.now().year == zoned.year
    return if (korean) {
        if (thisYear) "${zoned.monthValue}월 ${zoned.dayOfMonth}일"
        else "${zoned.year}년 ${zoned.monthValue}월 ${zoned.dayOfMonth}일"
    } else {
        val pattern = if (thisYear) "MMM d" else "MMM d, yyyy"
        zoned.format(DateTimeFormatter.ofPattern(pattern, Locale.ENGLISH))
    }
}

@Composable
private fun WorktreeManageRow(
    worktrees: List<RelayWorktree>,
    korean: Boolean,
    onFetch: () -> Unit,
    onRemove: (String) -> Unit,
) {
    var expanded by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable {
                    if (!expanded) onFetch()
                    expanded = !expanded
                }
                .padding(horizontal = 4.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = Icons.Filled.Folder,
                contentDescription = null,
                tint = OmpColors.TextMuted,
                modifier = Modifier.size(20.dp),
            )
            Spacer(modifier = Modifier.width(12.dp))
            Text(
                text = if (korean) "Worktree (${worktrees.size})" else "Worktrees (${worktrees.size})",
                fontSize = 14.sp,
                color = OmpColors.Text,
                modifier = Modifier.weight(1f),
            )
            Icon(
                imageVector = Icons.Filled.ChevronRight,
                contentDescription = null,
                tint = OmpColors.TextDim,
                modifier = Modifier.size(18.dp),
            )
        }
        if (expanded) {
            // Phantom worktrees never render: only server-listed entries with a
            // non-blank path are shown, each with explicit remove (main excluded).
            worktrees.filter { it.path.isNotBlank() }.forEach { worktree ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 4.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = (worktree.branch ?: worktree.path.substringAfterLast('/')) +
                            if (worktree.isMain) " (main)" else "",
                        fontSize = 13.sp,
                        color = OmpColors.Text,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    if (!worktree.isMain) {
                        Text(
                            text = if (korean) "제거" else "Remove",
                            fontSize = 12.sp,
                            color = OmpColors.StatusError,
                            modifier = Modifier
                                .clickable { onRemove(worktree.path) }
                                .padding(horizontal = 8.dp, vertical = 4.dp),
                        )
                    }
                }
                Text(
                    text = worktree.path,
                    fontSize = 11.sp,
                    color = OmpColors.TextDim,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(horizontal = 4.dp),
                )
            }
        }
    }
}

@Composable
private fun BulkActionBar(
    count: Int,
    korean: Boolean,
    onClear: () -> Unit,
    onArchiveAll: () -> Unit,
    onDeleteAll: () -> Unit,
) {
    var confirmBulkDelete by androidx.compose.runtime.remember(count) { androidx.compose.runtime.mutableStateOf(false) }
    var confirmBulkArchive by androidx.compose.runtime.remember(count) { androidx.compose.runtime.mutableStateOf(false) }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(OmpColors.BgPanel)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = if (korean) "${count}개 선택됨" else "$count selected",
                fontSize = 13.sp,
                color = OmpColors.Text,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            Text(
                text = if (korean) "해제" else "Clear",
                color = OmpColors.TextMuted,
                fontSize = 13.sp,
                modifier = Modifier.clickable(onClick = onClear).padding(horizontal = 8.dp, vertical = 4.dp),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                text = if (confirmBulkArchive) "Confirm archive all?" else if (korean) "모두 보관" else "Archive all",
                color = OmpColors.Text,
                fontSize = 13.sp,
                modifier = Modifier.clickable { if (confirmBulkArchive) onArchiveAll() else confirmBulkArchive = true }.padding(vertical = 4.dp),
            )
            if (confirmBulkDelete) {
                Text(
                    text = if (korean) "정말 모두 삭제할까요? 다시 탭하여 확인" else "Confirm delete all?",
                    color = OmpColors.StatusError,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.clickable(onClick = onDeleteAll).padding(vertical = 4.dp),
                )
            } else {
                Text(
                    text = if (korean) "모두 삭제" else "Delete all",
                    color = OmpColors.StatusError,
                    fontSize = 13.sp,
                    modifier = Modifier.clickable(onClick = { confirmBulkDelete = true }).padding(vertical = 4.dp),
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun WorktreeRemoveSheet(
    cwd: String,
    path: String,
    forceConfirm: Boolean,
    error: String?,
    onConfirm: (force: Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    val korean = remember { Locale.getDefault().language == "ko" }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = OmpColors.BgPanel,
        contentColor = OmpColors.Text,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                if (korean) "Worktree 제거" else "Remove worktree",
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                color = OmpColors.Text,
            )
            Text(path, fontSize = 13.sp, color = OmpColors.TextMuted)
            error?.let { Text(it, fontSize = 13.sp, color = OmpColors.StatusError) }
            Text(
                if (korean) "브랜치는 유지되며 체크아웃만 제거됩니다." else "The branch is kept; only the checkout is removed.",
                fontSize = 13.sp,
                color = OmpColors.TextMuted,
            )
            if (forceConfirm) {
                Text(
                    if (korean) "수정/추적되지 않은 파일이 있습니다. 강제 제거할까요?" else "Worktree is dirty. Force remove?",
                    fontSize = 14.sp,
                    color = OmpColors.StatusWarning,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    if (korean) "강제 제거 확인" else "Confirm force remove",
                    color = OmpColors.StatusError,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.clickable(onClick = { onConfirm(true) }).padding(vertical = 6.dp),
                )
            } else {
                Text(
                    if (korean) "제거" else "Remove",
                    color = OmpColors.StatusError,
                    modifier = Modifier.clickable(onClick = { onConfirm(false) }).padding(vertical = 6.dp),
                )
            }
            Text(
                if (korean) "취소" else "Cancel",
                color = OmpColors.TextMuted,
                modifier = Modifier.clickable(onClick = onDismiss).padding(vertical = 6.dp),
            )
        }
    }
}

internal suspend fun shareSessionExport(
    context: android.content.Context,
    requester: RelayRequester,
    sessionId: String,
) {
    val started = requester.request("sessions", "export", JSONObject().put("id", sessionId))
    val fileName = started.getString("fileName")
    val transferId = started.optString("transferId")
    val uri = if (started.has("html")) {
        val bytes = started.getString("html").toByteArray(Charsets.UTF_8)
        createCachedDownload(context, fileName) { offset ->
            val end = minOf(bytes.size.toLong(), offset + 96 * 1024).toInt()
            JSONObject().put("data", android.util.Base64.encodeToString(bytes.copyOfRange(offset.toInt(), end), android.util.Base64.NO_WRAP))
                .put("nextOffset", end).put("complete", end == bytes.size)
        }
    } else {
        require(transferId.isNotBlank()) { "Export did not return HTML or a transfer" }
        try {
            createCachedDownload(context, fileName) { offset ->
                requester.request("sessions", "exportChunk", JSONObject().put("transferId", transferId)
                    .put("offset", offset).put("length", 96 * 1024))
            }
        } finally {
            withContext(NonCancellable) {
                try { requester.request("sessions", "exportClose", JSONObject().put("transferId", transferId)) }
                catch (_: Exception) { /* Server expires abandoned transfers. */ }
            }
        }
    }
    shareFile(context, uri, "text/html")
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ArchivesSheet(
    archives: List<RelayArchive>,
    onRestore: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = OmpColors.BgPanel,
        contentColor = OmpColors.Text,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(if (Locale.getDefault().language == "ko") "보관함" else "Archives", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = OmpColors.Text)
            if (archives.isEmpty()) {
                Text("보관된 세션이 없습니다", color = OmpColors.TextMuted, fontSize = 14.sp)
            } else {
                archives.forEach { archive ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onRestore(archive.key) }
                            .padding(vertical = 10.dp),
                    ) {
                        Text(archive.name ?: archive.key, color = OmpColors.Text, fontSize = 14.sp)
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SessionActionSheet(
    session: SessionListItem,
    renameText: String,
    onRenameText: (String) -> Unit,
    confirmDelete: Boolean,
    confirmArchive: Boolean,
    onConfirmDelete: () -> Unit,
    onConfirmArchive: () -> Unit,
    onDelete: () -> Unit,
    onArchive: () -> Unit,
    onRename: () -> Unit,
    onExport: () -> Unit = {},
    onAutoname: () -> Unit = {},
    exportBusy: Boolean = false,
    autonameBusy: Boolean = false,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = OmpColors.BgPanel,
        contentColor = OmpColors.Text,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(session.name?.ifBlank { null } ?: session.id, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = OmpColors.Text)
            BasicTextField(
                value = renameText,
                onValueChange = onRenameText,
                textStyle = TextStyle(fontSize = 14.sp, color = OmpColors.Text),
                cursorBrush = SolidColor(OmpColors.Accent),
                modifier = Modifier.fillMaxWidth(),
            )
            Text("이름 변경", color = OmpColors.Accent, modifier = Modifier.clickable(onClick = onRename).padding(vertical = 6.dp))
            Text(
                if (autonameBusy) "이름 자동 생성 중…" else "이름 자동 생성",
                color = OmpColors.Text,
                modifier = Modifier.clickable(enabled = !autonameBusy, onClick = onAutoname).padding(vertical = 6.dp),
            )
            Text(
                if (exportBusy) "내보내는 중…" else if (Locale.getDefault().language == "ko") "내보내기" else "Export",
                color = OmpColors.Text,
                modifier = Modifier.clickable(enabled = !exportBusy, onClick = onExport).padding(vertical = 6.dp),
            )
            if (confirmArchive) {
                Text("보관할까요?", color = OmpColors.StatusWarning)
                Text("보관 확인", color = OmpColors.Accent, modifier = Modifier.clickable(onClick = onArchive).padding(vertical = 6.dp))
            } else {
                Text("보관", color = OmpColors.Text, modifier = Modifier.clickable(onClick = onConfirmArchive).padding(vertical = 6.dp))
            }
            if (confirmDelete) {
                Text("세션을 삭제할까요?", color = OmpColors.StatusError)
                Text("삭제 확인", color = OmpColors.StatusError, modifier = Modifier.clickable(onClick = onDelete).padding(vertical = 6.dp))
            } else {
                Text("삭제", color = OmpColors.StatusError, modifier = Modifier.clickable(onClick = onConfirmDelete).padding(vertical = 6.dp))
            }
            Text("취소", color = OmpColors.TextMuted, modifier = Modifier.clickable(onClick = onDismiss).padding(vertical = 6.dp))
        }
    }
}
