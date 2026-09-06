@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package com.dbchbin.ompgui.remote.ui

import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.FilterChip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.window.DialogProperties
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import com.dbchbin.ompgui.remote.R
import androidx.compose.ui.unit.dp
import com.dbchbin.ompgui.remote.relay.RelayRequestException
import com.dbchbin.ompgui.remote.relay.RelayRequester
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

@Composable
fun ExtensionAgentsSection(requester: RelayRequester, cwd: String) {
    key(requester, cwd) { AgentsInventory(requester, cwd) }
}

@Composable
private fun AgentsInventory(requester: RelayRequester, cwd: String) {
    val context = LocalContext.current
    var query by rememberSaveable { mutableStateOf("") }
    var source by rememberSaveable { mutableStateOf("all") }
    var appliedQuery by rememberSaveable { mutableStateOf("") }
    var appliedSource by rememberSaveable { mutableStateOf("all") }
    var offset by rememberSaveable { mutableStateOf(0) }
    var revision by remember { mutableStateOf(0) }
    var rows by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var total by remember { mutableStateOf(0) }
    var hasMore by remember { mutableStateOf(false) }
    var pageLimit by remember { mutableStateOf(25) }
    var loading by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var editor by remember { mutableStateOf<JSONObject?>(null) }
    var unpack by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(offset, appliedQuery, appliedSource, revision) {
        loading = true
        error = null
        try {
            val args = JSONObject().put("cwd", cwd).put("offset", offset).put("limit", 25)
                .put("query", appliedQuery)
            if (appliedSource != "all") args.put("scope", appliedSource)
            val result = requester.request("extensions", "agents.list", args)
            val agents = result.getJSONArray("agents")
            rows = List(agents.length()) { agents.getJSONObject(it) }
            total = result.getInt("total")
            pageLimit = result.getInt("limit")
            hasMore = result.getBoolean("hasMore")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = context.getString(R.string.extension_agents_load_failed, relayErrorDetail(e, context.getString(R.string.extension_request_failed)))
        } finally {
            loading = false
        }
    }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.extension_agents_title), color = OmpColors.Text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            Button(onClick = { editor = JSONObject() }, enabled = !busy, shape = MaterialTheme.shapes.small) { Text(stringResource(R.string.extension_agents_create_agent)) }
        }
        AgentTextField(stringResource(R.string.extension_agents_search_label), query, { query = it }, enabled = !busy)
        AgentChoice(stringResource(R.string.extension_agents_inventory_source), source, listOf("all", "user", "project", "bundled", "extension"), !busy) { source = it }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = {
                appliedQuery = query.trim()
                appliedSource = source
                offset = 0
                revision++
            }, enabled = !loading && !busy) { Text(stringResource(R.string.extension_agents_search_refresh)) }
            TextButton(onClick = { unpack = true }, enabled = !busy) { Text(stringResource(R.string.extension_agents_unpack_bundled)) }
        }
        if (loading) Text(stringResource(R.string.extension_agents_loading), color = OmpColors.TextMuted)
        error?.let { Text(it, color = OmpColors.StatusError) }
        notice?.let { Text(it, color = OmpColors.TextMuted) }
        if (!loading && error == null && rows.isEmpty()) Text(stringResource(R.string.extension_agents_no_matches), color = OmpColors.TextMuted)
        if (!loading && error == null) rows.forEach { row ->
            Column(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(row.getString("name"), color = OmpColors.Text, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(row.getString("description"), color = OmpColors.TextMuted, style = MaterialTheme.typography.bodySmall, maxLines = 3, overflow = TextOverflow.Ellipsis)
                Text(row.getString("source") + if (row.optBoolean("disabled")) stringResource(R.string.extension_agents_disabled_suffix) else stringResource(R.string.extension_agents_enabled_suffix), color = OmpColors.TextMuted, style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = {
                    busy = true
                    error = null
                    scope.launch {
                        try {
                            val args = JSONObject().put("cwd", cwd).put("name", row.getString("name"))
                            val rowSource = row.getString("source")
                            if (rowSource == "user" || rowSource == "project") args.put("scope", rowSource)
                            editor = requester.request("extensions", "agents.get", args)
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            error = context.getString(R.string.extension_agents_open_failed, relayErrorDetail(e, context.getString(R.string.extension_request_failed)))
                        } finally { busy = false }
                    }
                }, enabled = !busy, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.extension_view_edit)) }
                HorizontalDivider(color = OmpColors.Border)
            }
        }
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(if (total == 0) stringResource(R.string.extension_agents_count_zero) else stringResource(R.string.extension_agents_count_range, offset + 1, minOf(offset + rows.size, total), total), color = OmpColors.TextMuted, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
            TextButton(onClick = { offset = maxOf(0, offset - pageLimit) }, enabled = offset > 0 && !loading && !busy) { Text(stringResource(R.string.extension_previous)) }
            TextButton(onClick = { offset += pageLimit }, enabled = hasMore && !loading && !busy && error == null) { Text(stringResource(R.string.extension_next)) }
        }
    }
    editor?.let { initial ->
        key(initial) {
            AgentEditor(requester, cwd, initial, onClose = { editor = null }, onChanged = { offset = 0; revision++ }, onCopy = {
                editor = JSONObject(initial.toString()).put("name", "").put("source", "").removeAgentIdentity()
            })
        }
    }
    if (unpack) AgentUnpackDialog(requester, cwd, onClose = { unpack = false }, onSuccess = {
        notice = it
        revision++
        unpack = false
    })
}

