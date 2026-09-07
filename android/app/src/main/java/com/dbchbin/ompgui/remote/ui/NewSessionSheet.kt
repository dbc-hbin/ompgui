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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.material3.TextButton
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material.icons.filled.Close
import androidx.compose.ui.text.style.TextOverflow
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dbchbin.ompgui.remote.R
import com.dbchbin.ompgui.remote.relay.RelayModelOption
import com.dbchbin.ompgui.remote.relay.RelayProject
import com.dbchbin.ompgui.remote.relay.RelayRequester
import com.dbchbin.ompgui.remote.relay.RelayWorktree
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.json.JSONArray

private val NEW_SESSION_THINKING = listOf("auto", "minimal", "low", "medium", "high", "xhigh", "max")

/** Placeholder tool list when the user opts out of server defaults. */
private val NEW_SESSION_DEFAULT_TOOL_NAMES =
    listOf("bash", "read", "edit", "write", "grep", "glob", "task").joinToString(", ")

@OptIn(ExperimentalMaterial3Api::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun NewSessionSheet(
    requester: RelayRequester,
    projects: List<RelayProject>,
    models: List<RelayModelOption>,
    creating: Boolean,
    initialMessage: String = "",
    worktrees: List<RelayWorktree> = emptyList(),
    worktreesGit: Boolean = false,
    worktreesError: String? = null,
    onFetchWorktrees: (String) -> Unit = {},
    onAddWorktree: (String, String) -> Unit = { _, _ -> },
    onAddProject: (String) -> Unit = {},
    onDismiss: () -> Unit,
    onCreated: (String) -> Unit,
    initialCwd: String? = null,
) {
    var advancedOpen by remember { mutableStateOf(false) }
    var addProjectOpen by remember { mutableStateOf(false) }
    var cwd by remember { mutableStateOf(initialCwd ?: projects.firstOrNull()?.path.orEmpty()) }
    // Authoritative native defaults: null model + null thinking defers to the
    // server session default. Never force the first sorted model or "auto".
    var thinking by remember { mutableStateOf<String?>(null) }
    var provider by remember { mutableStateOf<String?>(null) }
    var modelId by remember { mutableStateOf<String?>(null) }
    var useToolsDefault by remember { mutableStateOf(true) }
    var toolNames by remember { mutableStateOf(NEW_SESSION_DEFAULT_TOOL_NAMES) }
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
    val createFailedMessage = stringResource(R.string.new_session_create_failed)
    val serverDefaultLabel = stringResource(R.string.new_session_server_default)
    val selectProjectLabel = stringResource(R.string.new_session_select_project)
    val defaultModelLabel = stringResource(R.string.new_session_default_model)

    androidx.compose.runtime.LaunchedEffect(projects) {
        if (cwd.isBlank()) cwd = projects.firstOrNull()?.path.orEmpty()
    }
    androidx.compose.runtime.LaunchedEffect(cwd) {
        if (cwd.isNotBlank()) onFetchWorktrees(cwd)
    }

    OmpModalSheet(
        onDismissRequest = onDismiss,
        containerColor = OmpColors.Bg,
        contentColor = OmpColors.Text,
    ) {
        OmpDialogSystemBars()
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.new_session), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                IconButton(onClick = onDismiss) { Icon(Icons.Filled.Close, stringResource(R.string.new_session_close)) }
            }
            Column(Modifier.fillMaxWidth().weight(1f, fill = false).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            PickerRow(
                fieldLabel = stringResource(R.string.new_session_project),
                label = projects.find { it.path == cwd }?.name ?: cwd.ifBlank { selectProjectLabel },
                enabled = !creating && !pending,
                onClick = { showProjects = !showProjects },
                expanded = showProjects,
                onDismiss = { showProjects = false },
                trailingAction = {
                    IconButton(onClick = { addProjectOpen = !addProjectOpen }, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Filled.Add, stringResource(R.string.new_session_add_project), tint = OmpColors.Accent)
                    }
                },
            ) {
            BasicTextField(
                value = projectQuery,
                onValueChange = { projectQuery = it },
                textStyle = TextStyle(fontSize = 13.sp, color = OmpColors.Text),
                cursorBrush = SolidColor(OmpColors.Accent),
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).border(1.dp, OmpColors.Border, RoundedCornerShape(8.dp)).padding(12.dp),
                decorationBox = { inner ->
                    if (projectQuery.isEmpty()) Text(stringResource(R.string.new_session_search_projects), color = OmpColors.TextDim, fontSize = 13.sp)
                    inner()
                },
            )

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
            if (addProjectOpen) {
            FieldLabel(stringResource(R.string.new_session_add_project_path))
            BasicTextField(
                value = newProjectPath,
                onValueChange = { newProjectPath = it },
                textStyle = TextStyle(fontSize = 13.sp, color = OmpColors.Text),
                cursorBrush = SolidColor(OmpColors.Accent),
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).border(1.dp, OmpColors.Border, RoundedCornerShape(8.dp)).padding(12.dp),
                decorationBox = { inner ->
                    if (newProjectPath.isEmpty()) Text("/Users/…", color = OmpColors.TextDim, fontSize = 13.sp)
                    inner()
                },
            )
            if (newProjectPath.trim().isNotBlank()) {
                TextButton(
                    enabled = !creating && !pending,
                    onClick = {
                        onAddProject(newProjectPath.trim())
                        cwd = newProjectPath.trim()
                        newProjectPath = ""
                        addProjectOpen = false
                    },
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text(stringResource(R.string.new_session_add_project)) }
            }
            }
            if (worktreesGit && worktrees.isNotEmpty()) {
                val current = worktrees.find { it.path == cwd }
                PickerRow(
                    fieldLabel = stringResource(R.string.new_session_worktree),
                    label = current?.branch ?: cwd.substringAfterLast('/'),
                    enabled = !creating && !pending,
                    onClick = { showWorktrees = !showWorktrees },
                    expanded = showWorktrees,
                    onDismiss = { showWorktrees = false },
                ) {
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
                            stringResource(R.string.new_session_worktree_remove_hint),
                            color = OmpColors.TextDim,
                            fontSize = 12.sp,
                            modifier = Modifier.padding(vertical = 4.dp),
                        )
                    }
                OutlinedTextField(
                    value = newBranch,
                    onValueChange = { newBranch = it },
                    enabled = !creating && !pending,
                    singleLine = true,
                    label = { Text(stringResource(R.string.new_session_new_worktree_branch)) },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(8.dp),
                )
                if (newBranch.isNotBlank()) {
                    TextButton(
                        enabled = !creating && !pending,
                        onClick = { onAddWorktree(cwd, newBranch.trim()); newBranch = "" },
                        modifier = Modifier.heightIn(min = 48.dp),
                    ) { Text(stringResource(R.string.new_session_add_worktree)) }
                }
            }
            }
            worktreesError?.takeIf { it.isNotBlank() }?.let {
                Text(it, color = OmpColors.StatusError, fontSize = 13.sp)
            }
            val currentModel = if (provider != null && modelId != null) {
                models.find { it.provider == provider && it.id == modelId }
            } else null
            val modelLabel = if (provider == null && modelId == null) {
                serverDefaultLabel
            } else currentModel?.name ?: defaultModelLabel
            PickerRow(
                fieldLabel = stringResource(R.string.chat_model),
                label = modelLabel,
                enabled = !creating && !pending && models.isNotEmpty(),
                onClick = { showModels = !showModels },
                expanded = showModels,
                onDismiss = { showModels = false },
            ) {
                var modelQuery by remember(showModels) { mutableStateOf("") }
                ModelSearchField(modelQuery, { modelQuery = it })
                val visibleModels = remember(models, modelQuery) {
                    val q = modelQuery.trim()
                    models.filter { q.isEmpty() || it.name.contains(q, ignoreCase = true) || it.id.contains(q, ignoreCase = true) || it.provider.contains(q, ignoreCase = true) }
                }
                if (visibleModels.isEmpty()) {
                    Text(stringResource(R.string.chat_model_no_matches), color = OmpColors.TextMuted)
                }
                ChoiceList(
                    items = listOf(serverDefaultLabel) + visibleModels.map { "${it.name}\n${it.provider}/${it.id}" },
                    selectedIndex = if (provider == null && modelId == null) 0 else visibleModels.indexOfFirst { it.provider == provider && it.id == modelId }.let { if (it < 0) -1 else it + 1 },
                    onPick = { index ->
                        if (index == 0) {
                            provider = null
                            modelId = null
                        } else {
                            val option = visibleModels[index - 1]
                            provider = option.provider
                            modelId = option.id
                        }
                        showModels = false
                    },
                )
            }
            TextButton(onClick = { advancedOpen = !advancedOpen }) {
                Text(
                    stringResource(
                        if (advancedOpen) R.string.new_session_hide_advanced
                        else R.string.new_session_advanced_options,
                    ),
                )
            }
            if (advancedOpen) {
            PickerRow(
                fieldLabel = stringResource(R.string.new_session_thinking_level),
                label = thinking ?: serverDefaultLabel,
                enabled = !creating && !pending,
                onClick = { showThinking = !showThinking },
                expanded = showThinking,
                onDismiss = { showThinking = false },
            ) {
                ChoiceList(
                    items = listOf(serverDefaultLabel) + NEW_SESSION_THINKING,
                    selectedIndex = if (thinking == null) 0 else NEW_SESSION_THINKING.indexOf(thinking) + 1,
                    onPick = { index ->
                        thinking = if (index == 0) null else NEW_SESSION_THINKING[index - 1]
                        showThinking = false
                    },
                )
            }
            FieldLabel(stringResource(R.string.new_session_tools))
            androidx.compose.foundation.layout.FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                ToolToggleChip(stringResource(R.string.new_session_default_tools), useToolsDefault, !creating && !pending) { enabled ->
                    useToolsDefault = enabled
                }
                ToolToggleChip(stringResource(R.string.new_session_advisor), advisor, !creating && !pending) { advisor = it }
            }
            if (!useToolsDefault) {
                FieldLabel(stringResource(R.string.new_session_tool_names_hint))
                OutlinedTextField(value = toolNames, onValueChange = { toolNames = it },
                    enabled = !creating && !pending,
                    label = { Text(stringResource(R.string.new_session_tool_names)) },
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth())
            }
            }
            createError?.let { Text(it, color = OmpColors.StatusError) }
            FieldLabel(stringResource(R.string.new_session_first_message))
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
                            Text(stringResource(R.string.new_session_first_prompt_placeholder), color = OmpColors.TextDim, fontSize = 14.sp)
                        }
                        inner()
                    },
                )
            }
            }
            androidx.compose.material3.HorizontalDivider(color = OmpColors.Border, modifier = Modifier.padding(top = 8.dp))
            val canCreate = cwd.isNotBlank() && !creating && !pending
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(if (canCreate) OmpColors.AccentStrong else OmpColors.BgHover)
                    .clickable(enabled = canCreate, role = androidx.compose.ui.semantics.Role.Button) {
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
                                if (e is kotlinx.coroutines.CancellationException) throw e
                                createError = e.message ?: createFailedMessage
                            } finally { pending = false }
                        }
                    },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    stringResource(
                        if (creating || pending) R.string.new_session_creating
                        else R.string.new_session_create,
                    ),
                    color = if (canCreate) androidx.compose.ui.graphics.Color.White else OmpColors.TextDim,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                )
            }
        }
    }
}

