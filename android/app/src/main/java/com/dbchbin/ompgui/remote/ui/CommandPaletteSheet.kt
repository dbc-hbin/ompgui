package com.dbchbin.ompgui.remote.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.rememberCoroutineScope
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
    onExportSession: ((String) -> Unit)? = null,
    onGitStatus: ((String) -> Unit)? = null,
    currentSessionId: String? = null,
    currentCwd: String? = null,
    fileMatches: List<RelayFileMatch> = emptyList(),
    onSearchFiles: (String, String) -> Unit = { _, _ -> },
    onOpenFile: ((String) -> Unit)? = null,
    onSlashSelected: (String) -> Unit,
    onOpenSessionFilePreview: (String, String) -> Unit,
    totalSessions: Int? = null,
    hasMoreSessions: Boolean = false,
    onLoadMoreSessions: (() -> Unit)? = null,
) {
    var query by remember { mutableStateOf("") }
    var pendingAction by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val q = query.trim().lowercase()
    val trimmedQuery = query.trim()
    val searchCwd = currentCwd
    LaunchedEffect(trimmedQuery, searchCwd) {
        if (trimmedQuery.length >= 2 && !searchCwd.isNullOrBlank()) {
            onSearchFiles(searchCwd, trimmedQuery)
        }
    }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = OmpColors.BgPanel,
        contentColor = OmpColors.Text,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = 560.dp)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("명령", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = OmpColors.Text)
            BasicTextField(
                value = query,
                onValueChange = { query = it },
                textStyle = TextStyle(fontSize = 16.sp, color = OmpColors.Text),
                cursorBrush = SolidColor(OmpColors.Accent),
                modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                decorationBox = { inner ->
                    if (query.isEmpty()) Text("세션, 명령, 동작 검색", color = OmpColors.TextDim, fontSize = 16.sp)
                    inner()
                },
            )
            PaletteSection("동작") {
                PaletteRow("새 세션") { onNewSession(); onDismiss() }
                PaletteRow("설정") { onOpenSettings(); onDismiss() }
                PaletteRow("사용량") { onOpenUsage(); onDismiss() }
                PaletteRow("보관함") { onOpenArchives(); onDismiss() }
                val exportId = currentSessionId
                if (onExportSession != null && !exportId.isNullOrBlank()) {
                    PaletteRow("내보내기 / Export") { onExportSession(exportId); onDismiss() }
                }
                val gitCwd = currentCwd
                if (onGitStatus != null && !gitCwd.isNullOrBlank()) {
                    PaletteRow("Git 상태 / Git status") { onGitStatus(gitCwd); onDismiss() }
                }
                if (!exportId.isNullOrBlank()) {
                    PaletteRow(if (pendingAction != null) "이름 자동 생성 중…" else "이름 자동 생성") {
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
                                    actionError = e.message ?: "Autoname failed"
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
                PaletteSection("세션") {
                    matchedSessions.forEach { session ->
                        val title = session.name?.ifBlank { null } ?: session.firstMessage.ifBlank { session.id }
                        PaletteRow(title) { onOpenSession(session.id); onDismiss() }
                    }
                }
                if (hasMoreSessions && onLoadMoreSessions != null) {
                    val total = totalSessions
                    PaletteRow(if (total != null) "더 보기 (${sessions.size}/$total)" else "더 보기") {
                        onLoadMoreSessions()
                    }
                }
            }
            val matchedSlash = slashCommands.filter { q.isEmpty() || it.name.contains(q, ignoreCase = true) }.take(8)
            if (matchedSlash.isNotEmpty()) {
                PaletteSection("슬래시") {
                    matchedSlash.forEach { command ->
                        // Selecting a slash seeds the chat draft; it must not
                        // open a new session.
                        PaletteRow("/${command.name}") {
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
                PaletteSection("보관함") {
                    matchedArchives.forEach { archive ->
                        PaletteRow(archive.name ?: archive.key) { onRestoreArchive(archive.key); onDismiss() }
                    }
                }
            }
            if (trimmedQuery.length >= 2 && !searchCwd.isNullOrBlank() && fileMatches.isNotEmpty()) {
                PaletteSection(if (java.util.Locale.getDefault().language == "ko") "파일" else "Files") {
                    fileMatches.forEach { match ->
                        PaletteRow(match.path) {
                            onOpenSessionFilePreview(searchCwd, match.path)
                            onDismiss()
                        }
                    }
                }
            }
            if (pendingAction != null) {
                Text("요청 중…", fontSize = 13.sp, color = OmpColors.TextMuted)
            }
        }
    }
}

@Composable
private fun PaletteSection(title: String, content: @Composable () -> Unit) {
    Text(title, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = OmpColors.TextMuted)
    content()
}

@Composable
private fun PaletteRow(label: String, onClick: () -> Unit) {
    Text(
        label,
        fontSize = 14.sp,
        color = OmpColors.Text,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp),
        maxLines = 1,
    )
}
