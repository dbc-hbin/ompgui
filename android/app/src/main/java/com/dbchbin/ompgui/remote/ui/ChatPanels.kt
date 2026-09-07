package com.dbchbin.ompgui.remote.ui

import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntSize
import androidx.compose.runtime.withFrameNanos
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Queue
import androidx.compose.material.icons.filled.Compress
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.filled.AccountTree
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.FileUpload
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dbchbin.ompgui.remote.R
import com.dbchbin.ompgui.remote.relay.ChatRequests
import com.dbchbin.ompgui.remote.relay.EventProjector
import com.dbchbin.ompgui.remote.relay.RelayRequester
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun QueueScreen(
    queue: com.dbchbin.ompgui.remote.relay.RelayMessageQueue,
    busy: Boolean,
    error: String?,
    onDismiss: () -> Unit,
    onRefresh: () -> Unit,
    onRecall: (String) -> Unit,
    onDelete: (String) -> Unit,
    onPromote: (String) -> Unit,
) {
    OmpModalSheet(
        fullHeight = true,
        onDismissRequest = onDismiss,
        containerColor = OmpColors.Bg,
        contentColor = OmpColors.Text,
    ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.chat_queue_title), Modifier.weight(1f), fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = OmpColors.Text)
            IconButton(onClick = onRefresh, enabled = !busy) {
                Icon(Icons.Filled.Refresh, stringResource(R.string.extension_refresh), tint = OmpColors.TextMuted)
            }
            IconButton(onClick = onDismiss) {
                Icon(Icons.Filled.Close, stringResource(R.string.extension_close), tint = OmpColors.TextMuted)
            }
        }
        androidx.compose.foundation.lazy.LazyColumn(
            modifier = Modifier.fillMaxWidth().weight(1f),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item {
                Text(stringResource(R.string.chat_queue_description), color = OmpColors.TextMuted)
                queue.nativeQueuedCount?.let { count ->
                    Text(stringResource(R.string.chat_queue_native_count, count), color = OmpColors.TextMuted, modifier = Modifier.padding(top = 8.dp))
                }
                if (busy) Text(stringResource(R.string.chat_queue_busy), color = OmpColors.TextMuted, modifier = Modifier.padding(top = 8.dp))
                if (!error.isNullOrBlank()) Text(error, color = OmpColors.StatusError, modifier = Modifier.padding(top = 8.dp))
                if (queue.items.isEmpty()) Text(
                    stringResource(if (queue.revision < 0) R.string.chat_queue_loading else R.string.chat_queue_empty),
                    color = OmpColors.TextMuted, modifier = Modifier.padding(top = 16.dp),
                )
            }
            items(count = queue.items.size, key = { queue.items[it].id }) { index ->
                val item = queue.items[index]
                val actionable = !busy && queue.revision >= 0 && (item.status == "queued" || item.status == "failed")
                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(stringResource(if (item.lane == "steer") R.string.chat_queue_steer else R.string.chat_queue_follow_up), color = OmpColors.Accent, fontSize = 13.sp)
                        Text(when (item.status) {
                            "queued" -> stringResource(R.string.chat_queue_pending)
                            "sending" -> stringResource(R.string.chat_queue_sending)
                            "failed" -> stringResource(R.string.chat_queue_failed)
                            else -> item.status
                        }, color = if (item.status == "failed") OmpColors.StatusWarning else OmpColors.TextMuted, fontSize = 13.sp)
                    }
                    if (item.text.isNotEmpty()) Text(item.text, color = OmpColors.Text, fontSize = 14.sp)
                    item.attachments.forEach { attachment ->
                        Text(stringResource(R.string.chat_queue_attachment, attachment.mimeType, attachment.bytes), color = OmpColors.TextMuted, fontSize = 12.sp)
                    }
                    if (item.status == "failed") Text(stringResource(R.string.chat_queue_uncertain), color = OmpColors.StatusWarning, fontSize = 13.sp)
                    item.error?.takeIf { it.isNotBlank() }?.let { Text(it, color = OmpColors.StatusError, fontSize = 13.sp) }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        androidx.compose.material3.TextButton(onClick = { onRecall(item.id) }, enabled = actionable) {
                            Text(stringResource(R.string.chat_queue_recall))
                        }
                        androidx.compose.material3.TextButton(onClick = { onDelete(item.id) }, enabled = actionable) {
                            Text(stringResource(R.string.chat_queue_delete))
                        }
                        if (item.status == "queued" && item.lane == "followUp") {
                            androidx.compose.material3.TextButton(onClick = { onPromote(item.id) }, enabled = actionable) {
                                Text(stringResource(R.string.chat_queue_promote))
                            }
                        }
                    }
                    androidx.compose.material3.HorizontalDivider(color = OmpColors.Border)
                }
            }
        }
    }
}

/** Reduced-motion aware: panels render statically, no animation. */
private fun panelShape() = RoundedCornerShape(10.dp)

// ---------------------------------------------------------------------------
// Todo phases above composer (desktop ComposerPanels/TodoList parity).
// ---------------------------------------------------------------------------

@Composable
fun TodoPanel(todos: List<com.dbchbin.ompgui.remote.relay.TodoPhase>) {
    if (todos.isEmpty()) return
    var expanded by remember { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val tasks = remember(todos) { todos.flatMap { it.tasks } }
    val done = remember(tasks) { tasks.count { it.status == "completed" } }
    val headerDesc = if (expanded) {
        stringResource(R.string.chat_todo_collapse)
    } else {
        stringResource(R.string.chat_todo_expand)
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(panelShape())
            .background(OmpColors.BgPanel)
            .border(1.5.dp, OmpColors.Border, panelShape())
            .padding(horizontal = 10.dp, vertical = 0.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(6.dp))
                .clickable(role = Role.Button) {
                    focusManager.clearFocus()
                    keyboard?.hide()
                    expanded = true
                }
                .semantics { contentDescription = headerDesc }
                .heightIn(min = 48.dp)
                .padding(horizontal = 2.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                Icons.Filled.Checklist,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = OmpColors.TextMuted,
            )
            Text(
                stringResource(R.string.todo_title),
                modifier = Modifier.weight(1f),
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = OmpColors.Text,
            )
            Text(
                stringResource(R.string.chat_activity_todos, done, tasks.size),
                fontSize = 12.sp,
                color = OmpColors.TextMuted,
            )
            Icon(
                if (expanded) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
                tint = OmpColors.TextDim,
            )
        }
    }
    if (expanded) {
        OmpModalSheet(onDismissRequest = { expanded = false }, fullHeight = true) {
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.todo_title), fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = OmpColors.Text)
                    Text(stringResource(R.string.chat_activity_todos, done, tasks.size), fontSize = 13.sp, color = OmpColors.TextMuted)
                }
                IconButton(onClick = { expanded = false }) {
                    Icon(Icons.Filled.Close, stringResource(R.string.extension_close), tint = OmpColors.TextMuted)
                }
            }
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                todos.forEach { phase ->
                    Text(
                        phase.name,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = OmpColors.TextMuted,
                        modifier = Modifier.padding(top = 6.dp, start = 4.dp),
                    )
                    phase.tasks.forEach { task ->
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp, horizontal = 4.dp),
                            verticalAlignment = Alignment.Top,
                        ) {
                            Text(
                                when (task.status) {
                                    "completed" -> "✓"
                                    "in_progress" -> "◐"
                                    "blocked" -> "!"
                                    "abandoned" -> "–"
                                    else -> "○"
                                },
                                fontSize = 12.sp,
                                color = if (task.status == "completed") OmpColors.Accent else OmpColors.TextDim,
                                modifier = Modifier.width(20.dp),
                            )
                            Text(
                                task.content,
                                modifier = Modifier.weight(1f),
                                fontSize = 15.sp,
                                lineHeight = 22.sp,
                                color = OmpColors.Text,
                            )
                        }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Subagents: live + recovered status with transcript dialog.
// ---------------------------------------------------------------------------

@Composable
private fun subagentStatusLabel(chip: com.dbchbin.ompgui.remote.relay.SubagentChip): String {
    val status = chip.status.lowercase(Locale.US)
    return when {
        status == "completed" -> stringResource(R.string.chat_subagent_status_completed)
        status == "failed" -> stringResource(R.string.chat_subagent_status_failed)
        status == "aborted" -> stringResource(R.string.chat_subagent_status_aborted)
        // Bare historical started → "unknown"; never show as Running.
        status == "unknown" -> stringResource(R.string.chat_subagent_status_unknown)
        // History/non-live non-terminal rows stay visible with Historical badge.
        !chip.live -> stringResource(R.string.chat_subagent_status_historical)
        status == "started" || status == "running" || status == "pending" ->
            stringResource(R.string.chat_subagent_status_running)
        else -> status.ifBlank { stringResource(R.string.chat_subagent_status_unknown) }
    }
}

private fun subagentIsLive(chip: com.dbchbin.ompgui.remote.relay.SubagentChip): Boolean {
    return com.dbchbin.ompgui.remote.relay.isSubagentLive(chip)
}