private fun JSONObject.removeAgentIdentity(): JSONObject {
    remove("filePath")
    remove("disabled")
    remove("overrideModel")
    remove("prewalkOverride")
    remove("advisorOverride")
    remove("isShadowed")
    return this
}

@Composable
private fun AgentEditor(
    requester: RelayRequester,
    cwd: String,
    initial: JSONObject,
    onClose: () -> Unit,
    onChanged: () -> Unit,
    onCopy: () -> Unit,
) {
    val context = LocalContext.current
    val existing = initial.optString("name").isNotBlank()
    val source = initial.optString("source")
    val writable = !existing || source == "user" || source == "project"
    var name by remember { mutableStateOf(initial.optString("name")) }
    var description by remember { mutableStateOf(initial.optString("description")) }
    var prompt by remember { mutableStateOf(initial.optString("systemPrompt")) }
    var saveScope by remember { mutableStateOf(if (source == "project") "project" else "user") }
    var tools by remember { mutableStateOf(agentListText(initial.opt("tools"))) }
    var customTools by remember { mutableStateOf(initial.has("tools")) }
    var model by remember { mutableStateOf(agentListText(initial.opt("model"))) }
    var thinking by remember { mutableStateOf(initial.optString("thinkingLevel")) }
    var prewalk by remember { mutableStateOf(agentSettingMode(initial.opt("prewalk"))) }
    var prewalkText by remember { mutableStateOf(initial.opt("prewalk") as? String ?: "") }
    var advisor by remember { mutableStateOf(agentSettingMode(initial.opt("advisor"))) }
    var advisorText by remember { mutableStateOf(initial.opt("advisor") as? String ?: "") }
    var blocking by remember { mutableStateOf(agentSettingMode(initial.opt("blocking"))) }
    var disabled by remember { mutableStateOf(initial.optBoolean("disabled")) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var deleting by remember { mutableStateOf(false) }
    var runtimeSettings by remember { mutableStateOf(false) }
    val overrideState = rememberSaveableStateHolder()
    var advanced by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun mutate(action: String, args: JSONObject, close: Boolean = false) {
        busy = true
        error = null
        notice = null
        scope.launch {
            try {
                requester.request("extensions", action, args)
                onChanged()
                if (close) onClose() else notice = context.getString(R.string.extension_agents_changes_saved)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = context.getString(R.string.extension_agents_action_failed, action, relayErrorDetail(e, context.getString(R.string.extension_request_failed)))
            } finally { busy = false }
        }
    }

    AlertDialog(
        onDismissRequest = { if (!busy) onClose() },
        containerColor = OmpColors.BgPanel,
        modifier = Modifier.fillMaxWidth().padding(12.dp),
        properties = DialogProperties(usePlatformDefaultWidth = false),
        title = { OmpDialogSystemBars(); Text(if (!existing) stringResource(R.string.extension_agents_create_agent) else name, color = OmpColors.Text, maxLines = 2, overflow = TextOverflow.Ellipsis) },
        text = {
            Column(Modifier.fillMaxWidth().heightIn(max = 560.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (existing) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(selected = !runtimeSettings, onClick = { runtimeSettings = false }, label = { Text(stringResource(R.string.extension_agents_definition)) })
                        FilterChip(selected = runtimeSettings, onClick = { runtimeSettings = true }, label = { Text(stringResource(R.string.extension_agents_overrides_actions)) })
                    }
                    Text(stringResource(R.string.extension_agents_source, source), color = OmpColors.TextMuted)
                    initial.optString("filePath").takeIf { it.isNotBlank() }?.let { Text(it, color = OmpColors.TextMuted) }
                    if (!writable) Text(stringResource(R.string.extension_agents_readonly), color = OmpColors.TextMuted)
                }
                if (!runtimeSettings) {
                AgentTextField(stringResource(R.string.extension_agents_name_label), name, { name = it }, !busy && !existing)
                AgentChoice(stringResource(R.string.extension_agents_save_scope), saveScope, listOf("user", "project"), !busy && !existing) { saveScope = it }
                AgentTextField(stringResource(R.string.extension_agents_description), description, { description = it }, !busy && writable, multiline = true, codeStyle = false)
                HorizontalDivider(color = OmpColors.Border)
                Text(stringResource(R.string.extension_agents_instructions), style = MaterialTheme.typography.titleSmall, color = OmpColors.Text)
                AgentTextField(stringResource(R.string.extension_agents_system_prompt), prompt, { prompt = it }, !busy && writable, multiline = true, minLines = 8)
                TextButton(onClick = { advanced = !advanced }, modifier = Modifier.heightIn(min = 48.dp)) { Text(if (advanced) stringResource(R.string.extension_agents_hide_advanced) else stringResource(R.string.extension_agents_show_advanced)) }
                if (advanced) {
                Text(if (existing) stringResource(R.string.extension_agents_advanced_hint_existing) else stringResource(R.string.extension_agents_advanced_hint_new), color = OmpColors.TextMuted)
                Text(stringResource(R.string.extension_agents_tools_model), style = MaterialTheme.typography.titleSmall, color = OmpColors.Text)
                AgentToggle(stringResource(R.string.extension_agents_specify_tools), customTools, !busy && writable) { customTools = it }
                if (customTools) AgentTextField(stringResource(R.string.extension_agents_tools_lines), tools, { tools = it }, !busy && writable, multiline = true)
                AgentTextField(stringResource(R.string.extension_agents_model_selectors), model, { model = it }, !busy && writable, multiline = true)
                AgentTextField(stringResource(R.string.extension_agents_thinking_optional), thinking, { thinking = it }, !busy && writable)
                HorizontalDivider(color = OmpColors.Border)
                Text(stringResource(R.string.extension_agents_execution), style = MaterialTheme.typography.titleSmall, color = OmpColors.Text)
                AgentBooleanString(stringResource(R.string.extension_agents_prewalk), prewalk, { prewalk = it }, prewalkText, { prewalkText = it }, !busy && writable)
                AgentBooleanString(stringResource(R.string.extension_agents_advisor), advisor, { advisor = it }, advisorText, { advisorText = it }, !busy && writable)
                AgentChoice(stringResource(R.string.extension_agents_blocking), blocking, listOf("inherit", "enabled", "disabled"), !busy && writable) { blocking = it }
                }
                }
                if (existing && runtimeSettings) {
                    HorizontalDivider(color = OmpColors.Border)
                    Text(stringResource(R.string.extension_agents_global_settings), color = OmpColors.Text)
                    AgentToggle(stringResource(R.string.extension_agents_disabled), disabled, !busy) { disabled = it }
                    OutlinedButton(onClick = { mutate("agents.setDisabled", JSONObject().put("name", name).put("disabled", disabled)) }, enabled = !busy, shape = MaterialTheme.shapes.small) { Text(stringResource(R.string.extension_agents_save_disabled)) }
                    overrideState.SaveableStateProvider("overrides") {
                        AgentOverrides(initial, !busy) { kind, value ->
                            mutate("agents.setOverride", JSONObject().put("name", name).put("kind", kind).put("value", value ?: JSONObject.NULL))
                        }
                    }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = onCopy, enabled = !busy) { Text(stringResource(R.string.extension_agents_create_copy)) }
                        if (writable) TextButton(onClick = { deleting = true }, enabled = !busy) { Text(stringResource(R.string.extension_agents_delete_agent), color = OmpColors.StatusError) }
                    }
                }
                if (busy) Text(stringResource(R.string.extension_agents_saving), color = OmpColors.TextMuted)
                notice?.let { Text(it, color = OmpColors.TextMuted) }
                error?.let { Text(it, color = OmpColors.StatusError) }
            }
        },
        confirmButton = {
            if (writable && !runtimeSettings) Button(shape = MaterialTheme.shapes.small, onClick = {
                val args = JSONObject().put("cwd", cwd).put("name", name.trim()).put("scope", saveScope)
                    .put("description", description).put("systemPrompt", prompt)
                if (customTools) args.put("tools", JSONArray(tools.lines().map { it.trim() }.filter { it.isNotEmpty() }))
                if (model.isNotBlank()) args.put("model", agentModelValue(model))
                if (thinking.isNotBlank()) args.put("thinkingLevel", thinking.trim())
                agentSettingValue(prewalk, prewalkText)?.let { args.put("prewalk", it) }
                agentSettingValue(advisor, advisorText)?.let { args.put("advisor", it) }
                agentSettingValue(blocking, "")?.let { args.put("blocking", it) }
                mutate("agents.save", args, close = true)
            }, enabled = !busy && name.isNotBlank() && description.isNotBlank() && (saveScope != "project" || cwd.isNotBlank())) { Text(if (busy) stringResource(R.string.extension_agents_saving) else stringResource(R.string.extension_agents_save_definition)) }
        },
        dismissButton = { TextButton(onClick = onClose, enabled = !busy) { Text(stringResource(R.string.extension_close)) } },
    )
    if (deleting) AlertDialog(
        onDismissRequest = { if (!busy) deleting = false },
        containerColor = OmpColors.BgPanel,
        title = { OmpDialogSystemBars(); Text(stringResource(R.string.extension_agents_delete_title), color = OmpColors.Text) },
        text = { Column(Modifier.heightIn(max = 480.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.extension_agents_delete_message, name, source), color = OmpColors.TextMuted)
            error?.let { Text(it, color = OmpColors.StatusError) }
        } },
        confirmButton = { TextButton(onClick = {
            mutate("agents.delete", JSONObject().put("cwd", cwd).put("name", name).put("scope", source), close = true)
        }, enabled = !busy) { Text(stringResource(R.string.extension_delete), color = OmpColors.StatusError) } },
        dismissButton = { TextButton(onClick = { deleting = false }, enabled = !busy) { Text(stringResource(R.string.extension_cancel)) } },
    )
}

