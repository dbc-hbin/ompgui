package com.dbchbin.ompgui.remote.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dbchbin.ompgui.remote.relay.RelayModelOption
import com.dbchbin.ompgui.remote.relay.RelayProject
import com.dbchbin.ompgui.remote.relay.RelayRequester
import com.dbchbin.ompgui.remote.relay.RelayWorktree
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.json.JSONArray

private val NEW_SESSION_THINKING = listOf("auto", "minimal", "low", "medium", "high", "xhigh", "max")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewSessionSheet(
    requester: RelayRequester,
    projects: List<RelayProject>,
    models: List<RelayModelOption>,
    creating: Boolean,
    initialMessage: String = "",
    worktrees: List<RelayWorktree> = emptyList(),
    worktreesGit: Boolean = false,
    onFetchWorktrees: (String) -> Unit = {},
    onAddWorktree: (String, String) -> Unit = { _, _ -> },
    onAddProject: (String) -> Unit = {},
    onDismiss: () -> Unit,
    onCreated: (String) -> Unit,
) {
    var cwd by remember { mutableStateOf(projects.firstOrNull()?.path.orEmpty()) }
    // Authoritative native defaults: null model + null thinking defers to the
    // server session default. Never force the first sorted model or "auto".
    var thinking by remember { mutableStateOf<String?>(null) }
    var provider by remember { mutableStateOf<String?>(null) }
    var modelId by remember { mutableStateOf<String?>(null) }
    var useToolsDefault by remember { mutableStateOf(true) }
    var toolNames by remember { mutableStateOf("bash, read, edit, write, grep, glob, task") }
    var pending by remember { mutableStateOf(false) }
    var createError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    var advisor by remember { mutableStateOf(false) }
    var message by remember(initialMessage) { mutableStateOf(initialMessage) }
    var showProjects by remember { mutableStateOf(false) }
    var showModels by remember { mutableStateOf(false) }
    var showThinking by remember { mutableStateOf(false) }
    var showWorktrees by remember { mutableStateOf(false) }
    var newBranch by remember { mutableStateOf("") }
    var newProjectPath by remember { mutableStateOf("") }
    var projectQuery by remember { mutableStateOf("") }

    androidx.compose.runtime.LaunchedEffect(projects) {
        if (cwd.isBlank()) cwd = projects.firstOrNull()?.path.orEmpty()
    }
    androidx.compose.runtime.LaunchedEffect(cwd) {
        if (cwd.isNotBlank()) onFetchWorktrees(cwd)
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = OmpColors.BgPanel,
        contentColor = OmpColors.Text,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("새 세션", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = OmpColors.Text)
            FieldLabel("프로젝트")
            BasicTextField(
                value = projectQuery,
                onValueChange = { projectQuery = it },
                textStyle = TextStyle(fontSize = 13.sp, color = OmpColors.Text),
                cursorBrush = SolidColor(OmpColors.Accent),
                modifier = Modifier.fillMaxWidth(),
                decorationBox = { inner ->
                    if (projectQuery.isEmpty()) Text("프로젝트 검색", color = OmpColors.TextDim, fontSize = 13.sp)
                    inner()
                },
            )
            PickerRow(
                label = projects.find { it.path == cwd }?.name ?: cwd.ifBlank { "프로젝트를 선택하세요" },
                enabled = !creating && !pending,
                onClick = { showProjects = !showProjects },
            )
            if (showProjects) {
                val visibleProjects = remember(projects, projectQuery) {
                    val q = projectQuery.trim().lowercase()
                    // Server returns registered-first MRU ordering; the picker
                    // filters without re-sorting so that order is preserved.
                    if (q.isBlank()) projects else projects.filter {
                        it.name.lowercase().contains(q) || it.path.lowercase().contains(q)
                    }
                }
                ChoiceList(
                    items = visibleProjects.map { "${it.name}\n${it.path}" },
                    selectedIndex = visibleProjects.indexOfFirst { it.path == cwd },
                    onPick = { index ->
                        if (visibleProjects.isNotEmpty()) {
                            cwd = visibleProjects[index].path
                            showProjects = false
                        }
                    },
                )
            }
            FieldLabel(if (java.util.Locale.getDefault().language == "ko") "프로젝트 추가 (절대 경로)" else "Add project (absolute path)")
            BasicTextField(
                value = newProjectPath,
                onValueChange = { newProjectPath = it },
                textStyle = TextStyle(fontSize = 13.sp, color = OmpColors.Text),
                cursorBrush = SolidColor(OmpColors.Accent),
                modifier = Modifier.fillMaxWidth(),
                decorationBox = { inner ->
                    if (newProjectPath.isEmpty()) Text("/Users/…", color = OmpColors.TextDim, fontSize = 13.sp)
                    inner()
                },
            )
            if (newProjectPath.trim().isNotBlank()) {
                Text(
                    if (java.util.Locale.getDefault().language == "ko") "프로젝트 추가" else "Add project",
                    color = OmpColors.Accent,
                    modifier = Modifier.clickable {
                        onAddProject(newProjectPath.trim())
                        cwd = newProjectPath.trim()
                        newProjectPath = ""
                    }.padding(vertical = 4.dp),
                )
            }
            if (worktreesGit && worktrees.isNotEmpty()) {
                FieldLabel("Worktree")
                val current = worktrees.find { it.path == cwd }
                PickerRow(
                    label = current?.branch ?: cwd.substringAfterLast('/'),
                    enabled = !creating && !pending,
                    onClick = { showWorktrees = !showWorktrees },
                )
                if (showWorktrees) {
                    ChoiceList(
                        items = worktrees.map { ((it.branch ?: it.path.substringAfterLast('/')) + "\n" + it.path) },
                        selectedIndex = worktrees.indexOfFirst { it.path == cwd },
                        onPick = { index ->
                            cwd = worktrees[index].path
                            showWorktrees = false
                        },
                    )
                    // Removal lives in the session list worktree manager; this
                    // picker only switches/adds so phantom entries never appear.
                    val removable = worktrees.filter { !it.isMain && it.path.isNotBlank() }
                    if (removable.isNotEmpty()) {
                        Text(
                            "제거는 세션 목록 Worktrees에서 (409 dirty 시 강제 확인)",
                            color = OmpColors.TextDim,
                            fontSize = 12.sp,
                            modifier = Modifier.padding(vertical = 4.dp),
                        )
                    }
                }
                BasicTextField(
                    value = newBranch,
                    onValueChange = { newBranch = it },
                    textStyle = TextStyle(fontSize = 13.sp, color = OmpColors.Text),
                    cursorBrush = SolidColor(OmpColors.Accent),
                    modifier = Modifier.fillMaxWidth(),
                    decorationBox = { inner ->
                        if (newBranch.isEmpty()) Text("브랜치로 worktree 추가", color = OmpColors.TextDim, fontSize = 13.sp)
                        inner()
                    },
                )
                if (newBranch.isNotBlank()) {
                    Text(
                        "worktree 추가",
                        color = OmpColors.Accent,
                        modifier = Modifier.clickable { onAddWorktree(cwd, newBranch.trim()); newBranch = "" }.padding(vertical = 4.dp),
                    )
                }
            }
            FieldLabel("모델")
            val currentModel = if (provider != null && modelId != null) {
                models.find { it.provider == provider && it.id == modelId }
            } else null
            val modelLabel = if (provider == null && modelId == null) {
                "서버 기본값 (지정 안 함)"
            } else currentModel?.name ?: "기본 모델"
            PickerRow(
                label = modelLabel,
                enabled = !creating && !pending && models.isNotEmpty(),
                onClick = { showModels = !showModels },
            )
            if (showModels) {
                ChoiceList(
                    items = listOf("서버 기본값 (지정 안 함)") + models.map { "${it.name}\n${it.provider}/${it.id}" },
                    selectedIndex = if (provider == null && modelId == null) 0 else models.indexOfFirst { it.provider == provider && it.id == modelId } + 1,
                    onPick = { index ->
                        if (index == 0) {
                            provider = null
                            modelId = null
                        } else {
                            val option = models[index - 1]
                            provider = option.provider
                            modelId = option.id
                        }
                        showModels = false
                    },
                )
            }
            FieldLabel("생각 수준")
            PickerRow(
                label = thinking ?: "서버 기본값 (지정 안 함)",
                enabled = !creating && !pending,
                onClick = { showThinking = !showThinking },
            )
            if (showThinking) {
                ChoiceList(
                    items = listOf("서버 기본값 (지정 안 함)") + NEW_SESSION_THINKING,
                    selectedIndex = if (thinking == null) 0 else NEW_SESSION_THINKING.indexOf(thinking) + 1,
                    onPick = { index ->
                        thinking = if (index == 0) null else NEW_SESSION_THINKING[index - 1]
                        showThinking = false
                    },
                )
            }
            FieldLabel("도구 (Tools)")
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                ToolToggleChip("기본 도구", useToolsDefault, !creating && !pending) { enabled ->
                    useToolsDefault = enabled
                }
                ToolToggleChip("Advisor", advisor, !creating && !pending) { advisor = it }
            }
            if (!useToolsDefault) {
                FieldLabel("Tool names (comma-separated; empty disables tools)")
                BasicTextField(value = toolNames, onValueChange = { toolNames = it },
                    textStyle = TextStyle(fontSize = 14.sp, color = OmpColors.Text),
                    modifier = Modifier.fillMaxWidth())
            }
            createError?.let { Text(it, color = OmpColors.StatusError) }
            FieldLabel("첫 메시지 (선택)")
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 72.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .border(1.dp, OmpColors.Border, RoundedCornerShape(8.dp))
                    .padding(12.dp),
            ) {
                BasicTextField(
                    value = message,
                    onValueChange = { message = it },
                    enabled = !creating && !pending,
                    textStyle = TextStyle(fontSize = 14.sp, color = OmpColors.Text),
                    cursorBrush = SolidColor(OmpColors.Accent),
                    modifier = Modifier.fillMaxWidth(),
                    decorationBox = { inner ->
                        if (message.isEmpty()) {
                            Text("첫 프롬프트를 입력하세요", color = OmpColors.TextDim, fontSize = 14.sp)
                        }
                        inner()
                    },
                )
            }
            val canCreate = cwd.isNotBlank() && !creating && !pending
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(44.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(if (canCreate) OmpColors.AccentStrong else OmpColors.BgHover)
                    .clickable(enabled = canCreate) {
                        pending = true
                        createError = null
                        scope.launch {
                            try {
                                val args = JSONObject().put("cwd", cwd).put("advisor", advisor)
                                message.trim().takeIf { it.isNotEmpty() }?.let { args.put("message", it) }
                                provider?.let { args.put("provider", it) }
                                modelId?.let { args.put("modelId", it) }
                                thinking?.let { args.put("thinkingLevel", it) }
                                if (!useToolsDefault) args.put("toolNames", JSONArray(toolNames.split(',').map { it.trim() }.filter { it.isNotEmpty() }))
                                val result = requester.request("sessions", "create", args)
                                onCreated(result.getString("sessionId"))
                            } catch (e: Exception) {
                                createError = e.message ?: "Create failed"
                            } finally { pending = false }
                        }
                    },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    if (creating || pending) "만드는 중…" else "세션 만들기",
                    color = if (canCreate) androidx.compose.ui.graphics.Color.White else OmpColors.TextDim,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}