@Composable
fun SubagentPanel(
    requester: RelayRequester,
    sessionId: String,
    subagents: List<com.dbchbin.ompgui.remote.relay.SubagentChip>,
) {
    if (subagents.isEmpty()) return
    var expanded by remember(sessionId) { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    var selected by remember(sessionId) { mutableStateOf<com.dbchbin.ompgui.remote.relay.SubagentChip?>(null) }
    val hubScrollState = rememberScrollState()
    val selectedSubagent = selected?.let { selection -> subagents.firstOrNull { it.id == selection.id } ?: selection }
    val live = remember(subagents) { subagents.count(::subagentIsLive) }
    val headerDesc = if (expanded) {
        stringResource(R.string.chat_subagent_collapse)
    } else {
        stringResource(R.string.chat_subagent_expand)
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(panelShape())
            .background(OmpColors.BgPanel)
            .border(1.5.dp, OmpColors.Border, panelShape())
            .padding(horizontal = 10.dp, vertical = 0.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(6.dp))
                .clickable(role = Role.Button) {
                    focusManager.clearFocus()
                    keyboard?.hide()
                    expanded = true
                }
                .semantics { contentDescription = headerDesc }
                .heightIn(min = 48.dp)
                .padding(horizontal = 2.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                Icons.Filled.Groups,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = OmpColors.TextMuted,
            )
            Text(
                stringResource(R.string.chat_subagent_hub_summary, subagents.size),
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = OmpColors.Text,
                modifier = Modifier.weight(1f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (live > 0) {
                Text(
                    stringResource(R.string.chat_subagent_hub_live, live),
                    fontSize = 12.sp,
                    color = OmpColors.Accent,
                )
            }
            Icon(
                if (expanded) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
                tint = OmpColors.TextDim,
            )
        }
    }
    if (expanded && selectedSubagent == null) {
        OmpModalSheet(onDismissRequest = { expanded = false }, fullHeight = true) {
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.chat_subagent_hub_summary, subagents.size), fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = OmpColors.Text)
                    Text(stringResource(R.string.chat_subagent_hub_live, live), fontSize = 13.sp, color = if (live > 0) OmpColors.Accent else OmpColors.TextMuted)
                }
                IconButton(onClick = { expanded = false }) {
                    Icon(Icons.Filled.Close, stringResource(R.string.extension_close), tint = OmpColors.TextMuted)
                }
            }
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .verticalScroll(hubScrollState)
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                subagents.forEach { chip ->
                    val statusLabel = subagentStatusLabel(chip)
                    val liveChip = subagentIsLive(chip)
                    val openDesc = stringResource(R.string.chat_subagent_open_transcript)
                    val title = chip.id.ifBlank { chip.agent }.ifBlank { "agent" }
                    val agentType = chip.agent.trim().takeIf { it.isNotEmpty() && !it.equals(title, ignoreCase = true) }
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(6.dp))
                            .clickable(role = Role.Button, onClickLabel = openDesc) { selected = chip }
                            .heightIn(min = 48.dp)
                            .padding(horizontal = 8.dp, vertical = 6.dp),
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        Text(title, fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold, color = OmpColors.Text)
                        Text(
                            if (agentType == null) statusLabel else "$statusLabel · $agentType",
                            fontSize = 12.sp,
                            lineHeight = 18.sp,
                            color = if (liveChip) OmpColors.Accent else OmpColors.TextMuted,
                        )
                    }
                }
            }
        }
    }
    if (selectedSubagent != null) {
        SubagentTranscriptDialog(
            requester = requester,
            sessionId = sessionId,
            subagent = selectedSubagent,
            onDismiss = { selected = null },
            onClose = { selected = null; expanded = false },
        )
    }
}