@Composable
private fun AgentOverrides(initial: JSONObject, enabled: Boolean, onSave: (String, Any?) -> Unit) {
    var model by rememberSaveable { mutableStateOf(agentListText(initial.opt("overrideModel"))) }
    var prewalk by rememberSaveable { mutableStateOf(agentSettingMode(initial.opt("prewalkOverride"))) }
    var prewalkText by rememberSaveable { mutableStateOf(initial.opt("prewalkOverride") as? String ?: "") }
    var advisor by rememberSaveable { mutableStateOf(agentSettingMode(initial.opt("advisorOverride"))) }
    var advisorText by rememberSaveable { mutableStateOf(initial.opt("advisorOverride") as? String ?: "") }
    AgentTextField(stringResource(R.string.extension_agents_model_override), model, { model = it }, enabled, multiline = true)
    OutlinedButton(onClick = { onSave("model", if (model.isBlank()) null else agentModelValue(model)) }, enabled = enabled, shape = MaterialTheme.shapes.small) { Text(if (model.isBlank()) stringResource(R.string.extension_agents_clear_model_override) else stringResource(R.string.extension_agents_save_model_override)) }
    AgentBooleanString(stringResource(R.string.extension_agents_prewalk_override), prewalk, { prewalk = it }, prewalkText, { prewalkText = it }, enabled)
    OutlinedButton(onClick = { onSave("prewalk", agentSettingValue(prewalk, prewalkText)) }, enabled = enabled, shape = MaterialTheme.shapes.small) { Text(if (prewalk == "inherit") stringResource(R.string.extension_agents_clear_prewalk_override) else stringResource(R.string.extension_agents_save_prewalk_override)) }
    AgentBooleanString(stringResource(R.string.extension_agents_advisor_override), advisor, { advisor = it }, advisorText, { advisorText = it }, enabled)
    OutlinedButton(onClick = { onSave("advisor", agentSettingValue(advisor, advisorText)) }, enabled = enabled, shape = MaterialTheme.shapes.small) { Text(if (advisor == "inherit") stringResource(R.string.extension_agents_clear_advisor_override) else stringResource(R.string.extension_agents_save_advisor_override)) }
}

