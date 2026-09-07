package com.dbchbin.ompgui.remote.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.ui.semantics.selected
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import kotlinx.coroutines.CancellationException
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
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
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import com.dbchbin.ompgui.remote.relay.createCachedDownload
import com.dbchbin.ompgui.remote.relay.shareFile
import kotlinx.coroutines.launch
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import com.dbchbin.ompgui.remote.relay.RelayFileMatch
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
    onPrepareNewSession: () -> Unit = {},
    projects: List<RelayProject> = emptyList(),
    creatingSession: Boolean = false,
    archives: List<RelayArchive> = emptyList(),
    slashCommands: List<RelaySlashCommand> = emptyList(),
    worktrees: List<RelayWorktree> = emptyList(),
    worktreesGit: Boolean = false,
    worktreesError: String? = null,
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
    onOpenUsage: () -> Unit = {},
    fileMatches: List<RelayFileMatch> = emptyList(),
    onSearchFiles: (String, String) -> Unit = { _, _ -> },
    onSlashSelected: (String) -> Unit,
    initialDraft: String,
    onOpenSessionFilePreview: (String, String) -> Unit,
    onAddProject: (String) -> Unit = {},
    onRemoveProject: suspend (String) -> Unit = {},
) {
    val context = LocalContext.current
    var overflowOpen by remember { mutableStateOf(false) }
    var projectsOpen by remember { mutableStateOf(false) }
    var worktreesOpen by remember { mutableStateOf(false) }
    var projectMenu by remember { mutableStateOf<String?>(null) }
    var query by rememberSaveable { mutableStateOf("") }
    var bodySearch by rememberSaveable { mutableStateOf(false) }
    val searchActive = query.isNotBlank()
    val listState = rememberLazyListState()
    val focusManager = LocalFocusManager.current
    val keyboardController = LocalSoftwareKeyboardController.current
    LaunchedEffect(query) {
        listState.scrollToItem(0)
    }
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
    var projectRemoveTarget by remember { mutableStateOf<RelayProject?>(null) }
    var projectRemovePending by remember { mutableStateOf(false) }
    var projectRemoveError by remember { mutableStateOf<String?>(null) }
    val orderedProjects = remember(projects, projectOrder) {
        projects.sortedBy { projectOrder.indexOf(it.path).let { index -> if (index < 0) Int.MAX_VALUE else index } }
    }
    val orderedProjectKeys = remember(projects, sessions, projectOrder) {
        val sessionsByProject = sessions.groupBy { it.projectRoot ?: it.cwd }
        val recency = sessionsByProject.mapValues { (_, items) ->
            items.mapNotNull { parseInstant(it.modified)?.toEpochMilli() }.maxOrNull() ?: Long.MIN_VALUE
        }
        (projects.map { it.path } + sessionsByProject.keys).distinct().sortedWith(
            compareBy<String> { projectOrder.indexOf(it).let { index -> if (index < 0) Int.MAX_VALUE else index } }
                .thenByDescending { recency[it] ?: Long.MIN_VALUE }
                .thenBy { path -> (projects.firstOrNull { it.path == path }?.name ?: path.substringAfterLast('/')).lowercase() },
        )
    }
    LaunchedEffect(projects) {
        if (selectedProject != null && projects.none { it.path == selectedProject }) {
            selectedProject = orderedProjects.firstOrNull()?.path
            selectedProject?.let(onFetchWorktrees)
        }
    }
    val scope = androidx.compose.runtime.rememberCoroutineScope()
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


    val groups = remember(sessions, projects, runningIds, query, runningOnly, selectedProject, projectOrder) {
        val q = query.trim()
        val visible = sessions.filter { session ->
            (q.isBlank() ||
                sessionTitle(session).contains(q, ignoreCase = true) ||
                session.cwd.contains(q, ignoreCase = true) ||
                session.id.contains(q, ignoreCase = true)) &&
                (!runningOnly || session.id in runningIds) &&
                (selectedProject == null || (session.projectRoot ?: session.cwd) == selectedProject)
        }
        val grouped = visible.groupBy { session -> session.projectRoot ?: session.cwd }.toMutableMap()
        if (q.isBlank() && !runningOnly) projects.filter { selectedProject == null || it.path == selectedProject }.forEach { project ->
            grouped.putIfAbsent(project.path, emptyList())
        }
        grouped.map { (key, list) ->
            ProjectGroup(
                key = key,
                title = projects.firstOrNull { it.path == key }?.name ?: key.substringAfterLast('/').ifBlank { key },
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
                .heightIn(min = 48.dp)
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = stringResource(R.string.app_name),
                fontWeight = FontWeight.Bold,
                fontSize = 18.sp,
                letterSpacing = (-0.5).sp,
                color = OmpColors.Text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            IconButton(onClick = onRefresh) {
                Icon(Icons.Filled.Refresh, stringResource(R.string.sessions_refresh), tint = OmpColors.TextMuted)
            }
            Box {
                IconButton(onClick = { overflowOpen = true }) {
                    Icon(Icons.Filled.MoreHoriz, stringResource(R.string.session_list_workspace_actions), tint = OmpColors.TextMuted)
                }
                DropdownMenu(expanded = overflowOpen, onDismissRequest = { overflowOpen = false }) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.session_list_command_palette)) }, onClick = { overflowOpen = false; paletteOpen = true })
                    DropdownMenuItem(text = { Text(stringResource(R.string.session_list_archives)) }, onClick = { overflowOpen = false; onFetchArchives(); archivesOpen = true })
                    DropdownMenuItem(text = { Text(stringResource(R.string.session_list_import_session)) }, onClick = { overflowOpen = false; importOpen = true })
                    DropdownMenuItem(text = { Text(stringResource(R.string.session_list_manage_projects)) }, onClick = { overflowOpen = false; projectsOpen = true })
                    DropdownMenuItem(text = { Text(stringResource(R.string.sessions_unpair)) }, onClick = { overflowOpen = false; onUnpair() })
                }
            }
        }
        OutlinedButton(
            onClick = { onPrepareNewSession(); newSessionOpen = true },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp).heightIn(min = 48.dp),
            shape = RoundedCornerShape(8.dp),
        ) {
            Icon(Icons.Filled.Add, null, tint = OmpColors.Accent, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.new_session), color = OmpColors.Text)
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
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.session_list_workspaces_header), color = OmpColors.TextMuted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            Box {
                IconButton(onClick = { projectsOpen = true }) {
                    Icon(Icons.Filled.MoreHoriz, stringResource(R.string.session_list_filter_manage_projects), tint = if (runningOnly || selectedProject != null) OmpColors.Accent else OmpColors.TextMuted)
                }
            }
        }
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            singleLine = true,
            label = { Text(stringResource(if (bodySearch) R.string.body_search_prompt else R.string.search_sessions_placeholder)) },
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null, tint = OmpColors.TextMuted) },
            trailingIcon = {
                if (query.isNotEmpty()) {
                    IconButton(onClick = {
                        query = ""
                        focusManager.clearFocus()
                        keyboardController?.hide()
                    }) {
                        Icon(Icons.Filled.Close, stringResource(R.string.session_search_clear), tint = OmpColors.TextMuted)
                    }
                }
            },
            textStyle = TextStyle(fontSize = 16.sp),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = {
                focusManager.clearFocus()
                keyboardController?.hide()
            }),
            colors = OutlinedTextFieldDefaults.colors(
                focusedTextColor = OmpColors.Text,
                unfocusedTextColor = OmpColors.Text,
                focusedLabelColor = OmpColors.Text,
                unfocusedLabelColor = OmpColors.TextMuted,
                cursorColor = OmpColors.Text,
            ),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
        )
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = { bodySearch = false }, modifier = Modifier.heightIn(min = 48.dp).semantics { selected = !bodySearch }) {
                Text(stringResource(R.string.body_search_metadata), color = if (!bodySearch) OmpColors.Accent else OmpColors.TextMuted)
            }
            TextButton(onClick = { bodySearch = true; runningOnly = false }, modifier = Modifier.heightIn(min = 48.dp).semantics { selected = bodySearch }) {
                Text(stringResource(R.string.body_search_body), color = if (bodySearch) OmpColors.Accent else OmpColors.TextMuted)
            }
        }
        if (selectedProject != null || runningOnly) {
            TextButton(onClick = { selectedProject = null; runningOnly = false }, modifier = Modifier.fillMaxWidth()) {
                val runningPrefix = if (runningOnly) stringResource(R.string.session_list_running_prefix) else ""
                val projectLabel = selectedProject?.substringAfterLast('/') ?: stringResource(R.string.session_list_all_projects)
                Text(stringResource(R.string.session_list_filter_chip, runningPrefix, projectLabel), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (bodySearch) {
            SessionBodySearch(
                requester = requester,
                query = query,
                projectRoot = selectedProject,
                onReset = { query = ""; selectedProject = null; runningOnly = false },
                onOpen = onOpen,
                modifier = Modifier.fillMaxWidth().weight(1f),
            )
        } else PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = onRefresh,
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
        ) {
            if (groups.isEmpty()) {
                Text(
                    stringResource(if (searchActive) R.string.session_search_no_matches else R.string.sessions_empty),
                    color = OmpColors.TextMuted,
                    fontSize = 14.sp,
                    modifier = Modifier.padding(24.dp),
                )
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    items(groups, key = { it.key }) { group ->
                        val expanded = searchActive || group.key !in collapsed
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(8.dp)),
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(if (selectedProject == group.key) OmpColors.BgHover else androidx.compose.ui.graphics.Color.Transparent)
                                    .semantics { selected = selectedProject == group.key }
                                    .clickable(enabled = !searchActive) {
                                        collapsed = if (expanded) {
                                            collapsed + group.key
                                        } else {
                                            collapsed - group.key
                                        }
                                    }
                                    .heightIn(min = 48.dp)
                                    .padding(horizontal = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(
                                    imageVector = Icons.Filled.Folder,
                                    contentDescription = null,
                                    tint = OmpColors.Accent,
                                    modifier = Modifier.size(18.dp),
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(group.title, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
                                        color = OmpColors.Text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    group.branch?.let { branch ->
                                        Text(branch, fontSize = 12.sp, color = OmpColors.TextDim, maxLines = 1, overflow = TextOverflow.Ellipsis)
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
                                Box {
                                    IconButton(onClick = { projectMenu = group.key }) {
                                        Icon(Icons.Filled.MoreHoriz, stringResource(R.string.session_list_actions_for, group.title), tint = OmpColors.TextMuted, modifier = Modifier.size(18.dp))
                                    }
                                    DropdownMenu(expanded = projectMenu == group.key && !projectsOpen, onDismissRequest = { projectMenu = null }) {
                                        DropdownMenuItem(text = { Text(stringResource(R.string.session_list_filter_to_project)) }, onClick = { selectedProject = group.key; projectMenu = null })
                                        DropdownMenuItem(text = { Text(stringResource(R.string.session_list_worktrees)) }, onClick = { selectedProject = group.key; onFetchWorktrees(group.key); projectMenu = null; worktreesOpen = true })
                                        DropdownMenuItem(text = { Text(stringResource(R.string.session_list_move_up)) }, enabled = orderedProjectKeys.indexOf(group.key) > 0, onClick = {
                                            val index = orderedProjectKeys.indexOf(group.key)
                                            projectOrder = orderedProjectKeys.toMutableList().apply { add(index - 1, removeAt(index)) }
                                            projectMenu = null
                                        })
                                        DropdownMenuItem(text = { Text(stringResource(R.string.session_list_move_down)) }, enabled = orderedProjectKeys.indexOf(group.key) < orderedProjectKeys.lastIndex, onClick = {
                                            val index = orderedProjectKeys.indexOf(group.key)
                                            projectOrder = orderedProjectKeys.toMutableList().apply { add(index + 1, removeAt(index)) }
                                            projectMenu = null
                                        })
                                        DropdownMenuItem(text = { Text(stringResource(R.string.session_list_move_to_top)) }, onClick = { projectOrder = listOf(group.key) + orderedProjectKeys.filter { it != group.key }; projectMenu = null })
                                        projects.firstOrNull { it.path == group.key }?.let { project ->
                                            DropdownMenuItem(text = { Text(stringResource(R.string.session_list_remove_project), color = OmpColors.StatusError) }, enabled = !projectRemovePending,
                                                onClick = { projectRemoveError = null; projectRemoveTarget = project; projectMenu = null })
                                        }
                                    }
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
                                if (group.sessions.isEmpty()) {
                                    Text(stringResource(R.string.session_list_no_sessions_yet), color = OmpColors.TextDim,
                                        fontSize = 13.sp, modifier = Modifier.padding(start = 24.dp, top = 12.dp, bottom = 12.dp))
                                }
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
                                                focusManager.clearFocus()
                                                keyboardController?.hide()
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
        HorizontalDivider(color = OmpColors.Border)
        Row(Modifier.fillMaxWidth().background(OmpColors.BgPanel).padding(horizontal = 12.dp)) {
            Box(Modifier.weight(1f)) { FooterNavRow(Icons.Filled.Settings, stringResource(R.string.session_list_settings)) { settingsOpen = true } }
            Box(Modifier.weight(1f)) { FooterNavRow(Icons.Filled.Speed, stringResource(R.string.session_list_usage)) { usageOpen = true; onOpenUsage() } }
        }
        if (projectsOpen) {
            OmpModalSheet(onDismissRequest = { projectsOpen = false }, containerColor = OmpColors.Bg) {
                OmpDialogSystemBars()
                Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 16.dp)) {
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.session_list_projects), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        IconButton(onClick = { projectsOpen = false }) { Icon(Icons.Filled.Close, stringResource(R.string.session_list_close_projects)) }
                    }
                    TextButton(onClick = { selectedProject = null; projectsOpen = false }) { Text(stringResource(R.string.session_list_all_projects)) }
                    TextButton(onClick = { runningOnly = !runningOnly }, enabled = !bodySearch) { Text(if (runningOnly) stringResource(R.string.session_list_show_all_sessions) else stringResource(R.string.session_list_show_running_only)) }
                    orderedProjects.forEach { project ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            TextButton(onClick = { selectedProject = project.path; onFetchWorktrees(project.path); projectsOpen = false }, modifier = Modifier.weight(1f)) {
                                Text(project.name, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.fillMaxWidth())
                            }
                            Box {
                                IconButton(onClick = { projectMenu = project.path }) { Icon(Icons.Filled.MoreHoriz, stringResource(R.string.session_list_actions_for, project.name)) }
                                DropdownMenu(expanded = projectMenu == project.path, onDismissRequest = { projectMenu = null }) {
                                    DropdownMenuItem(text = { Text(stringResource(R.string.session_list_move_up)) }, enabled = orderedProjectKeys.indexOf(project.path) > 0, onClick = {
                                        val index = orderedProjectKeys.indexOf(project.path)
                                        projectOrder = orderedProjectKeys.toMutableList().apply { add(index - 1, removeAt(index)) }
                                        projectMenu = null
                                    })
                                    DropdownMenuItem(text = { Text(stringResource(R.string.session_list_move_down)) }, enabled = orderedProjectKeys.indexOf(project.path) < orderedProjectKeys.lastIndex, onClick = {
                                        val index = orderedProjectKeys.indexOf(project.path)
                                        projectOrder = orderedProjectKeys.toMutableList().apply { add(index + 1, removeAt(index)) }
                                        projectMenu = null
                                    })
                                    DropdownMenuItem(text = { Text(stringResource(R.string.session_list_move_to_top)) }, onClick = { projectOrder = listOf(project.path) + orderedProjectKeys.filter { it != project.path }; projectMenu = null })
                                    DropdownMenuItem(text = { Text(stringResource(R.string.session_list_worktrees)) }, onClick = { selectedProject = project.path; onFetchWorktrees(project.path); projectMenu = null; projectsOpen = false; worktreesOpen = true })
                                    DropdownMenuItem(text = { Text(stringResource(R.string.session_list_remove_project), color = OmpColors.StatusError) }, enabled = !projectRemovePending, onClick = { projectRemoveError = null; projectRemoveTarget = project; projectMenu = null; projectsOpen = false })
                                }
                            }
                        }
                    }
                    TextButton(onClick = { projectsOpen = false; onPrepareNewSession(); newSessionOpen = true }) { Text(stringResource(R.string.session_list_add_project_new_session)) }
                }
            }
        }
        if (worktreesOpen) {
            OmpModalSheet(onDismissRequest = { worktreesOpen = false }, containerColor = OmpColors.Bg) {
                OmpDialogSystemBars()
                Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 16.dp)) {
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.session_list_worktrees), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        IconButton(onClick = { worktreesOpen = false }) { Icon(Icons.Filled.Close, stringResource(R.string.session_list_close_worktrees)) }
                    }
                    Text(selectedProject.orEmpty(), color = OmpColors.TextMuted, fontSize = 12.sp)
                    worktreesError?.takeIf { it.isNotBlank() }?.let {
                        Text(it, color = OmpColors.StatusError, fontSize = 13.sp, modifier = Modifier.padding(vertical = 4.dp))
                    }
                    if (worktreesError.isNullOrBlank() && worktreesGit) WorktreeManageRow(worktrees,
                        onFetch = { selectedProject?.let(onFetchWorktrees) },
                        onRemove = { path -> selectedProject?.let { worktreeForceConfirm = false; worktreeRemoveTarget = it to path } })
                    else if (worktreesError.isNullOrBlank()) Text(stringResource(R.string.session_list_no_git_worktrees), color = OmpColors.TextMuted, modifier = Modifier.padding(vertical = 12.dp))
                    TextButton(onClick = { worktreesOpen = false; onPrepareNewSession(); newSessionOpen = true }) { Text(stringResource(R.string.session_list_new_session_add_worktree)) }
                }
            }
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
                initialCwd = selectedProject,
                worktrees = worktrees,
                worktreesGit = worktreesGit,
                worktreesError = worktreesError,
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
                onOpenSettings = { settingsOpen = true },
                onOpenUsage = { usageOpen = true; onOpenUsage() },
                onOpenArchives = { onFetchArchives(); archivesOpen = true },
                onRestoreArchive = onRestoreArchive,
                onDismiss = { paletteOpen = false },
                currentCwd = projects.firstOrNull()?.path,
                fileMatches = fileMatches,
                onSearchFiles = onSearchFiles,
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
                    val result = requester.request("sessions", "restore", JSONObject().put("key", key))
                    val id = result.getString("id")
                    archivesOpen = false
                    onRefresh()
                    onOpen(id)
                },
                onDismiss = { archivesOpen = false },
            )
        }
        if (selectedIds.isNotEmpty()) {
            BulkActionBar(
                count = selectedIds.size,
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
        projectRemoveTarget?.let { project ->
            AlertDialog(
                onDismissRequest = { if (!projectRemovePending) projectRemoveTarget = null },
                containerColor = OmpColors.Bg,
                title = {
                    OmpDialogSystemBars()
                    Text(stringResource(R.string.session_list_remove_project_title, project.name), color = OmpColors.Text)
                },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(project.path, color = OmpColors.Text)
                        Text(
                            stringResource(R.string.session_list_remove_project_body),
                            color = OmpColors.TextMuted,
                        )
                        projectRemoveError?.let { Text(it, color = OmpColors.StatusError) }
                    }
                },
                confirmButton = {
                    TextButton(
                        enabled = !projectRemovePending,
                        onClick = {
                            if (!projectRemovePending) {
                                projectRemovePending = true
                                projectRemoveError = null
                                scope.launch {
                                    try {
                                        onRemoveProject(project.path)
                                        if (selectedProject == project.path) {
                                            selectedProject = orderedProjects.firstOrNull { it.path != project.path }?.path
                                            selectedProject?.let(onFetchWorktrees)
                                        }
                                        projectOrder = projectOrder - project.path
                                        collapsed = collapsed - project.path
                                        selectedIds = selectedIds - sessions.filter {
                                            (it.projectRoot ?: it.cwd) == project.path
                                        }.map { it.id }.toSet()
                                        projectRemoveTarget = null
                                    } catch (e: CancellationException) {
                                        throw e
                                    } catch (e: Exception) {
                                        projectRemoveError = e.message?.takeIf { it.isNotBlank() } ?: context.getString(R.string.session_list_project_removal_failed)
                                    } finally {
                                        projectRemovePending = false
                                    }
                                }
                            }
                        },
                    ) {
                        Text(if (projectRemovePending) stringResource(R.string.session_list_removing) else stringResource(R.string.session_list_remove_project))
                    }
                },
                dismissButton = {
                    TextButton(enabled = !projectRemovePending, onClick = { projectRemoveTarget = null }) {
                        Text(stringResource(R.string.session_list_cancel))
                    }
                },
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
                                listActionError = message.ifBlank { context.getString(R.string.session_list_worktree_remove_failed) }
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
                                listActionError = e.message ?: context.getString(R.string.session_list_export_failed)
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
                                listActionError = e.message ?: context.getString(R.string.session_list_autoname_failed)
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
            .heightIn(min = 48.dp)
            .padding(horizontal = 4.dp, vertical = 8.dp),
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
    onClick: () -> Unit,
    onLongClick: () -> Unit = {},
    selected: Boolean = false,
    pinned: Boolean = false,
    onToggleSelect: (() -> Unit)? = null,
    onTogglePin: (() -> Unit)? = null,
) {
    val context = LocalContext.current
    var rowMenuOpen by remember { mutableStateOf(false) }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .semantics { this.selected = selected }
            .heightIn(min = 48.dp)
            .background(if (selected) OmpColors.BgHover else androidx.compose.ui.graphics.Color.Transparent)
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .padding(start = 24.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (running) {
            RunningDot()
            Spacer(modifier = Modifier.width(8.dp))
        }
        if (pinned) {
            Icon(Icons.Filled.PushPin, stringResource(R.string.session_list_pinned), tint = OmpColors.TextMuted, modifier = Modifier.size(14.dp))
        }
        Text(
            text = sessionTitle(session),
            color = OmpColors.Text,
            fontSize = 14.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        if (onToggleSelect != null && selected) {
            IconButton(onClick = onToggleSelect) { Icon(Icons.Filled.CheckCircle, stringResource(R.string.session_list_deselect_session), tint = OmpColors.Accent, modifier = Modifier.size(18.dp)) }
        }
        Spacer(modifier = Modifier.width(8.dp))
        relativeLabel(context, session.modified, now)?.let { label ->
            Text(
                text = label,
                color = OmpColors.TextDim,
                fontSize = 12.sp,
                maxLines = 1,
            )
        }
        Box {
            IconButton(onClick = { rowMenuOpen = true }) {
                Icon(Icons.Filled.MoreHoriz, stringResource(R.string.session_list_actions_for, sessionTitle(session)), tint = OmpColors.TextDim, modifier = Modifier.size(18.dp))
            }
            DropdownMenu(expanded = rowMenuOpen, onDismissRequest = { rowMenuOpen = false }) {
                DropdownMenuItem(text = { Text(stringResource(R.string.session_list_session_actions)) }, onClick = { rowMenuOpen = false; onLongClick() })
                onTogglePin?.let { toggle -> DropdownMenuItem(text = { Text(if (pinned) stringResource(R.string.session_list_unpin) else stringResource(R.string.session_list_pin)) }, onClick = { rowMenuOpen = false; toggle() }) }
                onToggleSelect?.let { toggle -> DropdownMenuItem(text = { Text(if (selected) stringResource(R.string.session_list_deselect) else stringResource(R.string.session_list_select)) }, onClick = { rowMenuOpen = false; toggle() }) }
            }
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

private fun relativeLabel(context: android.content.Context, modified: String, now: Long): String? {
    val instant = parseInstant(modified) ?: return null
    val millis = instant.toEpochMilli()
    val minutes = maxOf(0L, (now - millis) / 60_000L)
    if (minutes < 1) return context.getString(R.string.session_list_relative_now)
    if (minutes < 60) return context.getString(R.string.session_list_relative_minutes, minutes)
    val hours = minutes / 60
    if (hours < 24) return context.getString(R.string.session_list_relative_hours, hours)
    val days = hours / 24
    if (days <= 1) return context.getString(R.string.session_list_relative_yesterday)
    val zoned = instant.atZone(ZoneId.systemDefault())
    val thisYear = LocalDateTime.now().year == zoned.year
    val pattern = if (thisYear) "MMM d" else "MMM d, yyyy"
    return zoned.format(DateTimeFormatter.ofPattern(pattern))
}

@Composable
private fun WorktreeManageRow(
    worktrees: List<RelayWorktree>,
    onFetch: () -> Unit,
    onRemove: (String) -> Unit,
) {
    var expanded by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(true) }
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable {
                    if (!expanded) onFetch()
                    expanded = !expanded
                }
                .heightIn(min = 48.dp)
                .padding(horizontal = 4.dp, vertical = 8.dp),
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
                text = stringResource(R.string.session_list_worktrees_count, worktrees.size),
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
                            if (worktree.isMain) stringResource(R.string.session_list_worktree_main_suffix) else "",
                        fontSize = 13.sp,
                        color = OmpColors.Text,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    if (!worktree.isMain) {
                        TextButton(onClick = { onRemove(worktree.path) }, modifier = Modifier.heightIn(min = 48.dp)) {
                            Text(stringResource(R.string.session_list_remove), fontSize = 12.sp, color = OmpColors.StatusError)
                        }
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
                text = stringResource(R.string.session_list_selected_count, count),
                fontSize = 13.sp,
                color = OmpColors.Text,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            Text(
                text = stringResource(R.string.session_list_clear_selection),
                color = OmpColors.TextMuted,
                fontSize = 13.sp,
                modifier = Modifier.clickable(onClick = onClear).heightIn(min = 48.dp).padding(horizontal = 8.dp, vertical = 12.dp),
            )
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(
                onClick = { if (confirmBulkArchive) onArchiveAll() else confirmBulkArchive = true },
                modifier = Modifier.weight(1f).heightIn(min = 48.dp),
            ) {
                Text(if (confirmBulkArchive) stringResource(R.string.session_list_confirm_archive_all) else stringResource(R.string.session_list_archive_all), color = OmpColors.Text)
            }
            TextButton(
                onClick = { if (confirmBulkDelete) onDeleteAll() else confirmBulkDelete = true },
                modifier = Modifier.weight(1f).heightIn(min = 48.dp),
            ) {
                Text(if (confirmBulkDelete) stringResource(R.string.session_list_confirm_delete_all) else stringResource(R.string.session_list_delete_all), color = OmpColors.StatusError)
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
    OmpModalSheet(
        onDismissRequest = onDismiss,
        containerColor = OmpColors.Bg,
        contentColor = OmpColors.Text,
    ) {
        OmpDialogSystemBars()
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    stringResource(R.string.session_list_remove_worktree),
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    color = OmpColors.Text,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = onDismiss) { Icon(Icons.Filled.Close, stringResource(R.string.session_list_close)) }
            }
            Text(path, fontSize = 13.sp, color = OmpColors.TextMuted)
            error?.let { Text(it, fontSize = 13.sp, color = OmpColors.StatusError) }
            Text(
                stringResource(R.string.session_list_worktree_remove_hint),
                fontSize = 13.sp,
                color = OmpColors.TextMuted,
            )
            if (forceConfirm) {
                Text(
                    stringResource(R.string.session_list_worktree_dirty_force),
                    fontSize = 14.sp,
                    color = OmpColors.StatusWarning,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    stringResource(R.string.session_list_confirm_force_remove),
                    color = OmpColors.StatusError,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.fillMaxWidth().clickable(onClick = { onConfirm(true) }).heightIn(min = 48.dp).padding(vertical = 12.dp),
                )
            } else {
                Text(
                    stringResource(R.string.session_list_remove),
                    color = OmpColors.StatusError,
                    modifier = Modifier.fillMaxWidth().clickable(onClick = { onConfirm(false) }).heightIn(min = 48.dp).padding(vertical = 12.dp),
                )
            }
            Text(
                stringResource(R.string.session_list_cancel),
                color = OmpColors.TextMuted,
                modifier = Modifier.fillMaxWidth().clickable(onClick = onDismiss).heightIn(min = 48.dp).padding(vertical = 12.dp),
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

internal fun filterArchives(archives: List<RelayArchive>, query: String): List<RelayArchive> {
    val search = query.trim()
    if (search.isEmpty()) return archives
    return archives.filter { archive ->
        archive.name?.contains(search, ignoreCase = true) == true ||
            archive.id?.contains(search, ignoreCase = true) == true ||
            archive.key.contains(search, ignoreCase = true) ||
            archive.cwd?.contains(search, ignoreCase = true) == true
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ArchivesSheet(
    archives: List<RelayArchive>,
    onRestore: suspend (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    var query by rememberSaveable { mutableStateOf("") }
    val matches = remember(archives, query) { filterArchives(archives, query) }
    val listState = rememberLazyListState()
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    var restoringKey by remember { mutableStateOf<String?>(null) }
    var restoreError by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(query) { listState.scrollToItem(0) }
    OmpModalSheet(
        onDismissRequest = onDismiss,
        containerColor = OmpColors.Bg,
        contentColor = OmpColors.Text,
    ) {
        OmpDialogSystemBars()
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.session_list_archives), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = OmpColors.Text, modifier = Modifier.weight(1f))
                IconButton(onClick = onDismiss) { Icon(Icons.Filled.Close, stringResource(R.string.session_list_close_archives)) }
            }
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                label = { Text(stringResource(R.string.session_list_archives_search)) },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                trailingIcon = {
                    if (query.isNotEmpty()) {
                        TextButton(onClick = { query = "" }) {
                            Text(stringResource(R.string.session_list_archives_clear))
                        }
                    }
                },
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = OmpColors.Text,
                    unfocusedTextColor = OmpColors.Text,
                    focusedLabelColor = OmpColors.Text,
                    unfocusedLabelColor = OmpColors.TextMuted,
                    cursorColor = OmpColors.Text,
                ),
            )
            restoreError?.let { Text(it, color = OmpColors.StatusError, fontSize = 14.sp) }
            when {
                archives.isEmpty() -> Text(
                    stringResource(R.string.session_list_archives_empty),
                    color = OmpColors.TextMuted,
                )
                matches.isEmpty() -> Text(
                    stringResource(R.string.session_list_archives_no_match),
                    color = OmpColors.TextMuted,
                )
                else -> LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxWidth().weight(1f, fill = false),
                ) {
                    items(matches, key = { it.key }) { archive ->
                        val title = archive.name ?: archive.id ?: archive.key
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = 48.dp)
                                .clickable(
                                    enabled = restoringKey == null,
                                    onClickLabel = context.getString(R.string.session_list_restore_session),
                                ) {
                                    restoringKey = archive.key
                                    restoreError = null
                                    scope.launch {
                                        try {
                                            onRestore(archive.key)
                                        } catch (cancelled: CancellationException) {
                                            throw cancelled
                                        } catch (error: Exception) {
                                            restoreError = error.message ?: context.getString(R.string.session_list_restore_failed)
                                        } finally {
                                            restoringKey = null
                                        }
                                    }
                                }
                                .padding(vertical = 12.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Text(title, color = OmpColors.Text, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            if (archive.id != null && archive.id != title) {
                                Text(archive.id, color = OmpColors.TextMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            archive.cwd?.let { Text(it, color = OmpColors.TextMuted, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                            if (restoringKey == archive.key) {
                                Text(stringResource(R.string.session_list_restoring), color = OmpColors.TextMuted, fontSize = 12.sp)
                            }
                        }
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
    OmpModalSheet(
        onDismissRequest = onDismiss,
        containerColor = OmpColors.Bg,
        contentColor = OmpColors.Text,
    ) {
        OmpDialogSystemBars()
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(sessionTitle(session), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                IconButton(onClick = onDismiss) { Icon(Icons.Filled.Close, stringResource(R.string.session_list_close_session_actions)) }
            }
            OutlinedTextField(value = renameText, onValueChange = onRenameText, label = { Text(stringResource(R.string.session_list_session_name)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            TextButton(onClick = onRename, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.session_list_rename)) }
            TextButton(enabled = !autonameBusy, onClick = onAutoname, modifier = Modifier.fillMaxWidth()) { Text(if (autonameBusy) stringResource(R.string.session_list_generating_name) else stringResource(R.string.session_list_generate_name)) }
            TextButton(enabled = !exportBusy, onClick = onExport, modifier = Modifier.fillMaxWidth()) { Text(if (exportBusy) stringResource(R.string.session_list_exporting) else stringResource(R.string.session_list_export)) }
            HorizontalDivider(color = OmpColors.Border)
            TextButton(onClick = if (confirmArchive) onArchive else onConfirmArchive, modifier = Modifier.fillMaxWidth()) { Text(if (confirmArchive) stringResource(R.string.session_list_confirm_archive) else stringResource(R.string.session_list_archive)) }
            if (confirmDelete) Text(stringResource(R.string.session_list_delete_confirm_message), color = OmpColors.StatusError)
            TextButton(onClick = if (confirmDelete) onDelete else onConfirmDelete, modifier = Modifier.fillMaxWidth()) { Text(if (confirmDelete) stringResource(R.string.session_list_confirm_delete) else stringResource(R.string.session_list_delete), color = OmpColors.StatusError) }
        }
    }
}