@Composable
private fun SubagentTranscriptDialog(
    requester: RelayRequester,
    sessionId: String,
    subagent: com.dbchbin.ompgui.remote.relay.SubagentChip,
    onDismiss: () -> Unit,
    onClose: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var completion by remember { mutableStateOf<String?>(null) }
    var completionTruncated by remember { mutableStateOf(false) }
    var transcript by remember { mutableStateOf("") }
    var nextByte by remember { mutableStateOf(0L) }
    var exhausted by remember { mutableStateOf(false) }
    var transcriptOpen by remember { mutableStateOf(false) }
    var detailStatus by remember { mutableStateOf("") }
    var refresh by remember { mutableStateOf(0) }
    val detailError = stringResource(R.string.chat_subagent_detail_error)
    val noSession = stringResource(R.string.chat_subagent_no_session)
    val statusLabel = subagentStatusLabel(subagent)

    LaunchedEffect(sessionId, subagent.id, subagent.status, refresh) {
        if (sessionId.isBlank()) {
            loading = false
            error = noSession
            return@LaunchedEffect
        }
        loading = true
        error = null
        try {
            val data = ChatRequests.subagentCompletion(requester, sessionId, subagent.id)
            completion = data.optString("completion").takeIf { data.has("completion") && !data.isNull("completion") }
            completionTruncated = data.optBoolean("truncated", false)
            detailStatus = data.optString("status")
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            error = e.message ?: detailError
        } finally {
            loading = false
        }
    }

    fun loadPage() {
        if (loading) return
        loading = true
        scope.launch {
            error = null
            try {
                val data = ChatRequests.subagentTranscript(requester, sessionId, subagent.id, nextByte)
                if (data.has("error")) kotlin.error(data.optString("error"))
                val page = ChatRequests.parseSubagentTranscriptPage(data)
                val builder = StringBuilder(if (page.reset) "" else transcript)
                for (i in 0 until page.messages.length()) {
                    val msg = page.messages.optJSONObject(i) ?: continue
                    val role = msg.optString("role").takeIf { it.isNotBlank() } ?: "message"
                    builder.append("[$role]\n")
                    val content = msg.opt("content")
                    val text = when (content) {
                        is String -> content
                        is org.json.JSONArray -> {
                            val parts = ArrayList<String>()
                            for (j in 0 until content.length()) {
                                val block = content.optJSONObject(j) ?: continue
                                if (block.optString("type") == "text") {
                                    parts.add(block.optString("text"))
                                } else {
                                    parts.add(block.toString(2))
                                }
                            }
                            parts.joinToString("\n")
                        }
                        else -> msg.optString("text")
                    }
                    builder.append(text).append("\n\n")
                }
                transcript = builder.toString()
                nextByte = page.nextByte
                exhausted = data.optString("status") != "pending" && page.exhausted
            } catch (e: Exception) {
                // Surface the server-coded error; never fake transcript content.
                if (e is CancellationException) throw e
                error = e.message ?: detailError
            } finally {
                loading = false
            }
        }
    }

    OmpModalSheet(
        onDismissRequest = onDismiss,
        fullHeight = true,
        containerColor = OmpColors.Bg,
        contentColor = OmpColors.Text,
    ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onDismiss) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.chat_back), Modifier.size(12.dp), tint = OmpColors.TextMuted)
            }
            Spacer(Modifier.weight(1f))
            IconButton(onClick = { refresh++ }, enabled = !loading && sessionId.isNotBlank()) {
                Icon(Icons.Filled.Refresh, stringResource(R.string.extension_refresh), tint = OmpColors.TextMuted)
            }
            IconButton(onClick = onClose) {
                Icon(Icons.Filled.Close, stringResource(R.string.extension_close), tint = OmpColors.TextMuted)
            }
        }
        Column(Modifier.fillMaxWidth().weight(1f)) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp)
                    .padding(bottom = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            subagent.id.ifBlank { subagent.agent }.ifBlank { "agent" },
                            fontSize = 16.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = OmpColors.Text,
                        )
                        val agentType = subagent.agent.trim()
                        if (agentType.isNotEmpty() && !agentType.equals(subagent.id, ignoreCase = true)) {
                            Text(agentType, fontSize = 12.sp, color = OmpColors.TextMuted)
                        }
                    }
                }
                Text(
                    "$statusLabel · ${subagent.id}",
                    fontSize = 13.sp,
                    color = OmpColors.TextMuted,
                )
                if (subagent.task.isNotBlank()) {
                    Text(subagent.task, fontSize = 14.sp, lineHeight = 20.sp, color = OmpColors.TextMuted)
                }
                if (loading) {
                    Text(stringResource(R.string.chat_subagent_loading), fontSize = 14.sp, color = OmpColors.TextMuted)
                }
                if (!error.isNullOrBlank()) {
                    Text(error!!, fontSize = 13.sp, color = OmpColors.StatusError)
                }
                if (!loading && error == null && completion.isNullOrBlank()) {
                    Text(stringResource(if (detailStatus == "pending") R.string.chat_subagent_pending else R.string.chat_subagent_unavailable), fontSize = 14.sp, color = OmpColors.TextMuted)
                }
                if (!completion.isNullOrBlank()) {
                    Text(
                        stringResource(R.string.chat_subagent_completion),
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = OmpColors.Text,
                    )
                    MessageText(completion!!, Modifier.fillMaxWidth())
                    if (completionTruncated) {
                        Text(
                            stringResource(R.string.chat_subagent_truncated),
                            fontSize = 12.sp,
                            color = OmpColors.StatusWarning,
                        )
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        if (transcriptOpen) {
                            stringResource(R.string.chat_subagent_hide_transcript)
                        } else {
                            stringResource(R.string.chat_subagent_show_transcript)
                        },
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = OmpColors.Accent,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .clickable(role = Role.Button) {
                                transcriptOpen = !transcriptOpen
                                if (transcriptOpen && transcript.isEmpty() && !exhausted) loadPage()
                            }.heightIn(min = 48.dp)
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                    )
                }
                if (transcriptOpen) {
                    if (transcript.isNotBlank()) {
                        Text(
                            transcript,
                            fontSize = 14.sp,
                            fontFamily = FontFamily.Monospace,
                            color = OmpColors.Text,
                            lineHeight = 21.sp,
                        )
                    }
                    if (!exhausted) {
                        Text(
                            stringResource(R.string.chat_subagent_load_more),
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = OmpColors.Accent,
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .clickable(enabled = !loading, role = Role.Button) { loadPage() }.heightIn(min = 48.dp)
                                .padding(horizontal = 12.dp, vertical = 8.dp),
                        )
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Runtime controls: modes, bash, handoff, reload, compact, fork, export.
// ---------------------------------------------------------------------------

@Composable
fun RuntimePanel(
    requester: RelayRequester,
    sessionId: String,
    running: Boolean,
    fastMode: Boolean?,
    autoRetry: Boolean?,
    interruptMode: String?,
    autoCompaction: Boolean?,
    steeringMode: String?,
    followUpMode: String?,
    onFastModeChange: (Boolean) -> Unit,
    onAutoRetryChange: (Boolean) -> Unit,
    onInterruptModeChange: (String) -> Unit,
    onAutoCompactionChange: (Boolean) -> Unit,
    onSteeringModeChange: (String) -> Unit,
    onFollowUpModeChange: (String) -> Unit,
    onCycleModel: () -> Unit,
    onBash: (String) -> Unit,
    onHandoff: () -> Unit,
    onReload: () -> Unit,
    onRetryAbort: () -> Unit,
    onAbortBash: () -> Unit,
    onCompact: () -> Unit,
    onCustomCompact: (String) -> Unit,
    onCopyLast: () -> Unit,
    onExport: () -> Unit,
    onOpenPalette: () -> Unit,
    onAbort: () -> Unit,
    onOpenQueue: () -> Unit,
    expanded: Boolean,
    onExpandedChange: (Boolean) -> Unit,
) {
    // State lives above every disclosure subtree, so collapsing never discards a draft.
    var bashDraft by remember(sessionId) { mutableStateOf("") }
    var compactDraft by remember(sessionId) { mutableStateOf("") }
    var bashError by remember(sessionId) { mutableStateOf<String?>(null) }
    var category by remember(sessionId) { mutableStateOf<String?>(null) }
    var branch by remember(sessionId) { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    val onLabel = stringResource(R.string.chat_runtime_on)
    val offLabel = stringResource(R.string.chat_runtime_off)
    val boolChoices = listOf("true" to onLabel, "false" to offLabel)
    val interruptChoices = listOf(
        "immediate" to stringResource(R.string.chat_runtime_immediate),
        "wait" to stringResource(R.string.chat_runtime_wait),
    )
    val queueChoices = listOf(
        "one-at-a-time" to stringResource(R.string.chat_runtime_one_at_a_time),
        "all" to stringResource(R.string.chat_runtime_all),
    )
    val toggleBranch: (String) -> Unit = { branch = if (branch == it) null else it }
    val toggleCategory: (String) -> Unit = {
        category = if (category == it) null else it
        branch = null
    }
    val scrollState = rememberScrollState()
    if (expanded) {
        OmpModalSheet(
            fullHeight = true,
            onDismissRequest = { onExpandedChange(false) },
            containerColor = OmpColors.Bg,
            contentColor = OmpColors.Text,
        ) {
            Column(Modifier.fillMaxWidth().weight(1f)) {
                Column(
                    Modifier.fillMaxWidth().weight(1f).padding(horizontal = 12.dp, vertical = 8.dp)
                        .border(1.dp, OmpColors.Border, RoundedCornerShape(16.dp))
                        .clip(RoundedCornerShape(16.dp)).background(OmpColors.BgPanel),
                ) {
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(start = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(Icons.Filled.Tune, null, Modifier.size(20.dp), tint = OmpColors.TextMuted)
                        Text(stringResource(R.string.chat_runtime_controls),
                            Modifier.weight(1f), fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                            color = OmpColors.Text)
                        IconButton(onClick = { onExpandedChange(false) }, modifier = Modifier.size(48.dp)) {
                            Icon(Icons.Filled.Close, stringResource(R.string.extension_close), tint = OmpColors.TextMuted)
                        }
                    }
                    Column(Modifier.fillMaxWidth().weight(1f).verticalScroll(scrollState)) {
                RuntimeTreeRow(
                    label = stringResource(R.string.chat_runtime_execution),
                    expanded = category == "execution", heading = true, icon = Icons.Filled.PlayArrow,
                    onClick = { toggleCategory("execution") },
                )
                if (category == "execution") {
                    RuntimeSettingBranch(
                        stringResource(R.string.chat_runtime_fast), fastMode?.toString(), boolChoices,
                        branch == "fast", { toggleBranch("fast") }, { onFastModeChange(it == "true") },
                    )
                    RuntimeSettingBranch(
                        stringResource(R.string.chat_runtime_retry), autoRetry?.toString(), boolChoices,
                        branch == "retry", { toggleBranch("retry") }, { onAutoRetryChange(it == "true") },
                    )
                    RuntimeSettingBranch(
                        stringResource(R.string.chat_runtime_interrupt), interruptMode, interruptChoices,
                        branch == "interrupt", { toggleBranch("interrupt") }, onInterruptModeChange,
                    )
                    RuntimeTreeRow(stringResource(R.string.chat_runtime_cycle_model), depth = 1, icon = Icons.Filled.SwapHoriz, onClick = onCycleModel)
                    RuntimeTreeRow(stringResource(R.string.chat_runtime_handoff), depth = 1, icon = Icons.Filled.AccountTree, onClick = onHandoff)
                    RuntimeTreeRow(stringResource(R.string.chat_runtime_reload), depth = 1, icon = Icons.Filled.Refresh, onClick = onReload)
                    RuntimeTreeRow(stringResource(R.string.chat_runtime_abort_retry), depth = 1, icon = Icons.Filled.Stop, onClick = onRetryAbort)
                    if (running) RuntimeTreeRow(stringResource(R.string.chat_runtime_abort_agent), depth = 1, icon = Icons.Filled.Stop, onClick = onAbort)
                }
                RuntimeTreeRow(
                    label = stringResource(R.string.chat_runtime_queue),
                    expanded = category == "queue", heading = true, icon = Icons.Filled.Queue,
                    onClick = { toggleCategory("queue") },
                )
                if (category == "queue") {
                    RuntimeTreeRow(stringResource(R.string.chat_queue_title), depth = 1, icon = Icons.Filled.Queue, onClick = onOpenQueue)
                    RuntimeSettingBranch(
                        stringResource(R.string.chat_runtime_steering), steeringMode, queueChoices,
                        branch == "steering", { toggleBranch("steering") }, onSteeringModeChange,
                    )
                    RuntimeSettingBranch(
                        stringResource(R.string.chat_runtime_follow_up), followUpMode, queueChoices,
                        branch == "followUp", { toggleBranch("followUp") }, onFollowUpModeChange,
                    )
                }
                RuntimeTreeRow(
                    label = stringResource(R.string.chat_runtime_context),
                    expanded = category == "context", heading = true, icon = Icons.Filled.Compress,
                    onClick = { toggleCategory("context") },
                )
                if (category == "context") {
                    RuntimeSettingBranch(
                        stringResource(R.string.chat_runtime_auto_compaction), autoCompaction?.toString(), boolChoices,
                        branch == "autoCompact", { toggleBranch("autoCompact") }, { onAutoCompactionChange(it == "true") },
                    )
                    RuntimeTreeRow(stringResource(R.string.chat_runtime_compact), depth = 1, icon = Icons.Filled.Compress, onClick = onCompact)
                    RuntimeTreeRow(
                        stringResource(R.string.chat_runtime_custom_compaction), depth = 1, icon = Icons.Filled.Edit,
                        expanded = branch == "compact", onClick = { toggleBranch("compact") },
                    )
                    if (branch == "compact") {
                        RuntimeDraftEditor(
                            label = stringResource(R.string.chat_runtime_compact_instructions),
                            value = compactDraft, onValueChange = { compactDraft = it },
                        )
                        RuntimeTreeRow(stringResource(R.string.chat_runtime_apply_compact), depth = 2, icon = Icons.Filled.Compress) {
                            onCustomCompact(compactDraft.trim())
                            compactDraft = ""
                        }
                    }
                }
                RuntimeTreeRow(
                    label = stringResource(R.string.chat_runtime_shell),
                    expanded = category == "shell", heading = true, icon = Icons.Filled.Terminal,
                    onClick = { toggleCategory("shell") },
                )
                if (category == "shell") {
                    RuntimeDraftEditor(
                        label = stringResource(R.string.chat_runtime_shell_command),
                        value = bashDraft, monospace = true, depth = 1,
                        onValueChange = { bashDraft = it; bashError = null },
                    )
                    if (bashDraft.startsWith("!!")) {
                        Text(
                            stringResource(R.string.chat_runtime_excluded_output),
                            modifier = Modifier.padding(start = 28.dp, end = 12.dp),
                            fontSize = 12.sp, color = OmpColors.StatusWarning,
                        )
                    }
                    bashError?.let {
                        Text(it, modifier = Modifier.padding(start = 28.dp, end = 12.dp), fontSize = 12.sp, color = OmpColors.StatusError)
                    }
                    RuntimeTreeRow(stringResource(R.string.chat_runtime_run), depth = 1, icon = Icons.Filled.PlayArrow) {
                        val cmd = bashDraft.trim().removePrefix("!").trim()
                        if (cmd.isEmpty()) {
                            bashError = context.getString(R.string.chat_runtime_enter_command)
                        } else {
                            // Preserve !! submission: the server's coded error remains authoritative.
                            bashError = null
                            onBash(bashDraft.trim())
                            bashDraft = ""
                        }
                    }
                    RuntimeTreeRow(stringResource(R.string.chat_runtime_abort_bash), depth = 1, icon = Icons.Filled.Stop, onClick = onAbortBash)
                }
                RuntimeTreeRow(
                    label = stringResource(R.string.chat_runtime_output),
                    expanded = category == "output", heading = true, icon = Icons.Filled.Description,
                    onClick = { toggleCategory("output") },
                )
                if (category == "output") {
                    RuntimeTreeRow(stringResource(R.string.chat_runtime_copy_last), depth = 1, icon = Icons.Filled.ContentCopy, onClick = onCopyLast)
                    RuntimeTreeRow(stringResource(R.string.chat_runtime_export), depth = 1, icon = Icons.Filled.FileUpload, onClick = onExport)
                    RuntimeTreeRow(stringResource(R.string.session_list_command_palette), depth = 1, icon = Icons.Filled.Terminal, onClick = onOpenPalette)
                }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun RuntimeTreeRow(
    label: String,
    depth: Int = 0,
    value: String? = null,
    expanded: Boolean? = null,
    heading: Boolean = false,
    enabled: Boolean = true,
    checked: Boolean? = null,
    icon: ImageVector? = null,
    onClick: () -> Unit,
) {
    val expandedLabel = stringResource(R.string.chat_runtime_expanded)
    val collapsedLabel = stringResource(R.string.chat_runtime_collapsed)
    val relocation = remember { BringIntoViewRequester() }
    val scope = rememberCoroutineScope()
    var rowSize by remember { mutableStateOf(IntSize.Zero) }
    val childPreviewHeight = with(LocalDensity.current) { 96.dp.toPx() }
    Column {
        if (heading) Box(Modifier.fillMaxWidth().height(1.dp).background(OmpColors.Border))
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .bringIntoViewRequester(relocation)
                .onSizeChanged { rowSize = it }
                .clickable(enabled = enabled, role = if (checked != null) Role.RadioButton else Role.Button) {
                    onClick()
                    if (expanded == false) {
                        scope.launch {
                            // Wait for newly disclosed children to join the parent's layout.
                            withFrameNanos { }
                            relocation.bringIntoView(
                                Rect(0f, 0f, rowSize.width.toFloat(), rowSize.height + childPreviewHeight),
                            )
                        }
                    }
                }
                .semantics {
                    if (expanded != null) stateDescription = if (expanded) {
                        expandedLabel
                    } else {
                        collapsedLabel
                    }
                    if (checked != null) selected = checked
                }
                .heightIn(min = 48.dp)
                .padding(start = (12 + depth * 16).dp, end = 12.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (expanded != null || checked != null) {
                Text(
                    if (checked != null) { if (checked) "✓" else "" } else if (expanded == true) "▾" else "▸",
                    modifier = Modifier.width(20.dp).clearAndSetSemantics { },
                    color = if (enabled) OmpColors.TextMuted else OmpColors.TextDim,
                    fontSize = 13.sp,
                )
            }
            if (icon != null) {
                Icon(icon, null, Modifier.size(20.dp), tint = if (enabled) OmpColors.TextMuted else OmpColors.TextDim)
                Spacer(Modifier.width(8.dp))
            }
            Text(
                label, modifier = Modifier.weight(1f), fontSize = 13.sp,
                fontWeight = if (heading) FontWeight.SemiBold else FontWeight.Normal,
                color = if (enabled) OmpColors.Text else OmpColors.TextDim,
            )
            if (value != null) {
                Text(
                    value, modifier = Modifier.weight(1f).padding(start = 8.dp),
                    fontSize = 13.sp, textAlign = TextAlign.End,
                    color = if (enabled) OmpColors.TextMuted else OmpColors.TextDim,
                )
            }
        }
    }
}

@Composable
private fun RuntimeSettingBranch(
    label: String,
    current: String?,
    choices: List<Pair<String, String>>,
    expanded: Boolean,
    onExpand: () -> Unit,
    onSelect: (String) -> Unit,
) {
    val selectedChoice = choices.firstOrNull { it.first == current }
    RuntimeTreeRow(
        label, depth = 1,
        value = selectedChoice?.second ?: stringResource(R.string.chat_runtime_unavailable),
        expanded = expanded && selectedChoice != null,
        enabled = selectedChoice != null,
        onClick = onExpand,
    )
    if (expanded && selectedChoice != null) {
        choices.forEach { (protocolValue, displayLabel) ->
            RuntimeTreeRow(displayLabel, depth = 2, checked = protocolValue == current) { onSelect(protocolValue) }
        }
    }
}

@Composable
private fun RuntimeDraftEditor(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    monospace: Boolean = false,
    depth: Int = 2,
) {
    Column(Modifier.fillMaxWidth().padding(start = (12 + depth * 16).dp, end = 12.dp, top = 8.dp)) {
        Text(label, fontSize = 13.sp, color = OmpColors.TextMuted)
        Spacer(Modifier.height(8.dp))
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).semantics { contentDescription = label },
            textStyle = TextStyle(
                fontSize = 13.sp, color = OmpColors.Text,
                fontFamily = if (monospace) FontFamily.Monospace else FontFamily.Default,
            ),
            cursorBrush = SolidColor(OmpColors.Accent),
            maxLines = 3,
            decorationBox = { inner ->
                Box(
                    Modifier.fillMaxWidth().heightIn(min = 48.dp)
                        .background(OmpColors.Bg, RoundedCornerShape(8.dp))
                        .border(1.dp, OmpColors.Border, RoundedCornerShape(8.dp))
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                ) { inner() }
            },
        )
    }
}

@Composable
private fun RuntimeChip(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .heightIn(min = 48.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(OmpColors.BgHover)
            .border(1.dp, OmpColors.Border, RoundedCornerShape(8.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, fontSize = 12.sp, color = if (enabled) OmpColors.Text else OmpColors.TextDim)
    }
}

// ---------------------------------------------------------------------------
// Long output: bounded full-message fetch/paging (never silently cut).
// ---------------------------------------------------------------------------

@Composable
fun LongMessageText(
    requester: RelayRequester,
    sessionId: String,
    message: com.dbchbin.ompgui.remote.relay.DisplayMessage,
    showCopy: Boolean = true,
) {
    var expanded by remember(sessionId, message.entryId, message.timestamp, message.role) { mutableStateOf(false) }
    val context = LocalContext.current
    Column(Modifier.fillMaxWidth()) {
        val visible = if (expanded) message.text else EventProjector.previewText(message.text)
        val modifier = if (expanded) Modifier.fillMaxWidth().heightIn(max = 420.dp).verticalScroll(rememberScrollState()) else Modifier.fillMaxWidth()
        androidx.compose.foundation.text.selection.SelectionContainer {
            MessageText(visible, modifier, plainText = message.role == "user")
        }
        if (showCopy) IconButton(onClick = {
            val clipboard = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
            clipboard.setPrimaryClip(android.content.ClipData.newPlainText("", message.text))
        }) { Icon(Icons.Filled.ContentCopy, stringResource(R.string.chat_copy_content), modifier = Modifier.size(12.dp), tint = OmpColors.TextMuted) }
        if (message.text.length > 4_000) RuntimeChip(
            if (expanded) stringResource(R.string.chat_show_less) else stringResource(R.string.chat_show_full, message.text.length),
            onClick = { expanded = !expanded },
        )
    }
}

@Composable
fun TranscriptContent(
    requester: RelayRequester,
    sessionId: String,
    leafId: String?,
    message: com.dbchbin.ompgui.remote.relay.DisplayMessage,
    results: Map<String, com.dbchbin.ompgui.remote.relay.DisplayMessage> = emptyMap(),
    actionsEnabled: Boolean = true,
    onEdit: ((JSONObject) -> Unit)? = null,
    onFork: (() -> Unit)? = null,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var full by remember(sessionId, leafId, message.entryId, message.content, message.text) { mutableStateOf<JSONObject?>(null) }
    var media by remember(sessionId, leafId, message.entryId) { mutableStateOf<JSONArray?>(null) }
    var busy by remember(sessionId, leafId, message.entryId) { mutableStateOf(false) }
    var failure by remember(sessionId, leafId, message.entryId) { mutableStateOf<String?>(null) }
    var mediaSummary by remember(sessionId, leafId, message.entryId) { mutableStateOf<String?>(null) }
    fun perform(action: suspend () -> Unit) {
        if (busy) return
        busy = true
        scope.launch {
            try { action(); failure = null }
            catch (e: Exception) { if (e is CancellationException) throw e; failure = e.message ?: context.getString(R.string.extension_request_failed) }
            finally { busy = false }
        }
    }
    val content = full?.optJSONArray("content") ?: message.content
    val truncated = message.truncated && full == null
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (content == null) LongMessageText(requester, sessionId, message.copy(text = full?.optString("text", message.text) ?: message.text), showCopy = false)
        else for (index in 0 until content.length()) {
            val block = content.optJSONObject(index) ?: continue
            androidx.compose.runtime.key(sessionId, leafId, message.entryId, index, block.optString("toolCallId")) {
                when (block.optString("type")) {
                    "text" -> LongMessageText(requester, sessionId, message.copy(text = block.optString("text")), showCopy = false)
                    "toolCall" -> TranscriptTool(requester, sessionId, leafId, block, results[block.optString("toolCallId")], truncated)
                    "image" -> if (block.optString("data").isNotEmpty()) HistoryImage(block)
                    "thinking" -> {
                        var thinking by remember(block) { mutableStateOf(block.optString("thinking")) }
                        var loaded by remember(block) { mutableStateOf(!block.optBoolean("deferred")) }
                        var expanded by remember { mutableStateOf(false) }
                        RuntimeChip(stringResource(R.string.chat_load_thinking, index + 1), enabled = !busy, onClick = {
                            if (!loaded && !message.entryId.isNullOrBlank()) perform {
                                val args = JSONObject().put("id", sessionId).put("entryId", message.entryId).put("blockIndex", index)
                                if (!leafId.isNullOrBlank()) args.put("leafId", leafId)
                                thinking = requester.request("sessions", "thinking", args).getString("thinking")
                                loaded = true
                                expanded = true
                            } else expanded = !expanded
                        })
                        if (expanded) LongMessageText(requester, sessionId, message.copy(text = thinking))
                    }
                    else -> TranscriptJson(block.toString(2))
                }
            }
        }
        if (message.role == "user" || message.role == "assistant") {
            suspend fun actionMessage(): JSONObject {
                if (truncated) full = ChatRequests.fullEntry(requester, sessionId, requireNotNull(message.entryId), leafId)
                return full ?: JSONObject().put("content", content ?: message.text)
            }
            val hasText = if (content == null) {
                (full?.optString("text", message.text) ?: message.text).isNotEmpty()
            } else (0 until content.length()).any { index ->
                content.optJSONObject(index)?.let { block ->
                    block.optString("type") == "text" && block.optString("text").isNotEmpty()
                } == true
            }
            Row {
                IconButton(enabled = !busy && (hasText || truncated) && (!truncated || !message.entryId.isNullOrBlank()), modifier = Modifier.size(48.dp), onClick = {
                    perform {
                        val text = ChatRequests.messageText(actionMessage())
                        val clipboard = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                        clipboard.setPrimaryClip(android.content.ClipData.newPlainText("", text))
                    }
                }) { Icon(Icons.Filled.ContentCopy, stringResource(R.string.chat_copy_content), Modifier.size(12.dp), tint = OmpColors.TextMuted) }
                if (message.role == "user" && onEdit != null) IconButton(enabled = actionsEnabled && !busy, modifier = Modifier.size(48.dp), onClick = {
                    perform { onEdit(actionMessage()) }
                }) { Icon(Icons.Filled.Edit, stringResource(R.string.chat_edit_input), Modifier.size(12.dp), tint = OmpColors.TextMuted) }
                if (message.role == "user" && onFork != null) IconButton(enabled = actionsEnabled && !busy && !message.entryId.isNullOrBlank(), modifier = Modifier.size(48.dp), onClick = onFork) {
                    Icon(Icons.Filled.AccountTree, stringResource(R.string.chat_fork_here), Modifier.size(12.dp), tint = OmpColors.TextMuted)
                }
            }
        }
        val details = full?.optJSONObject("details") ?: message.details
        if (details != null) TranscriptJson(details.toString(2))
        if (truncated) RuntimeChip(stringResource(R.string.chat_load_full_entry), enabled = !busy && !message.entryId.isNullOrBlank(), onClick = {
            perform {
                full = ChatRequests.fullEntry(requester, sessionId, requireNotNull(message.entryId), leafId)
            }
        })
        val deferred = message.deferredImages != null || (content != null && (0 until content.length()).any {
            val block = content.optJSONObject(it)
            block?.optString("type") == "image" && block.optString("data").isEmpty()
        })
        if (deferred) RuntimeChip(stringResource(R.string.chat_load_media), enabled = !busy && !message.entryId.isNullOrBlank(), onClick = {
            perform {
                val images = JSONArray()
                var offset = 0
                var missing = 0
                do {
                    val args = JSONObject().put("id", sessionId).put("entryId", message.entryId).put("offset", offset).put("limit", 1)
                    if (!leafId.isNullOrBlank()) args.put("leafId", leafId)
                    val response = requester.request("sessions", "media", args)
                    val page = response.getJSONArray("images")
                    for (index in 0 until page.length()) images.put(page.getJSONObject(index))
                    missing += response.optInt("missingCount")
                    if (!response.optBoolean("hasMore")) break
                    val next = response.getInt("nextOffset")
                    check(next > offset) { context.getString(R.string.chat_history_unavailable) }
                    offset = next
                } while (true)
                media = images
                mediaSummary = context.getString(R.string.chat_media_summary, images.length(), missing)
            }
        })
        media?.let { images -> for (index in 0 until images.length()) images.optJSONObject(index)?.let { HistoryImage(it) } }
        mediaSummary?.let { Text(it, color = OmpColors.TextMuted, fontSize = 12.sp) }
        if (busy) Text(stringResource(R.string.chat_content_loading), color = OmpColors.TextMuted)
        failure?.let { Text(it, color = OmpColors.StatusError) }
    }
}

@Composable
private fun TranscriptJson(value: String, initiallyExpanded: Boolean = false) {
    var expanded by remember { mutableStateOf(initiallyExpanded) }
    val context = LocalContext.current
    Row(verticalAlignment = Alignment.CenterVertically) {
        RuntimeChip(if (expanded) stringResource(R.string.chat_hide_details) else stringResource(R.string.chat_show_details), onClick = { expanded = !expanded })
        IconButton(onClick = {
            val clipboard = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
            clipboard.setPrimaryClip(android.content.ClipData.newPlainText("", value))
        }) { Icon(Icons.Filled.ContentCopy, stringResource(R.string.chat_copy_content), modifier = Modifier.size(12.dp), tint = OmpColors.TextMuted) }
    }
    if (expanded) androidx.compose.foundation.text.selection.SelectionContainer {
        Text(value, Modifier.fillMaxWidth().heightIn(max = 420.dp).verticalScroll(rememberScrollState()), color = OmpColors.Text, fontFamily = FontFamily.Monospace, fontSize = 12.sp)
    }
}

@Composable
fun TranscriptTool(
    requester: RelayRequester,
    sessionId: String,
    leafId: String?,
    call: JSONObject?,
    result: com.dbchbin.ompgui.remote.relay.DisplayMessage?,
    inputTruncated: Boolean = false,
) {
    var expanded by remember(call?.optString("toolCallId") ?: result?.toolCallId) { mutableStateOf(false) }
    val name = call?.optString("toolName")?.takeIf { it.isNotBlank() } ?: result?.toolName ?: stringResource(R.string.chat_role_tool)
    val status = when {
        result?.isError == true -> stringResource(R.string.chat_tool_failed)
        result == null -> stringResource(R.string.chat_tool_pending)
        result.streaming -> stringResource(R.string.chat_tool_progress)
        else -> stringResource(R.string.chat_tool_complete)
    }
    Column(Modifier.fillMaxWidth().background(OmpColors.ToolBg, panelShape()).border(1.dp, OmpColors.Border, panelShape()).padding(8.dp)) {
        androidx.compose.material3.TextButton(onClick = { expanded = !expanded }, modifier = Modifier.fillMaxWidth()) {
            Icon(if (expanded) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, null)
            Text("$name · $status", Modifier.weight(1f), color = if (result?.isError == true) OmpColors.StatusError else OmpColors.TextMuted)
        }
        if (expanded) {
            (call?.optString("toolCallId") ?: result?.toolCallId)?.let { Text(it, color = OmpColors.TextDim, fontSize = 11.sp) }
            if (call != null) {
                Text(stringResource(R.string.chat_tool_input), color = OmpColors.TextMuted, fontSize = 12.sp)
                TranscriptJson(when (val input = call.opt("input")) {
                    is JSONObject -> input.toString(2)
                    is JSONArray -> input.toString(2)
                    else -> input?.toString() ?: "null"
                }, initiallyExpanded = true)
                if (inputTruncated) Text(stringResource(R.string.chat_tool_input_truncated), color = OmpColors.TextMuted, fontSize = 12.sp)
            }
            if (result != null) {
                Text(stringResource(R.string.chat_tool_result), color = OmpColors.TextMuted, fontSize = 12.sp)
                TranscriptContent(requester, sessionId, leafId, result)
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Approval / extension dialogs: same supported desktop semantics.
// ---------------------------------------------------------------------------

@Composable
fun ChatExtensionHost(
    requester: RelayRequester, sessionId: String,
    requests: List<EventProjector.ChatExtensionRequest>, notices: List<EventProjector.ChatNotice>,
    status: Map<String, String>, widgets: Map<String, List<String>>,
    onDismissNotice: (String) -> Unit, onDismissRequest: (String) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val currentSessionId by androidx.compose.runtime.rememberUpdatedState(sessionId)
    var error by remember(sessionId, requests.firstOrNull()?.id) { mutableStateOf<String?>(null) }
    var sending by remember(sessionId, requests.firstOrNull()?.id) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().heightIn(max = 220.dp).verticalScroll(rememberScrollState())) {
        ExtensionNoticeList(notices, onDismissNotice)
        status.forEach { (key, value) -> Text("$key: $value", color = OmpColors.Text) }
        widgets.forEach { (key, lines) -> Text("$key\n${lines.joinToString("\n")}", color = OmpColors.Text) }
    }
    val request = requests.firstOrNull() ?: return
    val id = request.id
    fun respond(response: JSONObject) {
        if (sending) return
        sending = true
        scope.launch {
            try {
                ChatRequests.command(requester, sessionId, ChatRequests.extensionResponse(id, response))
                if (currentSessionId == sessionId) onDismissRequest(id)
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                error = e.message ?: context.getString(R.string.chat_response_failed)
            } finally { sending = false }
        }
    }
    androidx.compose.runtime.key(sessionId, request.id) {
        ExtensionDialogSheet(request, sending, error, ::respond, { respond(JSONObject().put("cancelled", true)) })
    }
}

@Composable
fun ChatHistoryHost(requester: RelayRequester, sessionId: String, leafId: String?, onOpenSession: (String) -> Unit, onEditMessage: (String) -> Unit, expanded: Boolean, onDismiss: () -> Unit) {
    androidx.compose.runtime.key(sessionId, leafId) {
        ChatHistoryContent(requester, sessionId, leafId, onOpenSession, onEditMessage, expanded, onDismiss)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChatHistoryContent(requester: RelayRequester, sessionId: String, leafId: String?, onOpenSession: (String) -> Unit, onEditMessage: (String) -> Unit, expanded: Boolean, onDismiss: () -> Unit) {
    val context = LocalContext.current
    var page by remember(sessionId) { mutableStateOf<ChatRequests.HistoryPage?>(null) }
    var busy by remember(sessionId) { mutableStateOf(false) }
    var error by remember(sessionId) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    fun load(offset: Int) {
        if (busy) return
        busy = true
        scope.launch {
            try { page = ChatRequests.parseHistoryPage(ChatRequests.history(requester, sessionId, leafId ?: page?.leafId, offset, 25)); error = null }
            catch (e: Exception) { if (e is kotlinx.coroutines.CancellationException) throw e; error = e.message ?: context.getString(R.string.chat_history_unavailable) }
            finally { busy = false }
        }
    }
    Box {
        LaunchedEffect(expanded) { if (expanded && page == null) load(0) }
        if (expanded) {
            OmpModalSheet(
            fullHeight = true,
                onDismissRequest = onDismiss,
                containerColor = OmpColors.Bg,
                contentColor = OmpColors.Text,
            ) {
                Column(Modifier.fillMaxWidth().weight(1f)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.chat_menu_history), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                    IconButton(onClick = onDismiss, modifier = Modifier.size(48.dp)) { Icon(Icons.Filled.Close, stringResource(R.string.extension_close), tint = OmpColors.TextMuted) }
                }
            Column(Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (busy) Text(stringResource(R.string.chat_subagent_loading), color = OmpColors.TextMuted)
                error?.let { Text(it, color = OmpColors.StatusError) }
                page?.let { current ->
                    Text("${current.offset} / ${current.total}", color = OmpColors.TextMuted)
                    for (i in 0 until current.messages.length()) {
                        val message = current.messages.optJSONObject(i) ?: continue
                        val entryId = current.entryIds.optString(i)
                        androidx.compose.runtime.key(sessionId, entryId, current.offset + i) {
                            HistoryEntry(requester, sessionId, leafId, entryId, message, onOpenSession, onEditMessage)
                        }
                    }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        RuntimeChip(stringResource(R.string.extension_previous), enabled = !busy && current.offset > 0, onClick = { load((current.offset - 25).coerceAtLeast(0)) })
                        RuntimeChip(stringResource(R.string.extension_next), enabled = !busy && current.hasMore, onClick = { load(current.offset + current.messages.length()) })
                    }
                }
                RuntimeChip(stringResource(R.string.extension_refresh), enabled = !busy, onClick = { load(page?.offset ?: 0) })
            }
                }
            }
        }
    }
}

@Composable
private fun HistoryEntry(requester: RelayRequester, sessionId: String, leafId: String?, entryId: String, message: JSONObject, onOpenSession: (String) -> Unit, onEditMessage: (String) -> Unit) {
    val context = LocalContext.current
    var details by remember { mutableStateOf<String?>(null) }
    var media by remember { mutableStateOf<org.json.JSONArray?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    fun perform(action: suspend () -> Unit) {
        if (busy) return
        busy = true
        scope.launch {
            try { action(); error = null }
            catch (e: Exception) { if (e is kotlinx.coroutines.CancellationException) throw e; error = e.message ?: context.getString(R.string.extension_request_failed) }
            finally { busy = false }
        }
    }
    val role = message.optString("role")
    var outputExpanded by remember(entryId) { mutableStateOf(false) }
    var thinkingExpanded by remember(entryId) { mutableStateOf(true) }
    androidx.compose.material3.HorizontalDivider(color = OmpColors.Border)
    if (role == "toolResult") {
        RuntimeChip(stringResource(R.string.chat_tool_output, if (outputExpanded) "▾" else "▸", message.optString("toolName", "tool")), onClick = { outputExpanded = !outputExpanded })
        if (!outputExpanded) return
    } else Text(
        when (role) {
            "user" -> stringResource(R.string.chat_role_user)
            "assistant" -> stringResource(R.string.chat_role_assistant)
            "system" -> stringResource(R.string.chat_role_system)
            "tool" -> stringResource(R.string.chat_role_tool)
            else -> role
        }, color = OmpColors.TextMuted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
    )
    val content = message.opt("content")
    if (content is org.json.JSONArray) {
        for (index in 0 until content.length()) {
            val block = content.optJSONObject(index) ?: continue
            when (block.optString("type")) {
                "text" -> if (role == "toolResult" || role == "tool") {
                    MarkdownText(block.optString("text"), Modifier.fillMaxWidth())
                } else {
                    MessageText(block.optString("text"), Modifier.fillMaxWidth())
                }
                "thinking" -> RuntimeChip(stringResource(R.string.chat_load_thinking, index + 1), enabled = !busy && entryId.isNotBlank(), onClick = {
                    perform { details = ChatRequests.thinking(requester, sessionId, entryId, index).getString("thinking"); thinkingExpanded = true }
                })
                "image" -> HistoryImage(block)
                else -> {
                    var blockExpanded by remember(entryId, index) { mutableStateOf(false) }
                    Column(Modifier.fillMaxWidth().background(OmpColors.ToolBg, panelShape()).border(1.dp, OmpColors.Border, panelShape()).padding(8.dp)) {
                        RuntimeChip("${if (blockExpanded) "▾" else "▸"} ${block.optString("toolName", block.optString("type", stringResource(R.string.chat_details)))}", onClick = { blockExpanded = !blockExpanded })
                        if (blockExpanded) androidx.compose.foundation.text.selection.SelectionContainer {
                            Text(block.toString(2), fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = OmpColors.TextMuted)
                        }
                    }
                }
            }
        }
    } else if (role == "toolResult" || role == "tool") {
        Text(content?.toString().orEmpty(), color = OmpColors.Text)
    } else {
        MessageText(content?.toString().orEmpty(), plainText = true)
    }
    details?.let {
        RuntimeChip(if (thinkingExpanded) stringResource(R.string.chat_hide_details) else stringResource(R.string.chat_show_details), onClick = { thinkingExpanded = !thinkingExpanded })
        if (thinkingExpanded) androidx.compose.foundation.text.selection.SelectionContainer {
            Text(it, color = OmpColors.TextMuted, fontSize = 13.sp, lineHeight = 20.sp)
        }
    }
    media?.let { images -> for (i in 0 until images.length()) images.optJSONObject(i)?.let { HistoryImage(it) } }
    error?.let { Text(it, color = OmpColors.StatusError) }
    if (message.optString("role") == "user") RuntimeChip(stringResource(R.string.chat_copy_to_composer), onClick = {
        val text = if (content is org.json.JSONArray) {
            (0 until content.length()).mapNotNull { index -> content.optJSONObject(index)?.takeIf { it.optString("type") == "text" }?.optString("text") }.joinToString("\n")
        } else content?.toString().orEmpty()
        onEditMessage(text)
    })
    if (entryId.isNotBlank()) {
        if (message.optString("role") == "toolResult") RuntimeChip(stringResource(R.string.chat_load_media), enabled = !busy, onClick = {
            perform {
                val result = ChatRequests.media(requester, sessionId, entryId)
                media = result.getJSONArray("images")
                details = context.getString(R.string.chat_media_summary, media?.length() ?: 0, result.optInt("missingCount"))
            }
        })
        if (message.optString("role") == "user") RuntimeChip(stringResource(R.string.chat_fork_here), enabled = !busy, onClick = {
            perform {
                val command = JSONObject().put("type", "fork").put("entryId", entryId)
                if (!leafId.isNullOrBlank()) command.put("leafId", leafId)
                val result = ChatRequests.command(requester, sessionId, command).getJSONObject("result")
                if (result.optBoolean("cancelled")) details = context.getString(R.string.chat_fork_cancelled)
                else onOpenSession(result.getString("newSessionId"))
            }
        })
    }
}

@Composable
private fun HistoryImage(block: JSONObject) {
    val data = block.optString("data")
    val bitmap = androidx.compose.runtime.produceState<android.graphics.Bitmap?>(null, data) {
        value = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) {
            if (data.isEmpty() || data.length > 28_000_000) return@withContext null
            try {
                val bytes = android.util.Base64.decode(data, android.util.Base64.DEFAULT)
                val options = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
                android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                if (options.outWidth <= 0 || options.outHeight <= 0) return@withContext null
                var sample = 1
                while (options.outWidth / sample > 2048 || options.outHeight / sample > 2048) sample *= 2
                options.inJustDecodeBounds = false
                options.inSampleSize = sample
                android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
            } catch (_: IllegalArgumentException) { null }
        }
    }.value
    if (bitmap != null) androidx.compose.foundation.Image(bitmap.asImageBitmap(), stringResource(R.string.chat_attachment), Modifier.fillMaxWidth().heightIn(max = 320.dp))
    else Text(stringResource(R.string.chat_image_unavailable), color = OmpColors.TextMuted)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ChatStatsHost(requester: RelayRequester, sessionId: String, open: Boolean, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var selected by remember(sessionId) { mutableStateOf<String?>(null) }
    var output by remember(sessionId) { mutableStateOf("") }
    var busy by remember(sessionId) { mutableStateOf(false) }
    Box {
        if (open) {
            OmpModalSheet(
            fullHeight = true,
                onDismissRequest = onDismiss,
                containerColor = OmpColors.Bg,
                contentColor = OmpColors.Text,
            ) {
                Column(Modifier.fillMaxWidth().weight(1f)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.chat_menu_session_info), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                IconButton(onClick = onDismiss, modifier = Modifier.size(48.dp)) { Icon(Icons.Filled.Close, stringResource(R.string.extension_close), tint = OmpColors.TextMuted) }
            }
            Column(Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                listOf("State" to R.string.chat_stats_state, "Stats" to R.string.chat_stats_stats, "System prompt" to R.string.chat_stats_system_prompt).forEach { (name, label) ->
                    RuntimeChip(stringResource(label), enabled = !busy, onClick = {
                        selected = name; busy = true
                        scope.launch {
                            try {
                                val data = when (name) {
                                    "State" -> ChatRequests.sessionState(requester, sessionId)
                                    "Stats" -> ChatRequests.stats(requester, sessionId)
                                    else -> ChatRequests.systemPrompt(requester, sessionId)
                                }
                                output = if (name == "System prompt") {
                                    if (data.isNull("systemPrompt")) context.getString(R.string.chat_system_prompt_unavailable) else data.optString("systemPrompt")
                                } else data.toString(2)
                            } catch (e: Exception) { if (e is kotlinx.coroutines.CancellationException) throw e; output = e.message ?: context.getString(R.string.extension_request_failed) }
                            finally { busy = false }
                        }
                    })
                }
            }
            if (selected != null) Column(Modifier.fillMaxWidth()) {
                if (busy) Text(stringResource(R.string.chat_subagent_loading), color = OmpColors.TextMuted)
                androidx.compose.foundation.text.selection.SelectionContainer { Text(output, color = OmpColors.Text) }
            }
            }
                }
            }
        }
    }
}

@Composable
fun ChatSlashHost(
    requester: RelayRequester,
    sessionCwd: String,
    slashCommands: List<com.dbchbin.ompgui.remote.relay.RelaySlashCommand>,
    draft: String,
    onInsertSlash: (String) -> Unit,
    expanded: Boolean,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    var matches by remember(sessionCwd) { mutableStateOf<List<String>>(emptyList()) }
    var searchError by remember(sessionCwd) { mutableStateOf<String?>(null) }
    var hasMore by remember(sessionCwd) { mutableStateOf(false) }
    val atQuery = extractAtQuery(draft)
    LaunchedEffect(sessionCwd, atQuery) {
        matches = emptyList(); searchError = null; hasMore = false
        if (atQuery != null && sessionCwd.isNotBlank()) {
            try {
                val result = ChatRequests.fileSearch(requester, sessionCwd, atQuery)
                val items = result.optJSONArray("matches")
                matches = if (items == null) emptyList() else (0 until items.length()).mapNotNull { items.optJSONObject(it)?.optString("path") }
                hasMore = result.optBoolean("hasMore")
            } catch (e: Exception) { if (e is kotlinx.coroutines.CancellationException) throw e; searchError = e.message ?: context.getString(R.string.chat_file_search_failed) }
        }
    }
    Box {
        if (expanded) {
            OmpModalSheet(
            fullHeight = true,
                onDismissRequest = onDismiss,
                containerColor = OmpColors.Bg,
                contentColor = OmpColors.Text,
            ) {
                Column(Modifier.fillMaxWidth().weight(1f)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.chat_menu_commands), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                    IconButton(onClick = onDismiss, modifier = Modifier.size(48.dp)) { Icon(Icons.Filled.Close, stringResource(R.string.extension_close), tint = OmpColors.TextMuted) }
                }
            Column(Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                val commands = if (draft.startsWith("/")) slashCommands.filter { it.name.contains(draft.removePrefix("/").substringBefore(' '), ignoreCase = true) } else slashCommands
                commands.forEach { command -> RuntimeChip("/${command.name}", onClick = { onInsertSlash("/${command.name} "); onDismiss() }) }
                if (commands.isEmpty()) Text(stringResource(R.string.chat_no_commands), color = OmpColors.TextMuted)
            if (atQuery != null) Column(Modifier.fillMaxWidth()) {
                searchError?.let { Text(it, color = OmpColors.StatusError) }
                matches.forEach { path -> RuntimeChip(path, onClick = {
                    val token = if (path.any { it.isWhitespace() }) "@\"${path.replace("\"", "\\\"")}\" " else "@$path "
                    onInsertSlash(draft.dropLast(atQuery.length + 1) + token)
                    onDismiss()
                }) }
                if (hasMore) Text(stringResource(R.string.chat_refine_file_query), color = OmpColors.TextMuted)
            }
            }
                }
            }
        }
    }
    if (!expanded && (draft.startsWith("/") || atQuery != null)) {
        Column(Modifier.fillMaxWidth().heightIn(max = 160.dp).verticalScroll(rememberScrollState()).background(OmpColors.BgPanel).padding(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (draft.startsWith("/")) {
                val commands = slashCommands.filter { it.name.contains(draft.removePrefix("/").substringBefore(' '), ignoreCase = true) }
                commands.forEach { command -> RuntimeChip("/${command.name}", onClick = { onInsertSlash("/${command.name} ") }) }
                if (commands.isEmpty()) Text(stringResource(R.string.chat_no_commands), color = OmpColors.TextMuted)
            }
            if (atQuery != null) {
                searchError?.let { Text(it, color = OmpColors.StatusError) }
                matches.forEach { path -> RuntimeChip(path, onClick = {
                    val token = if (path.any { it.isWhitespace() }) "@\"${path.replace("\"", "\\\"")}\" " else "@$path "
                    onInsertSlash(draft.dropLast(atQuery.length + 1) + token)
                }) }
                if (hasMore) Text(stringResource(R.string.chat_refine_file_query), color = OmpColors.TextMuted)
            }
        }
    }
}

/** Slash + skill commands and @ file completion inline menu state. */
fun matchSlashCommands(
    query: String,
    commands: List<com.dbchbin.ompgui.remote.relay.RelaySlashCommand>,
): List<com.dbchbin.ompgui.remote.relay.RelaySlashCommand> {
    val q = query.trimStart().removePrefix("/").lowercase()
    if (q.isEmpty()) return commands.take(8)
    return commands.filter { it.name.lowercase().contains(q) }.take(8)
}

fun extractAtQuery(text: String): String? {
    val plain = Regex("(?:^|\\s)@([^\\s\"]*)$").find(text) ?: return null
    return plain.groupValues[1]
}

fun slashInsertText(name: String, requiresArgs: Boolean): String =
    if (requiresArgs) "/$name " else "/$name"

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ApprovalBanner(
    message: String,
    onApprove: () -> Unit,
    onDeny: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(panelShape())
            .background(OmpColors.BgPanel)
            .border(1.dp, OmpColors.StatusWarning, panelShape())
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Text(message, fontSize = 13.sp, color = OmpColors.Text)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            RuntimeChip(label = stringResource(R.string.chat_approve), onClick = onApprove)
            RuntimeChip(label = stringResource(R.string.chat_deny), onClick = onDeny)
        }
    }
}