@Composable
private fun AgentUnpackDialog(requester: RelayRequester, cwd: String, onClose: () -> Unit, onSuccess: (String) -> Unit) {
    val context = LocalContext.current
    var target by remember { mutableStateOf("user") }
    var force by remember { mutableStateOf(false) }
    var confirmingForce by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    fun unpack() {
        busy = true
        error = null
        scope.launch {
            try {
                val result = requester.request("extensions", "agents.unpack", JSONObject().put("cwd", cwd).put("scope", target).put("force", force))
                onSuccess(context.getString(R.string.extension_agents_unpacked, result.getInt("count"), result.getString("targetDir")))
            } catch (e: CancellationException) { throw e
            } catch (e: Exception) {
                error = context.getString(R.string.extension_agents_unpack_failed, relayErrorDetail(e, context.getString(R.string.extension_request_failed)))
            } finally { busy = false }
        }
    }
    AlertDialog(
        onDismissRequest = { if (!busy) onClose() }, containerColor = OmpColors.BgPanel,
        title = { OmpDialogSystemBars(); Text(stringResource(R.string.extension_agents_unpack_bundled), color = OmpColors.Text) },
        text = { Column(Modifier.heightIn(max = 480.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.extension_agents_unpack_hint), color = OmpColors.TextMuted)
            AgentChoice(stringResource(R.string.extension_agents_target_scope), target, listOf("user", "project"), !busy) { target = it }
            AgentToggle(stringResource(R.string.extension_agents_force_overwrite), force, !busy) { force = it }
            error?.let { Text(it, color = OmpColors.StatusError) }
        } },
        confirmButton = { TextButton(onClick = { if (force) confirmingForce = true else unpack() }, enabled = !busy && (target != "project" || cwd.isNotBlank())) { Text(if (busy) stringResource(R.string.extension_agents_unpacking) else stringResource(R.string.extension_agents_unpack)) } },
        dismissButton = { TextButton(onClick = onClose, enabled = !busy) { Text(stringResource(R.string.extension_cancel)) } },
    )
    if (confirmingForce) AlertDialog(
        onDismissRequest = { if (!busy) confirmingForce = false }, containerColor = OmpColors.BgPanel,
        title = { OmpDialogSystemBars(); Text(stringResource(R.string.extension_agents_overwrite_title), color = OmpColors.Text) },
        text = { Column(Modifier.heightIn(max = 480.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.extension_agents_overwrite_message, target), color = OmpColors.TextMuted)
            error?.let { Text(it, color = OmpColors.StatusError) }
        } },
        confirmButton = { TextButton(onClick = { unpack() }, enabled = !busy) { Text(stringResource(R.string.extension_agents_overwrite_confirm), color = OmpColors.StatusError) } },
        dismissButton = { TextButton(onClick = { confirmingForce = false }, enabled = !busy) { Text(stringResource(R.string.extension_cancel)) } },
    )
}