@Composable
private fun ToolToggleChip(label: String, checked: Boolean, enabled: Boolean, onToggle: (Boolean) -> Unit) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(16.dp))
            .border(1.dp, if (checked) OmpColors.Accent else OmpColors.Border, RoundedCornerShape(16.dp))
            .background(if (checked) OmpColors.BgHover else OmpColors.BgPanel, RoundedCornerShape(16.dp))
            .clickable(enabled = enabled) { onToggle(!checked) }
            .padding(horizontal = 12.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = if (checked) "● $label" else label,
            fontSize = 13.sp,
            color = if (checked) OmpColors.Text else OmpColors.TextMuted,
            fontWeight = if (checked) FontWeight.SemiBold else FontWeight.Normal,
        )
    }
}

@Composable
private fun FieldLabel(text: String) {
    Text(text, fontSize = 12.sp, color = OmpColors.TextMuted, fontWeight = FontWeight.SemiBold)
}

@Composable
private fun PickerRow(label: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(44.dp)
            .clip(RoundedCornerShape(8.dp))
            .border(1.dp, OmpColors.Border, RoundedCornerShape(8.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(label, fontSize = 14.sp, color = OmpColors.Text, maxLines = 1)
    }
}

@Composable
private fun ChoiceList(items: List<String>, selectedIndex: Int, onPick: (Int) -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(OmpColors.Bg)
            .padding(4.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        items.forEachIndexed { index, label ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(6.dp))
                    .background(if (index == selectedIndex) OmpColors.BgHover else OmpColors.Bg)
                    .clickable { onPick(index) }
                    .padding(horizontal = 10.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    label,
                    fontSize = 13.sp,
                    color = OmpColors.Text,
                    modifier = Modifier.weight(1f),
                )
                if (index == selectedIndex) {
                    Icon(
                        Icons.Filled.Check,
                        contentDescription = null,
                        tint = OmpColors.Accent,
                    )
                }
            }
        }
    }
}