@Composable
fun ExtensionNoticeList(notices: List<EventProjector.ChatNotice>, onDismiss: (String) -> Unit) {
    val informational = remember(notices) { notices.filter { it.type == "info" } }
    val important = remember(notices) { notices.filter { it.type != "info" } }
    var detailsOpen by remember { mutableStateOf(false) }
    LaunchedEffect(informational.isEmpty()) { if (informational.isEmpty()) detailsOpen = false }
    important.forEach { notice -> ExtensionNoticeRow(notice, onDismiss) }
    if (informational.isNotEmpty()) {
        Row(
            Modifier.fillMaxWidth().clip(panelShape()).background(OmpColors.BgPanel)
                .border(1.dp, OmpColors.Border, panelShape())
                .clickable { detailsOpen = true }.heightIn(min = 48.dp).padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(stringResource(R.string.chat_notices_count, informational.size), fontSize = 12.sp, fontWeight = FontWeight.Medium, color = OmpColors.TextMuted)
            Text(informational.last().message, modifier = Modifier.weight(1f), fontSize = 12.sp,
                color = OmpColors.TextDim, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("▸", fontSize = 13.sp, color = OmpColors.TextMuted)
        }
    }
    if (detailsOpen && informational.isNotEmpty()) {
        OmpModalSheet(
            fullHeight = true,
            onDismissRequest = { detailsOpen = false },
            containerColor = OmpColors.Bg,
            contentColor = OmpColors.Text,
        ) {
            Column(Modifier.fillMaxWidth().weight(1f)) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.chat_extension_notices_count, informational.size), modifier = Modifier.weight(1f), fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    IconButton(onClick = { detailsOpen = false }, modifier = Modifier.size(48.dp)) { Icon(Icons.Filled.Close, stringResource(R.string.extension_close), tint = OmpColors.TextMuted) }
                }
                Column(Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    informational.forEach { notice -> ExtensionNoticeRow(notice, onDismiss) }
                }
            }
        }
    }
}