@Composable
private fun AgentTextField(label: String, value: String, onChange: (String) -> Unit, enabled: Boolean = true, multiline: Boolean = false, minLines: Int = 1, codeStyle: Boolean = multiline) {
    OutlinedTextField(value = value, onValueChange = onChange, label = { Text(label) },
        modifier = Modifier.fillMaxWidth(), readOnly = !enabled, singleLine = !multiline, minLines = minLines, maxLines = if (multiline) maxOf(minLines, 12) else 1,
        textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = if (codeStyle) FontFamily.Monospace else FontFamily.Default),
        colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
            focusedTextColor = OmpColors.Text, unfocusedTextColor = OmpColors.Text,
            focusedBorderColor = OmpColors.Accent, unfocusedBorderColor = OmpColors.Border,
            focusedLabelColor = OmpColors.Accent, unfocusedLabelColor = OmpColors.TextMuted,
        ))
}

@Composable
private fun AgentChoice(label: String, value: String, options: List<String>, enabled: Boolean, onChange: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, modifier = Modifier.weight(1f), color = OmpColors.TextMuted)
        androidx.compose.foundation.layout.Box {
            TextButton(onClick = { expanded = true }, enabled = enabled, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(value.replaceFirstChar { it.uppercase() }, color = OmpColors.Text)
                androidx.compose.material3.Icon(androidx.compose.material.icons.Icons.Default.ExpandMore, stringResource(R.string.extension_choose_label, label), Modifier.size(20.dp))
            }
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                options.forEach { option -> DropdownMenuItem(text = { Text(option.replaceFirstChar { it.uppercase() }) }, onClick = { expanded = false; onChange(option) }) }
            }
        }
    }
}

