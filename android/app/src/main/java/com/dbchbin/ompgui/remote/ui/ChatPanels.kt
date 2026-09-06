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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Queue
import androidx.compose.material.icons.filled.Compress
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.filled.AccountTree
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.FileUpload
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
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
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dbchbin.ompgui.remote.relay.ChatRequests
import com.dbchbin.ompgui.remote.relay.EventProjector
import com.dbchbin.ompgui.remote.relay.RelayRequester
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/** Reduced-motion aware: panels render statically, no animation. */
private fun panelShape() = RoundedCornerShape(10.dp)

// ---------------------------------------------------------------------------
// Todo phases above composer (desktop ComposerPanels/TodoList parity).
// ---------------------------------------------------------------------------

@Composable
fun TodoPanel(todos: List<com.dbchbin.ompgui.remote.relay.TodoPhase>) {
    if (todos.isEmpty()) return
    var expanded by remember { mutableStateOf(false) }
    val tasks = remember(todos) { todos.flatMap { it.tasks } }
    val done = remember(tasks) { tasks.count { it.status == "completed" } }
    val korean = remember { Locale.getDefault().language == "ko" }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(panelShape())
            .background(OmpColors.BgPanel)
            .border(1.dp, OmpColors.Border, panelShape())
            .padding(horizontal = 12.dp, vertical = 0.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(6.dp))
                .clickable { expanded = !expanded }
                .heightIn(min = 48.dp)
                .padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                if (korean) "할 일 $done/${tasks.size}" else "Todos $done/${tasks.size}",
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = OmpColors.Text,
                modifier = Modifier.weight(1f),
            )
            Text(
                if (expanded) "▾" else "▸",
                fontSize = 13.sp,
                color = OmpColors.TextMuted,
            )
        }
        if (expanded) {
            Column(Modifier.heightIn(max = 240.dp).verticalScroll(rememberScrollState())) {
            todos.forEach { phase ->
                Text(
                    phase.name,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = OmpColors.TextMuted,
                    modifier = Modifier.padding(top = 6.dp),
                )
                phase.tasks.forEach { task ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
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
                            fontSize = 13.sp,
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
fun SubagentPanel(
    requester: RelayRequester,
    sessionId: String,
    subagents: List<com.dbchbin.ompgui.remote.relay.SubagentChip>,
) {
    if (subagents.isEmpty()) return
    var expanded by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<com.dbchbin.ompgui.remote.relay.SubagentChip?>(null) }
    val korean = remember { Locale.getDefault().language == "ko" }
    val live = remember(subagents) { subagents.count { it.status == "started" || it.status == "running" } }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(panelShape())
            .background(OmpColors.BgPanel)
            .border(1.dp, OmpColors.Border, panelShape())
            .padding(horizontal = 12.dp, vertical = 0.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(6.dp))
                .clickable { expanded = !expanded }
                .heightIn(min = 48.dp)
                .padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                if (korean) "서브에이전트 ${subagents.size}" else "Subagents ${subagents.size}",
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = OmpColors.Text,
                modifier = Modifier.weight(1f),
            )
            if (live > 0) {
                Text(
                    if (korean) "$live 실행 중" else "$live live",
                    fontSize = 12.sp,
                    color = OmpColors.Accent,
                )
                Spacer(modifier = Modifier.width(8.dp))
            }
            Text(if (expanded) "▾" else "▸", fontSize = 13.sp, color = OmpColors.TextMuted)
        }
        if (expanded) {
            Column(Modifier.heightIn(max = 240.dp).verticalScroll(rememberScrollState())) {
            subagents.forEach { chip ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(6.dp))
                        .clickable { selected = chip }
                        .padding(horizontal = 8.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        modifier = Modifier
                            .width(88.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(OmpColors.BgHover)
                            .border(1.dp, OmpColors.Border, RoundedCornerShape(8.dp))
                            .padding(horizontal = 6.dp, vertical = 6.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            chip.status,
                            fontSize = 12.sp,
                            color = if (chip.status == "started" || chip.status == "running") {
                                OmpColors.Accent
                            } else {
                                OmpColors.TextMuted
                            },
                        )
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            chip.agent.ifBlank { chip.id },
                            fontSize = 13.sp,
                            color = OmpColors.Text,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (chip.task.isNotBlank()) {
                            Text(
                                chip.task,
                                fontSize = 12.sp,
                                color = OmpColors.TextMuted,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }
        }
    }
    }
    if (selected != null) {
        SubagentTranscriptDialog(
            requester = requester,
            sessionId = sessionId,
            subagent = selected!!,
            onDismiss = { selected = null },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SubagentTranscriptDialog(
    requester: RelayRequester,
    sessionId: String,
    subagent: com.dbchbin.ompgui.remote.relay.SubagentChip,
    onDismiss: () -> Unit,
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
    val korean = remember { Locale.getDefault().language == "ko" }

    LaunchedEffect(sessionId, subagent.id) {
        if (sessionId.isBlank()) {
            loading = false
            error = if (korean) "세션이 없습니다" else "No session"
            return@LaunchedEffect
        }
        loading = true
        error = null
        try {
            val data = ChatRequests.subagentCompletion(requester, sessionId, subagent.id)
            completion = data.optString("completion").takeIf { data.has("completion") && !data.isNull("completion") }
            completionTruncated = data.optBoolean("truncated", false)
        } catch (e: Exception) {
            error = e.message ?: "Transcript unavailable"
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
                exhausted = page.exhausted
            } catch (e: Exception) {
                // Surface the server-coded error; never fake transcript content.
                if (e is CancellationException) throw e
                error = e.message ?: "Transcript page failed"
            } finally {
                loading = false
            }
        }
    }

    ModalBottomSheet(
        dragHandle = { OmpSheetDragHandle() },
        onDismissRequest = onDismiss,
        containerColor = OmpColors.Bg,
        contentColor = OmpColors.Text,
    ) {
        OmpDialogSystemBars()
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = 560.dp)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(subagent.agent.ifBlank { subagent.id }, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                    color = OmpColors.Text, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                IconButton(onClick = onDismiss, modifier = Modifier.size(48.dp)) { Icon(Icons.Filled.Close, "Close", tint = OmpColors.TextMuted) }
            }
            Text(
                "${subagent.status} · ${subagent.id}",
                fontSize = 12.sp,
                color = OmpColors.TextMuted,
            )
            if (loading) {
                Text(if (korean) "불러오는 중…" else "Loading…", fontSize = 14.sp, color = OmpColors.TextMuted)
            }
            if (!error.isNullOrBlank()) {
                Text(error!!, fontSize = 13.sp, color = OmpColors.StatusError)
            }
            if (!completion.isNullOrBlank()) {
                Text(
                    if (korean) "완료 출력" else "Completion",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = OmpColors.Text,
                )
                MessageText(completion!!, Modifier.fillMaxWidth())
                if (completionTruncated) {
                    Text(
                        if (korean) "(잘림)" else "(truncated)",
                        fontSize = 12.sp,
                        color = OmpColors.StatusWarning,
                    )
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (transcriptOpen) {
                        if (korean) "대화 닫기" else "Hide transcript"
                    } else {
                        if (korean) "대화 보기" else "Show transcript"
                    },
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = OmpColors.Accent,
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .clickable {
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
                        fontSize = 12.sp,
                        fontFamily = FontFamily.Monospace,
                        color = OmpColors.Text,
                        lineHeight = 18.sp,
                    )
                }
                if (!exhausted) {
                    Text(
                        if (korean) "더 보기" else "Load more",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = OmpColors.Accent,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .clickable(enabled = !loading) { loadPage() }.heightIn(min = 48.dp)
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                    )
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Queue: steer / follow-up / interrupt while running.
// ---------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun QueuePanel(
    running: Boolean,
    steering: List<String>,
    followUp: List<String>,
    draft: String,
    onSteer: (String) -> Unit,
    onFollowUp: (String) -> Unit,
    onInterrupt: (String) -> Unit,

) {
    val hasQueue = steering.isNotEmpty() || followUp.isNotEmpty()
    if (!running && !hasQueue) return
    val korean = remember { Locale.getDefault().language == "ko" }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(panelShape())
            .background(OmpColors.BgPanel)
            .border(1.dp, OmpColors.Border, panelShape())
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (running) {
            Text(
                if (korean) "실행 중 — steer/follow-up/중단 가능" else "Running — steer, follow up, or interrupt",
                fontSize = 12.sp,
                color = OmpColors.TextMuted,
            )
            val canQueue = draft.isNotBlank()
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                QueueAction(
                    label = if (korean) "Steer" else "Steer",
                    enabled = canQueue,
                    onClick = { onSteer(draft) },
                )
                QueueAction(
                    label = if (korean) "후속" else "Follow-up",
                    enabled = canQueue,
                    onClick = { onFollowUp(draft) },
                )
                QueueAction(
                    label = if (korean) "중단+전송" else "Interrupt",
                    enabled = canQueue,
                    onClick = { onInterrupt(draft) },
                )
            }
        }
        if (hasQueue) Text("Queued messages cannot be recalled or promoted by this runtime.", color = OmpColors.TextMuted, fontSize = 12.sp)
        Column(Modifier.heightIn(max = 160.dp).verticalScroll(rememberScrollState())) {
            steering.forEach { Text("[steer] $it", color = OmpColors.Text) }
            followUp.forEach { Text("[follow-up] $it", color = OmpColors.Text) }
        }
    }
}

@Composable
private fun QueueAction(label: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .heightIn(min = 48.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(if (enabled) OmpColors.BgHover else OmpColors.BgPanel)
            .border(1.dp, OmpColors.Border, RoundedCornerShape(8.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, fontSize = 13.sp, color = if (enabled) OmpColors.Text else OmpColors.TextDim)
    }
}


// ---------------------------------------------------------------------------
// Runtime controls: modes, bash, handoff, reload, compact, fork, export.
// ---------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
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
    expanded: Boolean,
    onExpandedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    // State lives above every disclosure subtree, so collapsing never discards a draft.
    var bashDraft by remember(sessionId) { mutableStateOf("") }
    var compactDraft by remember(sessionId) { mutableStateOf("") }
    var bashError by remember(sessionId) { mutableStateOf<String?>(null) }
    var category by remember(sessionId) { mutableStateOf<String?>(null) }
    var branch by remember(sessionId) { mutableStateOf<String?>(null) }
    val korean = LocalContext.current.resources.configuration.locales[0].language == "ko"
    val onLabel = if (korean) "켜짐" else "On"
    val offLabel = if (korean) "꺼짐" else "Off"
    val boolChoices = listOf("true" to onLabel, "false" to offLabel)
    val interruptChoices = listOf(
        "immediate" to if (korean) "즉시" else "Immediate",
        "wait" to if (korean) "대기" else "Wait",
    )
    val queueChoices = listOf(
        "one-at-a-time" to if (korean) "한 번에 하나씩" else "One at a time",
        "all" to if (korean) "모두" else "All",
    )
    val toggleBranch: (String) -> Unit = { branch = if (branch == it) null else it }
    val toggleCategory: (String) -> Unit = {
        category = if (category == it) null else it
        branch = null
    }
    val scrollState = rememberScrollState()
    if (expanded) {
        ModalBottomSheet(
            onDismissRequest = { onExpandedChange(false) },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            dragHandle = { OmpSheetDragHandle() },
            containerColor = OmpColors.Bg,
            contentColor = OmpColors.Text,
        ) {
            OmpDialogSystemBars()
            Column(
                modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)
                    .heightIn(max = 560.dp)
                    .border(1.dp, OmpColors.Border, RoundedCornerShape(16.dp))
                    .clip(RoundedCornerShape(16.dp)).background(OmpColors.BgPanel),
            ) {
                Row(
                    Modifier.fillMaxWidth().height(48.dp).padding(start = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(Icons.Filled.Tune, null, Modifier.size(20.dp), tint = OmpColors.TextMuted)
                    Text(if (korean) "세션 실행 제어" else "Session controls",
                        Modifier.weight(1f), fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                        color = OmpColors.Text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    IconButton(onClick = { onExpandedChange(false) }, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Filled.Close, if (korean) "세션 실행 제어 닫기" else "Close session controls", tint = OmpColors.TextMuted)
                    }
                }
                Column(Modifier.fillMaxWidth().weight(1f, fill = false).verticalScroll(scrollState)) {
            RuntimeTreeRow(
                label = if (korean) "실행" else "Execution",
                expanded = category == "execution", heading = true, icon = Icons.Filled.PlayArrow,
                onClick = { toggleCategory("execution") },
            )
            if (category == "execution") {
                RuntimeSettingBranch(
                    if (korean) "빠른 모드" else "Fast mode", fastMode?.toString(), boolChoices,
                    branch == "fast", { toggleBranch("fast") }, { onFastModeChange(it == "true") },
                )
                RuntimeSettingBranch(
                    if (korean) "자동 재시도" else "Auto retry", autoRetry?.toString(), boolChoices,
                    branch == "retry", { toggleBranch("retry") }, { onAutoRetryChange(it == "true") },
                )
                RuntimeSettingBranch(
                    if (korean) "인터럽트 모드" else "Interrupt mode", interruptMode, interruptChoices,
                    branch == "interrupt", { toggleBranch("interrupt") }, onInterruptModeChange,
                )
                RuntimeTreeRow(if (korean) "모델 순환" else "Cycle model", depth = 1, icon = Icons.Filled.SwapHoriz, onClick = onCycleModel)
                RuntimeTreeRow(if (korean) "핸드오프" else "Handoff", depth = 1, icon = Icons.Filled.AccountTree, onClick = onHandoff)
                RuntimeTreeRow(if (korean) "리로드" else "Reload", depth = 1, icon = Icons.Filled.Refresh, onClick = onReload)
                RuntimeTreeRow(if (korean) "재시도 중단" else "Abort retry", depth = 1, icon = Icons.Filled.Stop, onClick = onRetryAbort)
                if (running) RuntimeTreeRow(if (korean) "에이전트 중단" else "Abort agent", depth = 1, icon = Icons.Filled.Stop, onClick = onAbort)
            }
            RuntimeTreeRow(
                label = if (korean) "메시지 대기열" else "Message queue",
                expanded = category == "queue", heading = true, icon = Icons.Filled.Queue,
                onClick = { toggleCategory("queue") },
            )
            if (category == "queue") {
                RuntimeSettingBranch(
                    if (korean) "스티어링 모드" else "Steering", steeringMode, queueChoices,
                    branch == "steering", { toggleBranch("steering") }, onSteeringModeChange,
                )
                RuntimeSettingBranch(
                    if (korean) "후속 메시지 모드" else "Follow-up", followUpMode, queueChoices,
                    branch == "followUp", { toggleBranch("followUp") }, onFollowUpModeChange,
                )
            }
            RuntimeTreeRow(
                label = if (korean) "컨텍스트" else "Context",
                expanded = category == "context", heading = true, icon = Icons.Filled.Compress,
                onClick = { toggleCategory("context") },
            )
            if (category == "context") {
                RuntimeSettingBranch(
                    if (korean) "자동 압축" else "Auto compaction", autoCompaction?.toString(), boolChoices,
                    branch == "autoCompact", { toggleBranch("autoCompact") }, { onAutoCompactionChange(it == "true") },
                )
                RuntimeTreeRow(if (korean) "지금 압축" else "Compact now", depth = 1, icon = Icons.Filled.Compress, onClick = onCompact)
                RuntimeTreeRow(
                    if (korean) "사용자 지정 압축" else "Custom compaction", depth = 1, icon = Icons.Filled.Edit,
                    expanded = branch == "compact", onClick = { toggleBranch("compact") },
                )
                if (branch == "compact") {
                    RuntimeDraftEditor(
                        label = if (korean) "압축 지시 (선택)" else "Compaction instructions (optional)",
                        value = compactDraft, onValueChange = { compactDraft = it },
                    )
                    RuntimeTreeRow(if (korean) "지시 적용 및 압축" else "Apply instructions and compact", depth = 2, icon = Icons.Filled.Compress) {
                        onCustomCompact(compactDraft.trim())
                        compactDraft = ""
                    }
                }
            }
            RuntimeTreeRow(
                label = if (korean) "셸" else "Shell",
                expanded = category == "shell", heading = true, icon = Icons.Filled.Terminal,
                onClick = { toggleCategory("shell") },
            )
            if (category == "shell") {
                RuntimeDraftEditor(
                    label = if (korean) "셸 명령 (단일 !만 지원)" else "Shell command (single ! only)",
                    value = bashDraft, monospace = true, depth = 1,
                    onValueChange = { bashDraft = it; bashError = null },
                )
                if (bashDraft.startsWith("!!")) {
                    Text(
                        if (korean) "!! 제외 실행은 지원되지 않습니다. 서버 오류가 표시됩니다."
                        else "!! excluded output is unsupported and fails server-side.",
                        modifier = Modifier.padding(start = 28.dp, end = 12.dp),
                        fontSize = 12.sp, color = OmpColors.StatusWarning,
                    )
                }
                bashError?.let {
                    Text(it, modifier = Modifier.padding(start = 28.dp, end = 12.dp), fontSize = 12.sp, color = OmpColors.StatusError)
                }
                RuntimeTreeRow(if (korean) "실행" else "Run", depth = 1, icon = Icons.Filled.PlayArrow) {
                    val cmd = bashDraft.trim().removePrefix("!").trim()
                    if (cmd.isEmpty()) {
                        bashError = if (korean) "명령을 입력하세요" else "Enter a command"
                    } else {
                        // Preserve !! submission: the server's coded error remains authoritative.
                        bashError = null
                        onBash(bashDraft.trim())
                        bashDraft = ""
                    }
                }
                RuntimeTreeRow(if (korean) "bash 중단" else "Abort bash", depth = 1, icon = Icons.Filled.Stop, onClick = onAbortBash)
            }
            RuntimeTreeRow(
                label = if (korean) "출력" else "Output",
                expanded = category == "output", heading = true, icon = Icons.Filled.Description,
                onClick = { toggleCategory("output") },
            )
            if (category == "output") {
                RuntimeTreeRow(if (korean) "마지막 복사" else "Copy last", depth = 1, icon = Icons.Filled.ContentCopy, onClick = onCopyLast)
                RuntimeTreeRow(if (korean) "내보내기" else "Export", depth = 1, icon = Icons.Filled.FileUpload, onClick = onExport)
                RuntimeTreeRow(if (korean) "명령 팔레트" else "Command palette", depth = 1, icon = Icons.Filled.Terminal, onClick = onOpenPalette)
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
    val korean = LocalContext.current.resources.configuration.locales[0].language == "ko"
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
                        if (korean) "펼쳐짐" else "Expanded"
                    } else {
                        if (korean) "접힘" else "Collapsed"
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
                    value, modifier = Modifier.width(112.dp).padding(start = 8.dp),
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
    val korean = LocalContext.current.resources.configuration.locales[0].language == "ko"
    val selectedChoice = choices.firstOrNull { it.first == current }
    RuntimeTreeRow(
        label, depth = 1,
        value = selectedChoice?.second ?: if (korean) "사용 불가" else "Unavailable",
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
) {
    var expanded by remember(sessionId, message.timestamp, message.role) { mutableStateOf(false) }
    val preview = remember(message.text) { message.text.take(4_000) }
    Column(modifier = Modifier.fillMaxWidth()) {
        val visibleText = if (expanded) message.text else preview
        val textModifier = if (expanded) Modifier.fillMaxWidth().heightIn(max = 420.dp).verticalScroll(rememberScrollState()) else Modifier.fillMaxWidth()
        if (message.role == "toolResult" || message.role == "tool") {
            MarkdownText(visibleText, textModifier)
        } else {
            MessageText(visibleText, textModifier)
        }
        if (!expanded) {
            Text(
                "Show full (${message.text.length} chars)",
                fontSize = 12.sp,
                color = OmpColors.Accent,
                modifier = Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .clickable { expanded = true }.heightIn(min = 48.dp)
                    .padding(horizontal = 8.dp, vertical = 8.dp),
            )
        } else {
            Text(
                "Show less",
                fontSize = 12.sp,
                color = OmpColors.TextMuted,
                modifier = Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .clickable { expanded = false }.heightIn(min = 48.dp)
                    .padding(horizontal = 8.dp, vertical = 8.dp),
            )
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
    val scope = rememberCoroutineScope()
    var error by remember(sessionId, requests.firstOrNull()) { mutableStateOf<String?>(null) }
    var sending by remember(sessionId, requests.firstOrNull()) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().heightIn(max = 220.dp).verticalScroll(rememberScrollState())) {
        ExtensionNoticeList(notices, onDismissNotice)
        status.forEach { (key, value) -> Text("$key: $value", color = OmpColors.Text) }
        widgets.forEach { (key, lines) -> Text("$key\n${lines.joinToString("\n")}", color = OmpColors.Text) }
    }
    val request = requests.firstOrNull() ?: return
    val id = when (request) {
        is EventProjector.ChatExtensionRequest.Select -> request.id
        is EventProjector.ChatExtensionRequest.Confirm -> request.id
        is EventProjector.ChatExtensionRequest.Input -> request.id
        is EventProjector.ChatExtensionRequest.Editor -> request.id
    }
    fun respond(response: JSONObject) {
        if (sending) return
        sending = true
        scope.launch {
            try {
                ChatRequests.command(requester, sessionId, ChatRequests.extensionResponse(id, response))
                onDismissRequest(id)
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                error = e.message ?: "Response failed"
            } finally { sending = false }
        }
    }
    ExtensionDialogSheet(request, sending, error, ::respond, { respond(JSONObject().put("cancelled", true)) })
}

@Composable
fun ChatHistoryHost(requester: RelayRequester, sessionId: String, leafId: String?, onOpenSession: (String) -> Unit, onEditMessage: (String) -> Unit, expanded: Boolean, onDismiss: () -> Unit) {
    androidx.compose.runtime.key(sessionId, leafId) {
        ChatHistoryContent(requester, sessionId, leafId, onOpenSession, onEditMessage, expanded, onDismiss)
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun ChatHistoryContent(requester: RelayRequester, sessionId: String, leafId: String?, onOpenSession: (String) -> Unit, onEditMessage: (String) -> Unit, expanded: Boolean, onDismiss: () -> Unit) {
    var page by remember(sessionId) { mutableStateOf<ChatRequests.HistoryPage?>(null) }
    var busy by remember(sessionId) { mutableStateOf(false) }
    var error by remember(sessionId) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    fun load(offset: Int) {
        if (busy) return
        busy = true
        scope.launch {
            try { page = ChatRequests.parseHistoryPage(ChatRequests.history(requester, sessionId, leafId ?: page?.leafId, offset, 25)); error = null }
            catch (e: Exception) { if (e is kotlinx.coroutines.CancellationException) throw e; error = e.message ?: "History unavailable" }
            finally { busy = false }
        }
    }
    Box {
        LaunchedEffect(expanded) { if (expanded && page == null) load(0) }
        if (expanded) ModalBottomSheet(dragHandle = { OmpSheetDragHandle() }, onDismissRequest = onDismiss, containerColor = OmpColors.Bg, contentColor = OmpColors.Text) {
            OmpDialogSystemBars()
        Column(Modifier.fillMaxWidth().heightIn(max = 560.dp).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("History", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                IconButton(onClick = onDismiss, modifier = Modifier.size(48.dp)) { Icon(Icons.Filled.Close, "Close", tint = OmpColors.TextMuted) }
            }
            if (busy) Text("Loading…", color = OmpColors.TextMuted)
            error?.let { Text(it, color = OmpColors.StatusError) }
            page?.let { current ->
                Text("${current.offset} / ${current.total}", color = OmpColors.TextMuted)
                for (i in 0 until current.messages.length()) {
                    val message = current.messages.optJSONObject(i) ?: continue
                    val entryId = current.entryIds.optString(i)
                    androidx.compose.runtime.key(sessionId, entryId, current.offset + i) {
                        HistoryEntry(requester, sessionId, entryId, message, onOpenSession, onEditMessage)
                    }
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    RuntimeChip("Previous", enabled = !busy && current.offset > 0, onClick = { load((current.offset - 25).coerceAtLeast(0)) })
                    RuntimeChip("Next", enabled = !busy && current.hasMore, onClick = { load(current.offset + current.messages.length()) })
                }
            }
            RuntimeChip("Refresh", enabled = !busy, onClick = { load(page?.offset ?: 0) })
        }
        }
    }
}

@Composable
private fun HistoryEntry(requester: RelayRequester, sessionId: String, entryId: String, message: JSONObject, onOpenSession: (String) -> Unit, onEditMessage: (String) -> Unit) {
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
            catch (e: Exception) { if (e is kotlinx.coroutines.CancellationException) throw e; error = e.message ?: "Request failed" }
            finally { busy = false }
        }
    }
    val role = message.optString("role")
    var outputExpanded by remember(entryId) { mutableStateOf(false) }
    var thinkingExpanded by remember(entryId) { mutableStateOf(true) }
    androidx.compose.material3.HorizontalDivider(color = OmpColors.Border)
    if (role == "toolResult") {
        RuntimeChip("${if (outputExpanded) "▾" else "▸"} Tool output · ${message.optString("toolName", "tool")}", onClick = { outputExpanded = !outputExpanded })
        if (!outputExpanded) return
    } else Text(role, color = OmpColors.TextMuted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
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
                "thinking" -> RuntimeChip("Load thinking ${index + 1}", enabled = !busy && entryId.isNotBlank(), onClick = {
                    perform { details = ChatRequests.thinking(requester, sessionId, entryId, index).getString("thinking"); thinkingExpanded = true }
                })
                "image" -> HistoryImage(block)
                else -> {
                    var blockExpanded by remember(entryId, index) { mutableStateOf(false) }
                    Column(Modifier.fillMaxWidth().background(OmpColors.ToolBg, panelShape()).border(1.dp, OmpColors.Border, panelShape()).padding(8.dp)) {
                        RuntimeChip("${if (blockExpanded) "▾" else "▸"} ${block.optString("toolName", block.optString("type", "Details"))}", onClick = { blockExpanded = !blockExpanded })
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
        RuntimeChip(if (thinkingExpanded) "Hide details" else "Show details", onClick = { thinkingExpanded = !thinkingExpanded })
        if (thinkingExpanded) androidx.compose.foundation.text.selection.SelectionContainer {
            Text(it, color = OmpColors.TextMuted, fontSize = 13.sp, lineHeight = 20.sp)
        }
    }
    media?.let { images -> for (i in 0 until images.length()) images.optJSONObject(i)?.let { HistoryImage(it) } }
    error?.let { Text(it, color = OmpColors.StatusError) }
    if (message.optString("role") == "user") RuntimeChip("Copy to composer", onClick = {
        val text = if (content is org.json.JSONArray) {
            (0 until content.length()).mapNotNull { index -> content.optJSONObject(index)?.takeIf { it.optString("type") == "text" }?.optString("text") }.joinToString("\n")
        } else content?.toString().orEmpty()
        onEditMessage(text)
    })
    if (entryId.isNotBlank()) {
        if (message.optString("role") == "toolResult") RuntimeChip("Load media", enabled = !busy, onClick = {
            perform {
                val result = ChatRequests.media(requester, sessionId, entryId)
                media = result.getJSONArray("images")
                details = "${media?.length()} images; ${result.optInt("missingCount")} missing"
            }
        })
        if (message.optString("role") == "user") RuntimeChip("Fork here", enabled = !busy, onClick = {
            perform {
                val result = ChatRequests.command(requester, sessionId, JSONObject().put("type", "fork").put("entryId", entryId)).getJSONObject("result")
                if (result.optBoolean("cancelled")) details = "Fork cancelled"
                else onOpenSession(result.getString("newSessionId"))
            }
        })
    }
}

@Composable
private fun HistoryImage(block: JSONObject) {
    val data = block.optString("data")
    val bitmap = remember(data) {
        try {
            val bytes = android.util.Base64.decode(data, android.util.Base64.DEFAULT)
            android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        } catch (_: IllegalArgumentException) { null }
    }
    if (bitmap != null) androidx.compose.foundation.Image(bitmap.asImageBitmap(), "Message attachment", Modifier.fillMaxWidth().heightIn(max = 320.dp))
    else Text("Image data unavailable", color = OmpColors.TextMuted)
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ChatStatsHost(requester: RelayRequester, sessionId: String, open: Boolean, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var selected by remember(sessionId) { mutableStateOf<String?>(null) }
    var output by remember(sessionId) { mutableStateOf("") }
    var busy by remember(sessionId) { mutableStateOf(false) }
    Box {
        if (open) ModalBottomSheet(dragHandle = { OmpSheetDragHandle() }, onDismissRequest = onDismiss, containerColor = OmpColors.Bg, contentColor = OmpColors.Text) {
            OmpDialogSystemBars()
        Column(Modifier.fillMaxWidth().heightIn(max = 560.dp).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Session info", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            IconButton(onClick = onDismiss, modifier = Modifier.size(48.dp)) { Icon(Icons.Filled.Close, "Close", tint = OmpColors.TextMuted) }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            listOf("State", "Stats", "System prompt").forEach { name ->
                RuntimeChip(name, enabled = !busy, onClick = {
                    selected = name; busy = true
                    scope.launch {
                        try {
                            val data = when (name) {
                                "State" -> ChatRequests.sessionState(requester, sessionId)
                                "Stats" -> ChatRequests.stats(requester, sessionId)
                                else -> ChatRequests.systemPrompt(requester, sessionId)
                            }
                            output = if (name == "System prompt") {
                                if (data.isNull("systemPrompt")) "System prompt unavailable" else data.optString("systemPrompt")
                            } else data.toString(2)
                        } catch (e: Exception) { if (e is kotlinx.coroutines.CancellationException) throw e; output = e.message ?: "Request failed" }
                        finally { busy = false }
                    }
                })
            }
        }
        if (selected != null) Column(Modifier.heightIn(max = 320.dp).verticalScroll(rememberScrollState())) {
            if (busy) Text("Loading…", color = OmpColors.TextMuted)
            androidx.compose.foundation.text.selection.SelectionContainer { Text(output, color = OmpColors.Text) }
        }
        }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
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
            } catch (e: Exception) { if (e is kotlinx.coroutines.CancellationException) throw e; searchError = e.message ?: "File search failed" }
        }
    }
    Box {
        if (expanded) ModalBottomSheet(dragHandle = { OmpSheetDragHandle() }, onDismissRequest = onDismiss, containerColor = OmpColors.Bg, contentColor = OmpColors.Text) {
            OmpDialogSystemBars()
        Column(Modifier.fillMaxWidth().heightIn(max = 480.dp).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Commands & files", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                IconButton(onClick = onDismiss, modifier = Modifier.size(48.dp)) { Icon(Icons.Filled.Close, "Close", tint = OmpColors.TextMuted) }
            }
            val commands = if (draft.startsWith("/")) slashCommands.filter { it.name.contains(draft.removePrefix("/").substringBefore(' '), ignoreCase = true) } else slashCommands
            commands.forEach { command -> RuntimeChip("/${command.name}", onClick = { onInsertSlash("/${command.name} "); onDismiss() }) }
            if (commands.isEmpty()) Text("No matching slash commands", color = OmpColors.TextMuted)
        if (atQuery != null) Column(Modifier.heightIn(max = 240.dp).verticalScroll(rememberScrollState())) {
            searchError?.let { Text(it, color = OmpColors.StatusError) }
            matches.forEach { path -> RuntimeChip(path, onClick = {
                val token = if (path.any { it.isWhitespace() }) "@\"${path.replace("\"", "\\\"")}\" " else "@$path "
                onInsertSlash(draft.dropLast(atQuery.length + 1) + token)
                onDismiss()
            }) }
            if (hasMore) Text("More matches available; refine the file query.", color = OmpColors.TextMuted)
        }
        }
        }
    }
    if (!expanded && (draft.startsWith("/") || atQuery != null)) {
        Column(Modifier.fillMaxWidth().heightIn(max = 160.dp).verticalScroll(rememberScrollState()).background(OmpColors.BgPanel).padding(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (draft.startsWith("/")) {
                val commands = slashCommands.filter { it.name.contains(draft.removePrefix("/").substringBefore(' '), ignoreCase = true) }
                commands.forEach { command -> RuntimeChip("/${command.name}", onClick = { onInsertSlash("/${command.name} ") }) }
                if (commands.isEmpty()) Text("No matching slash commands", color = OmpColors.TextMuted)
            }
            if (atQuery != null) {
                searchError?.let { Text(it, color = OmpColors.StatusError) }
                matches.forEach { path -> RuntimeChip(path, onClick = {
                    val token = if (path.any { it.isWhitespace() }) "@\"${path.replace("\"", "\\\"")}\" " else "@$path "
                    onInsertSlash(draft.dropLast(atQuery.length + 1) + token)
                }) }
                if (hasMore) Text("More matches available; refine the file query.", color = OmpColors.TextMuted)
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
            RuntimeChip(label = "Approve", onClick = onApprove)
            RuntimeChip(label = "Deny", onClick = onDeny)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
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
            Text("Notices · ${informational.size}", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = OmpColors.TextMuted)
            Text(informational.last().message, modifier = Modifier.weight(1f), fontSize = 12.sp,
                color = OmpColors.TextDim, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("▸", fontSize = 13.sp, color = OmpColors.TextMuted)
        }
    }
    if (detailsOpen && informational.isNotEmpty()) {
        ModalBottomSheet(dragHandle = { OmpSheetDragHandle() }, onDismissRequest = { detailsOpen = false }, containerColor = OmpColors.Bg, contentColor = OmpColors.Text) {
            OmpDialogSystemBars()
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Extension notices · ${informational.size}", modifier = Modifier.weight(1f), fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                IconButton(onClick = { detailsOpen = false }, modifier = Modifier.size(48.dp)) { Icon(Icons.Filled.Close, "Close notices", tint = OmpColors.TextMuted) }
            }
            Column(Modifier.fillMaxWidth().heightIn(max = 480.dp).verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                informational.forEach { notice -> ExtensionNoticeRow(notice, onDismiss) }
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
            Text(
                "✕",
                fontSize = 14.sp,
                color = OmpColors.TextMuted,
                modifier = Modifier
                    .size(48.dp)
                    .semantics { contentDescription = "Dismiss notice" }
                    .clip(RoundedCornerShape(8.dp))
                    .clickable { onDismiss(notice.id) }
                    .padding(horizontal = 8.dp, vertical = 8.dp),
            )
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
    var value by remember(request) {
        mutableStateOf(
            when (request) {
                is EventProjector.ChatExtensionRequest.Editor -> request.prefill.orEmpty()
                else -> ""
            },
        )
    }
    var choice by remember(request) { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = { if (!running) onCancel() },
        containerColor = OmpColors.BgPanel,
        title = {
            OmpDialogSystemBars()
            Text(
                when (request) {
                    is EventProjector.ChatExtensionRequest.Select -> request.title
                    is EventProjector.ChatExtensionRequest.Confirm -> request.title
                    is EventProjector.ChatExtensionRequest.Input -> request.title
                    is EventProjector.ChatExtensionRequest.Editor -> request.title
                },
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
                        request.options.forEach { option ->
                            val selected = choice == option
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(if (selected) OmpColors.BgSelected else OmpColors.BgPanel)
                                    .semantics { this.selected = selected }
                                    .clickable(enabled = !running) { choice = option }.heightIn(min = 48.dp)
                                    .padding(horizontal = 12.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(option, fontSize = 14.sp, color = OmpColors.Text, modifier = Modifier.weight(1f))
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
                        "The agent is waiting for your response.",
                        fontSize = 12.sp,
                        color = OmpColors.TextMuted,
                    )
                }
            }
        },
        confirmButton = {
            Text(
                "Send",
                color = OmpColors.Accent,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .heightIn(min = 48.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .clickable(enabled = !running && (request !is EventProjector.ChatExtensionRequest.Select || choice != null)) {
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
                "Cancel",
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