@Composable
private fun ExtensionNoticeRow(notice: EventProjector.ChatNotice, onDismiss: (String) -> Unit) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(panelShape())
                .background(OmpColors.BgPanel)
                .border(
                    1.dp,
                    when (notice.type) {
                        "error" -> OmpColors.StatusError
                        "warning" -> OmpColors.StatusWarning
                        else -> OmpColors.Border
                    },
                    panelShape(),
                )
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                notice.message,
                fontSize = 13.sp,
                color = OmpColors.Text,
                modifier = Modifier.weight(1f),
            )
            IconButton(onClick = { onDismiss(notice.id) }, modifier = Modifier.size(48.dp)) {
                Icon(Icons.Filled.Close, stringResource(R.string.chat_dismiss_notice), tint = OmpColors.TextMuted)
            }
        }
}

@Composable
fun ExtensionDialogSheet(
    request: EventProjector.ChatExtensionRequest,
    running: Boolean,
    error: String?,
    onConfirm: (JSONObject) -> Unit,
    onCancel: () -> Unit,
) {
    var value by androidx.compose.runtime.saveable.rememberSaveable(request.id) {
        mutableStateOf(
            when (request) {
                is EventProjector.ChatExtensionRequest.Editor -> request.prefill.orEmpty()
                else -> ""
            },
        )
    }
    var choice by androidx.compose.runtime.saveable.rememberSaveable(request.id) { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = { if (!running) onCancel() },
        containerColor = OmpColors.BgPanel,
        title = {
            OmpDialogSystemBars()
            Text(
                request.title,
                color = OmpColors.Text,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
            )
        },
        text = {
            Column(
                modifier = Modifier.heightIn(max = 480.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                when (request) {
                    is EventProjector.ChatExtensionRequest.Confirm -> {
                        if (request.message.isNotBlank()) {
                            Text(request.message, fontSize = 14.sp, color = OmpColors.Text)
                        }
                    }
                    is EventProjector.ChatExtensionRequest.Select -> {
                        request.options.forEachIndexed { index, option ->
                            val selected = choice == option
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(if (selected) OmpColors.BgSelected else OmpColors.BgPanel)
                                    .semantics(mergeDescendants = true) { this.selected = selected }
                                    .clickable(enabled = !running, role = androidx.compose.ui.semantics.Role.RadioButton) { choice = option }.heightIn(min = 48.dp)
                                    .padding(horizontal = 12.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(option, fontSize = 14.sp, color = OmpColors.Text)
                                    request.optionDescriptions.getOrNull(index)?.let { description ->
                                        Text(description, fontSize = 12.sp, color = OmpColors.TextMuted)
                                    }
                                }
                            }
                        }
                    }
                    is EventProjector.ChatExtensionRequest.Input,
                    is EventProjector.ChatExtensionRequest.Editor,
                    -> {
                        BasicTextField(
                            value = value,
                            onValueChange = { value = it },
                            readOnly = running,
                            minLines = if (request is EventProjector.ChatExtensionRequest.Editor) 5 else 1,
                            maxLines = if (request is EventProjector.ChatExtensionRequest.Editor) 12 else 3,
                            modifier = Modifier.fillMaxWidth(),
                            textStyle = TextStyle(fontSize = 14.sp, color = OmpColors.Text),
                            cursorBrush = SolidColor(OmpColors.Accent),
                            decorationBox = { inner ->
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .background(OmpColors.Bg, RoundedCornerShape(8.dp))
                                        .border(1.dp, OmpColors.Border, RoundedCornerShape(8.dp))
                                        .padding(horizontal = 10.dp, vertical = 8.dp),
                                ) {
                                    inner()
                                }
                            },
                        )
                    }
                }
                if (!error.isNullOrBlank()) {
                    Text(error, fontSize = 12.sp, color = OmpColors.StatusError)
                }
                if (!running) {
                    Text(
                        stringResource(R.string.chat_waiting_response),
                        fontSize = 12.sp,
                        color = OmpColors.TextMuted,
                    )
                }
            }
        },
        confirmButton = {
            Text(
                stringResource(R.string.chat_send),
                color = OmpColors.Accent,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .heightIn(min = 48.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .clickable(enabled = !running && (request !is EventProjector.ChatExtensionRequest.Select || choice in request.options)) {
                        when (request) {
                            is EventProjector.ChatExtensionRequest.Select -> {
                                val picked = choice ?: return@clickable
                                onConfirm(JSONObject().put("value", picked))
                            }
                            is EventProjector.ChatExtensionRequest.Confirm -> {
                                onConfirm(JSONObject().put("confirmed", true))
                            }
                            is EventProjector.ChatExtensionRequest.Input,
                            is EventProjector.ChatExtensionRequest.Editor,
                            -> onConfirm(JSONObject().put("value", value))
                        }
                    }
                    .padding(horizontal = 12.dp, vertical = 8.dp),
            )
        },
        dismissButton = {
            Text(
                stringResource(R.string.extension_cancel),
                color = OmpColors.TextMuted,
                fontSize = 14.sp,
                modifier = Modifier
                    .heightIn(min = 48.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .clickable(enabled = !running) { onCancel() }
                    .padding(horizontal = 12.dp, vertical = 8.dp),
            )
        },
    )
}