@Composable
private fun AgentToggle(label: String, value: Boolean, enabled: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, Modifier.weight(1f), color = OmpColors.Text)
        Switch(checked = value, onCheckedChange = onChange, enabled = enabled)
    }
}

@Composable
private fun AgentBooleanString(label: String, mode: String, onMode: (String) -> Unit, text: String, onText: (String) -> Unit, enabled: Boolean) {
    AgentChoice(label, mode, listOf("inherit", "enabled", "disabled", "custom"), enabled, onMode)
    if (mode == "custom") AgentTextField(stringResource(R.string.extension_agents_custom_value, label), text, onText, enabled, multiline = true)
}

private fun relayErrorDetail(e: Exception, requestFailed: String): String =
    if (e is RelayRequestException) "${e.code}: ${e.message}" else e.message ?: requestFailed

private fun agentListText(value: Any?): String = when (value) {
    is JSONArray -> List(value.length()) { value.getString(it) }.joinToString("\n")
    is String -> value
    else -> ""
}

private fun agentModelValue(value: String): Any {
    val selectors = value.lines().map { it.trim() }.filter { it.isNotEmpty() }
    return if (selectors.size == 1) selectors.first() else JSONArray(selectors)
}

private fun agentSettingMode(value: Any?): String = when (value) {
    true -> "enabled"
    false -> "disabled"
    is String -> "custom"
    else -> "inherit"
}

private fun agentSettingValue(mode: String, text: String): Any? = when (mode) {
    "enabled" -> true
    "disabled" -> false
    "custom" -> text
    else -> null
}
