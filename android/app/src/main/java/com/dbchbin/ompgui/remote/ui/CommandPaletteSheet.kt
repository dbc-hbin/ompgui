package com.dbchbin.ompgui.remote.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.HorizontalDivider
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.rememberCoroutineScope
import com.dbchbin.ompgui.remote.R
import com.dbchbin.ompgui.remote.relay.RelayArchive
import com.dbchbin.ompgui.remote.relay.RelayFileMatch
import com.dbchbin.ompgui.remote.relay.RelayRequester
import com.dbchbin.ompgui.remote.relay.RelaySlashCommand
import com.dbchbin.ompgui.remote.relay.SessionListItem
import kotlinx.coroutines.launch
import org.json.JSONObject

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CommandPaletteSheet(
    requester: RelayRequester,
    sessions: List<SessionListItem>,
    slashCommands: List<RelaySlashCommand>,
    archives: List<RelayArchive>,
    onOpenSession: (String) -> Unit,
    onNewSession: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenUsage: () -> Unit,
    onOpenArchives: () -> Unit,
    onRestoreArchive: (String) -> Unit,
    onDismiss: () -> Unit,
    currentSessionId: String? = null,
    currentCwd: String? = null,
    fileMatches: List<RelayFileMatch> = emptyList(),
    onSearchFiles: (String, String) -> Unit = { _, _ -> },
    onSlashSelected: (String) -> Unit,
    onOpenSessionFilePreview: (String, String) -> Unit,
    totalSessions: Int? = null,
    hasMoreSessions: Boolean = false,
    onLoadMoreSessions: (() -> Unit)? = null,
) {
    val context = LocalContext.current
    var gitOpen by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var pendingAction by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val q = query.trim().lowercase()
    val trimmedQuery = query.trim()
    val exportFailed = stringResource(R.string.palette_export_failed)
    val autonameFailed = stringResource(R.string.palette_autoname_failed)
    LaunchedEffect(trimmedQuery, currentCwd) {
        if (trimmedQuery.length >= 2 && !currentCwd.isNullOrBlank()) {
            onSearchFiles(currentCwd, trimmedQuery)
        }
    }
    if (gitOpen) {
        FileBrowserSheet(requester = requester, path = currentCwd.orEmpty(), cwd = currentCwd.orEmpty(),
            initialGit = true, onDismiss = { gitOpen = false })
    } else OmpModalSheet(
        onDismissRequest = onDismiss,
        containerColor = OmpColors.Bg,
        contentColor = OmpColors.Text,
    ) {
        OmpDialogSystemBars()
        Column(Modifier.fillMaxWidth().heightIn(max = 640.dp).padding(horizontal = 16.dp)) {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.palette_title), style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                IconButton(onClick = onDismiss, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Default.Close, stringResource(R.string.palette_close), tint = OmpColors.TextMuted)
                }
            }
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                singleLine = true,
                placeholder = { Text(stringResource(R.string.palette_search_placeholder), style = MaterialTheme.typography.bodyLarge) },
                leadingIcon = { Icon(Icons.Default.Search, null, Modifier.size(18.dp)) },
                trailingIcon = {
                    if (query.isNotEmpty()) IconButton(onClick = { query = "" }) {
                        Icon(Icons.Default.Close, stringResource(R.string.palette_clear_search), Modifier.size(18.dp), tint = OmpColors.TextMuted)
                    }
                },
                modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
                textStyle = MaterialTheme.typography.bodyLarge,
            )
            HorizontalDivider(color = OmpColors.Border)
            Column(
                Modifier.fillMaxWidth().weight(1f, fill = false)
                    .verticalScroll(rememberScrollState()).padding(bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
            val actionMatches = remember(q, currentSessionId, currentCwd) {
                listOf("새 세션 new session", "설정 settings", "사용량 usage", "보관함 archives", "내보내기 export", "git 상태 status", "이름 자동 생성 autoname generate name").mapIndexed { index, label ->
                    (q.isEmpty() || label.contains(q)) && when (index) {
                        4 -> !currentSessionId.isNullOrBlank()
                        5 -> !currentCwd.isNullOrBlank()
                        6 -> !currentSessionId.isNullOrBlank()
                        else -> true
                    }
                }
            }
            if (actionMatches.any { it }) PaletteSection(stringResource(R.string.palette_section_actions)) {
                if (actionMatches[0]) PaletteRow(stringResource(R.string.new_session)) { onNewSession(); onDismiss() }
                if (actionMatches[1]) PaletteRow(stringResource(R.string.palette_settings)) { onOpenSettings(); onDismiss() }
                if (actionMatches[2]) PaletteRow(stringResource(R.string.usage_title)) { onOpenUsage(); onDismiss() }
                if (actionMatches[3]) PaletteRow(stringResource(R.string.palette_archives)) { onOpenArchives(); onDismiss() }
                val exportId = currentSessionId
                if (actionMatches[4] && !exportId.isNullOrBlank()) {
                    PaletteRow(
                        if (pendingAction == "export") stringResource(R.string.palette_exporting)
                        else stringResource(R.string.palette_export),
                    ) {
                        if (pendingAction == null) {
                            pendingAction = "export"
                            actionError = null
                            scope.launch {
                                try {
                                    shareSessionExport(context, requester, exportId)
                                    onDismiss()
                                } catch (cancelled: kotlinx.coroutines.CancellationException) {
                                    throw cancelled
                                } catch (failure: Exception) {
                                    actionError = failure.message ?: exportFailed
                                } finally {
                                    pendingAction = null
                                }
                            }
                        }
                    }
                }
                val gitCwd = currentCwd
                if (actionMatches[5] && !gitCwd.isNullOrBlank()) {
                    PaletteRow(stringResource(R.string.palette_git_status)) { if (pendingAction == null) gitOpen = true }
                }
                if (actionMatches[6] && !exportId.isNullOrBlank()) {
                    PaletteRow(
                        if (pendingAction != null) stringResource(R.string.palette_generating_name)
                        else stringResource(R.string.palette_generate_name),
                    ) {
                        if (pendingAction == null) {
                            pendingAction = "autoname"
                            actionError = null
                            scope.launch {
                                try {
                                    requester.request(
                                        "sessions",
                                        "autoname",
                                        JSONObject().put("id", exportId),
                                    )
                                    onDismiss()
                                } catch (e: Exception) {
                                    actionError = e.message ?: autonameFailed
                                } finally {
                                    pendingAction = null
                                }
                            }
                        }
                    }
                }
            }
            actionError?.let {
                Text(it, fontSize = 13.sp, color = OmpColors.StatusError)
            }
            val matchedSessions = sessions.filter {
                q.isEmpty() ||
                    it.id.lowercase().contains(q) ||
                    (it.name ?: "").lowercase().contains(q) ||
                    it.firstMessage.lowercase().contains(q) ||
                    it.cwd.lowercase().contains(q)
            }.take(8)
            if (matchedSessions.isNotEmpty()) {
                PaletteSection(stringResource(R.string.sessions_title)) {
                    matchedSessions.forEach { session ->
                        val title = session.name?.ifBlank { null } ?: session.firstMessage.ifBlank { session.id }
                        PaletteRow(title, session.cwd) { onOpenSession(session.id); onDismiss() }
                    }
                }
                if (hasMoreSessions && onLoadMoreSessions != null) {
                    val total = totalSessions
                    PaletteRow(
                        if (total != null) stringResource(R.string.palette_load_more_count, sessions.size, total)
                        else stringResource(R.string.palette_load_more),
                    ) {
                        onLoadMoreSessions()
                    }
                }
            }
            val matchedSlash = slashCommands.filter { q.isEmpty() || it.name.contains(q, ignoreCase = true) }.take(8)
            if (matchedSlash.isNotEmpty()) {
                PaletteSection(stringResource(R.string.palette_slash_commands)) {
                    matchedSlash.forEach { command ->
                        // Selecting a slash seeds the chat draft; it must not
                        // open a new session.
                        PaletteRow("/${command.name}", command.hint) {
                            onSlashSelected.invoke("/${command.name} ")
                            onDismiss()
                        }
                    }
                }
            }
            val matchedArchives = archives.filter {
                q.isEmpty() ||
                    it.key.lowercase().contains(q) ||
                    (it.name ?: "").lowercase().contains(q)
            }.take(6)
            if (matchedArchives.isNotEmpty()) {
                PaletteSection(stringResource(R.string.palette_archives)) {
                    matchedArchives.forEach { archive ->
                        PaletteRow(archive.name ?: archive.key, archive.cwd) { onRestoreArchive(archive.key); onDismiss() }
                    }
                }
            }
            val searchCwd = currentCwd
            if (trimmedQuery.length >= 2 && !searchCwd.isNullOrBlank() && fileMatches.isNotEmpty()) {
                PaletteSection(stringResource(R.string.palette_section_files)) {
                    fileMatches.forEach { match ->
                        PaletteRow(match.path.substringAfterLast('/'), match.path) {
                            onOpenSessionFilePreview(searchCwd, match.path)
                            onDismiss()
                        }
                    }
                }
            }
            if (actionMatches.none { it } && matchedSessions.isEmpty() && matchedSlash.isEmpty() && matchedArchives.isEmpty() &&
                (trimmedQuery.length < 2 || searchCwd.isNullOrBlank() || fileMatches.isEmpty())) {
                Text(stringResource(R.string.palette_no_results), style = MaterialTheme.typography.bodyLarge,
                    color = OmpColors.TextMuted, modifier = Modifier.padding(vertical = 20.dp))
            }
            if (matchedSessions.isEmpty() && hasMoreSessions && onLoadMoreSessions != null) {
                PaletteRow(stringResource(R.string.palette_load_more_sessions)) { onLoadMoreSessions() }
            }
            if (pendingAction != null) {
                Text(stringResource(R.string.palette_requesting), fontSize = 13.sp, color = OmpColors.TextMuted)
            }
            }
        }
    }
}

@Composable
private fun PaletteSection(title: String, content: @Composable () -> Unit) {
    Text(title, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = OmpColors.TextMuted, modifier = Modifier.padding(top = 16.dp, bottom = 4.dp))
    content()
}

@Composable
private fun PaletteRow(label: String, context: String? = null, onClick: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().heightIn(min = 48.dp)
            .clickable(role = androidx.compose.ui.semantics.Role.Button, onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically),
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge, color = OmpColors.Text,
            maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (!context.isNullOrBlank()) {
            Text(context, style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}
