package com.dbchbin.ompgui.remote.ui

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
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(6.dp))
                .clickable { expanded = !expanded }
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
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(6.dp))
                .clickable { expanded = !expanded }
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
                            .size(48.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(OmpColors.BgHover)
                            .border(1.dp, OmpColors.Border, RoundedCornerShape(8.dp))
                            .padding(horizontal = 6.dp, vertical = 6.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            chip.status.take(8),
                            fontSize = 10.sp,
                            color = if (chip.status == "started" || chip.status == "running") {
                                OmpColors.Accent
                            } else {
                                OmpColors.TextMuted
                            },
                            maxLines = 1,
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
            Text(
                subagent.agent.ifBlank { subagent.id },
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                color = OmpColors.Text,
            )
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
                Text(completion!!, fontSize = 13.sp, color = OmpColors.Text, lineHeight = 19.sp)
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
                        }
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
                            .clickable { loadPage() }
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
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
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
            .height(48.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(if (enabled) OmpColors.BgHover else OmpColors.BgPanel)
            .border(1.dp, OmpColors.Border, RoundedCornerShape(8.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, fontSize = 13.sp, color = if (enabled) OmpColors.Text else OmpColors.TextDim)
    }
}


// ---------------------------------------------------------------------------
// Runtime controls: modes, bash, handoff, reload, compact, fork, export.
// ---------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
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
) {
    var expanded by remember { mutableStateOf(false) }
    var bashDraft by remember { mutableStateOf("") }
    var compactDraft by remember { mutableStateOf("") }
    var bashError by remember { mutableStateOf<String?>(null) }
    val korean = remember { Locale.getDefault().language == "ko" }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(panelShape())
            .background(OmpColors.BgPanel)
            .border(1.dp, OmpColors.Border, panelShape())
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(6.dp))
                .clickable { expanded = !expanded }
                .padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                if (korean) "런타임" else "Runtime",
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = OmpColors.Text,
                modifier = Modifier.weight(1f),
            )
            Text(if (expanded) "▾" else "▸", fontSize = 13.sp, color = OmpColors.TextMuted)
        }
        if (!expanded) return
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            RuntimeChip(
                label = when (fastMode) {
                    true -> "Fast: on"
                    false -> "Fast: off"
                    null -> "Fast: —"
                },
                enabled = fastMode != null,
                onClick = { if (fastMode != null) onFastModeChange(!fastMode) },
            )
            RuntimeChip(
                label = when (autoRetry) {
                    true -> "Retry: on"
                    false -> "Retry: off"
                    null -> "Retry: —"
                },
                enabled = autoRetry != null,
                onClick = { if (autoRetry != null) onAutoRetryChange(!autoRetry) },
            )
            RuntimeChip(
                label = "Interrupt: ${interruptMode ?: "—"}",
                enabled = interruptMode != null,
                onClick = {
                    onInterruptModeChange(if (interruptMode == "immediate") "wait" else "immediate")
                },
            )
            RuntimeChip(
                label = when (autoCompaction) {
                    true -> "Auto-compact: on"
                    false -> "Auto-compact: off"
                    null -> "Auto-compact: —"
                },
                enabled = autoCompaction != null,
                onClick = { if (autoCompaction != null) onAutoCompactionChange(!autoCompaction) },
            )
            RuntimeChip(
                label = "Steer: ${steeringMode ?: "—"}",
                enabled = steeringMode != null,
                onClick = {
                    onSteeringModeChange(if (steeringMode == "one-at-a-time") "all" else "one-at-a-time")
                },
            )
            RuntimeChip(
                label = "Follow-up: ${followUpMode ?: "—"}",
                enabled = followUpMode != null,
                onClick = {
                    onFollowUpModeChange(if (followUpMode == "one-at-a-time") "all" else "one-at-a-time")
                },
            )
            RuntimeChip(label = if (korean) "모델 순환" else "Cycle model", onClick = onCycleModel)
            RuntimeChip(label = if (korean) "핸드오프" else "Handoff", onClick = onHandoff)
            RuntimeChip(label = if (korean) "리로드" else "Reload", onClick = onReload)
            RuntimeChip(label = if (korean) "재시도 중단" else "Abort retry", onClick = onRetryAbort)
            RuntimeChip(label = if (korean) "bash 중단" else "Abort bash", onClick = onAbortBash)
            RuntimeChip(label = if (korean) "압축" else "Compact", onClick = onCompact)
            RuntimeChip(label = if (korean) "마지막 복사" else "Copy last", onClick = onCopyLast)
            RuntimeChip(label = if (korean) "내보내기" else "Export", onClick = onExport)
            RuntimeChip(label = if (korean) "명령 팔레트" else "Palette", onClick = onOpenPalette)
            if (running) RuntimeChip(label = if (korean) "중단" else "Abort", onClick = onAbort)
        }
        Spacer(modifier = Modifier.height(8.dp))
        // Actual supported bash command (single `!` shares output; `!!` is
        // rejected server-side with bash_exclude_unsupported — surfaced, never faked).
        BasicTextField(
            value = bashDraft,
            onValueChange = {
                bashDraft = it
                bashError = null
            },
            modifier = Modifier.fillMaxWidth(),
            textStyle = TextStyle(fontSize = 13.sp, color = OmpColors.Text, fontFamily = FontFamily.Monospace),
            cursorBrush = SolidColor(OmpColors.Accent),
            maxLines = 3,
            decorationBox = { inner ->
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(OmpColors.Bg, RoundedCornerShape(8.dp))
                        .border(1.dp, OmpColors.Border, RoundedCornerShape(8.dp))
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                ) {
                    if (bashDraft.isEmpty()) {
                        Text("!shell command (single ! only)", fontSize = 13.sp, color = OmpColors.TextDim)
                    }
                    inner()
                }
            },
        )
        if (bashDraft.startsWith("!!")) {
            Text(
                if (korean) {
                    "!! 제외 실행은 지원되지 않습니다. 서버 오류가 표시됩니다."
                } else {
                    "!! excluded output is unsupported and fails server-side."
                },
                fontSize = 12.sp,
                color = OmpColors.StatusWarning,
            )
        }
        if (!bashError.isNullOrBlank()) {
            Text(bashError!!, fontSize = 12.sp, color = OmpColors.StatusError)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            RuntimeChip(
                label = if (korean) "실행" else "Run",
                onClick = {
                    val cmd = bashDraft.trim().removePrefix("!").trim()
                    if (cmd.isEmpty()) {
                        bashError = if (korean) "명령을 입력하세요" else "Enter a command"
                        return@RuntimeChip
                    }
                    if (bashDraft.trimStart().startsWith("!!")) {
                        // Still send so the server's coded error is the
                        // authority; the local warning above is a hint only.
                    }
                    bashError = null
                    onBash(bashDraft.trim())
                    bashDraft = ""
                },
            )
        }
        Spacer(modifier = Modifier.height(8.dp))
        BasicTextField(
            value = compactDraft,
            onValueChange = { compactDraft = it },
            modifier = Modifier.fillMaxWidth(),
            textStyle = TextStyle(fontSize = 13.sp, color = OmpColors.Text),
            cursorBrush = SolidColor(OmpColors.Accent),
            maxLines = 3,
            decorationBox = { inner ->
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(OmpColors.Bg, RoundedCornerShape(8.dp))
                        .border(1.dp, OmpColors.Border, RoundedCornerShape(8.dp))
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                ) {
                    if (compactDraft.isEmpty()) {
                        Text(
                            if (korean) "압축 지시 (선택)" else "Custom compact instructions (optional)",
                            fontSize = 13.sp,
                            color = OmpColors.TextDim,
                        )
                    }
                    inner()
                }
            },
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            RuntimeChip(
                label = if (korean) "지시 포함 압축" else "Compact with instructions",
                onClick = {
                    onCustomCompact(compactDraft.trim())
                    compactDraft = ""
                },
            )
        }
    }
}