@Composable
private fun ToolToggleChip(label: String, checked: Boolean, enabled: Boolean, onToggle: (Boolean) -> Unit) {
    Box(
        modifier = Modifier
            .heightIn(min = 48.dp)
            .clip(RoundedCornerShape(8.dp))
            .border(1.dp, if (checked) OmpColors.Accent else OmpColors.Border, RoundedCornerShape(8.dp))
            .background(if (checked) OmpColors.BgHover else OmpColors.BgPanel, RoundedCornerShape(8.dp))
            .toggleable(value = checked, enabled = enabled, role = androidx.compose.ui.semantics.Role.Checkbox, onValueChange = onToggle)
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
private fun PickerRow(
    fieldLabel: String,
    label: String,
    enabled: Boolean,
    onClick: () -> Unit,
    expanded: Boolean,
    onDismiss: () -> Unit,
    trailingAction: (@Composable () -> Unit)? = null,
    menuContent: @Composable () -> Unit,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(fieldLabel, fontSize = 12.sp, color = OmpColors.TextMuted, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.weight(0.3f))
        Row(Modifier.weight(0.7f), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .clickable(enabled = enabled, role = androidx.compose.ui.semantics.Role.Button, onClick = onClick)
                        .padding(horizontal = 8.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(label, fontSize = 14.sp, color = if (enabled) OmpColors.Text else OmpColors.TextDim,
                        maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Icon(Icons.Filled.ExpandMore, contentDescription = null, tint = OmpColors.TextMuted)
                }
                DropdownMenu(
                    expanded = expanded,
                    onDismissRequest = onDismiss,
                    modifier = Modifier.widthIn(min = 240.dp, max = 320.dp).heightIn(max = 360.dp),
                ) {
                    Column(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        menuContent()
                    }
                }
            }
            trailingAction?.invoke()
        }
    }
}

@Composable
private fun ChoiceList(items: List<String>, selectedIndex: Int, onPick: (Int) -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(max = 192.dp)
            .verticalScroll(rememberScrollState())
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
                    .selectable(selected = index == selectedIndex, role = androidx.compose.ui.semantics.Role.RadioButton, onClick = { onPick(index) })
                    .heightIn(min = 48.dp)
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