@Composable
private fun RuntimeChip(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .height(48.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(OmpColors.BgHover)
            .border(1.dp, OmpColors.Border, RoundedCornerShape(8.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, fontSize = 12.sp, color = if (enabled) OmpColors.Text else OmpColors.TextDim, maxLines = 1)
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
        MarkdownText(
            text = if (expanded) message.text else preview,
            modifier = if (expanded) Modifier.fillMaxWidth().heightIn(max = 420.dp).verticalScroll(rememberScrollState()) else Modifier.fillMaxWidth(),
        )
        if (!expanded) {
            Text(
                "Show full (${message.text.length} chars)",
                fontSize = 12.sp,
                color = OmpColors.Accent,
                modifier = Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .clickable { expanded = true }
                    .padding(horizontal = 8.dp, vertical = 8.dp),
            )
        } else {
            Text(
                "Show less",
                fontSize = 12.sp,
                color = OmpColors.TextMuted,
                modifier = Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .clickable { expanded = false }
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
fun ChatHistoryHost(requester: RelayRequester, sessionId: String, leafId: String?, onOpenSession: (String) -> Unit, onEditMessage: (String) -> Unit) {
    androidx.compose.runtime.key(sessionId, leafId) {
        ChatHistoryContent(requester, sessionId, leafId, onOpenSession, onEditMessage)
    }
}

@Composable
private fun ChatHistoryContent(requester: RelayRequester, sessionId: String, leafId: String?, onOpenSession: (String) -> Unit, onEditMessage: (String) -> Unit) {
    var expanded by remember(sessionId) { mutableStateOf(false) }
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
    Column(Modifier.fillMaxWidth()) {
        RuntimeChip("History", onClick = { expanded = !expanded; if (expanded && page == null) load(0) })
        if (expanded) Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
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
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    RuntimeChip("Previous", enabled = !busy && current.offset > 0, onClick = { load((current.offset - 25).coerceAtLeast(0)) })
                    RuntimeChip("Next", enabled = !busy && current.hasMore, onClick = { load(current.offset + current.messages.length()) })
                }
            }
            RuntimeChip("Refresh", enabled = !busy, onClick = { load(page?.offset ?: 0) })
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
    Text(message.optString("role"), color = OmpColors.Accent)
    val content = message.opt("content")
    if (content is org.json.JSONArray) {
        for (index in 0 until content.length()) {
            val block = content.optJSONObject(index) ?: continue
            when (block.optString("type")) {
                "text" -> MarkdownText(block.optString("text"), Modifier.fillMaxWidth())
                "thinking" -> RuntimeChip("Load thinking ${index + 1}", enabled = !busy && entryId.isNotBlank(), onClick = {
                    perform { details = ChatRequests.thinking(requester, sessionId, entryId, index).getString("thinking") }
                })
                "image" -> HistoryImage(block)
                else -> Text(block.toString(2), color = OmpColors.Text)
            }
        }
    } else Text(content?.toString().orEmpty(), color = OmpColors.Text)
    details?.let { Text(it, color = OmpColors.Text) }
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

@Composable
fun ChatStatsHost(requester: RelayRequester, sessionId: String) {
    val scope = rememberCoroutineScope()
    var selected by remember(sessionId) { mutableStateOf<String?>(null) }
    var output by remember(sessionId) { mutableStateOf("") }
    var busy by remember(sessionId) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth()) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
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
            RuntimeChip("Close", onClick = { selected = null })
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
) {
    var expanded by remember(sessionCwd) { mutableStateOf(false) }
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
    Column(Modifier.fillMaxWidth()) {
        RuntimeChip("Slash commands (${slashCommands.size})", onClick = { expanded = !expanded })
        if (expanded || draft.startsWith("/")) Column(Modifier.heightIn(max = 240.dp).verticalScroll(rememberScrollState())) {
            val commands = if (draft.startsWith("/")) slashCommands.filter { it.name.contains(draft.removePrefix("/").substringBefore(' '), ignoreCase = true) } else slashCommands
            commands.forEach { command -> RuntimeChip("/${command.name}", onClick = { onInsertSlash("/${command.name} "); expanded = false }) }
            if (commands.isEmpty()) Text("No matching slash commands", color = OmpColors.TextMuted)
        }
        if (atQuery != null) Column(Modifier.heightIn(max = 240.dp).verticalScroll(rememberScrollState())) {
            searchError?.let { Text(it, color = OmpColors.StatusError) }
            matches.forEach { path -> RuntimeChip(path, onClick = {
                val token = if (path.any { it.isWhitespace() }) "@\"${path.replace("\"", "\\\"")}\" " else "@$path "
                onInsertSlash(draft.dropLast(atQuery.length + 1) + token)
            }) }
            if (hasMore) Text("More matches available; refine the file query.", color = OmpColors.TextMuted)
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
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            RuntimeChip(label = "Approve", onClick = onApprove)
            RuntimeChip(label = "Deny", onClick = onDeny)
        }
    }
}

@Composable
fun ExtensionNoticeList(notices: List<EventProjector.ChatNotice>, onDismiss: (String) -> Unit) {
    notices.forEach { notice ->
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
                    .clip(RoundedCornerShape(8.dp))
                    .clickable { onDismiss(notice.id) }
                    .padding(horizontal = 8.dp, vertical = 8.dp),
            )
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
            Text(
                when (request) {
                    is EventProjector.ChatExtensionRequest.Select -> request.title
                    is EventProjector.ChatExtensionRequest.Confirm -> request.title
                    is EventProjector.ChatExtensionRequest.Input -> request.title
                    is EventProjector.ChatExtensionRequest.Editor -> request.title
                },
                color = OmpColors.Text,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
            )
        },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
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
                                    .background(if (selected) OmpColors.BgHover else OmpColors.BgPanel)
                                    .clickable { choice = option }
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
                    .clip(RoundedCornerShape(6.dp))
                    .clickable(enabled = !running) { onCancel() }
                    .padding(horizontal = 12.dp, vertical = 8.dp),
            )
        },
    )
}
