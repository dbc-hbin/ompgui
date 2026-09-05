package com.dbchbin.ompgui.remote.ui

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
    var query by remember { mutableStateOf("") }
    var source by remember { mutableStateOf("all") }
    var appliedQuery by remember { mutableStateOf("") }
    var appliedSource by remember { mutableStateOf("all") }
    var offset by remember { mutableStateOf(0) }
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
            error = "Could not load agents: ${if (e is RelayRequestException) "${e.code}: ${e.message}" else e.message ?: "Request failed"}. Retry or check the desktop connection."
        } finally {
            loading = false
        }
    }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Agents", color = OmpColors.Text)
        AgentTextField("Search name, description or prompt", query, { query = it }, enabled = !busy)
        AgentChoice("Inventory source", source, listOf("all", "user", "project", "bundled", "extension"), !busy) { source = it }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = {
                appliedQuery = query.trim()
                appliedSource = source
                offset = 0
                revision++
            }, enabled = !loading && !busy) { Text("Search / refresh") }
            Button(onClick = { editor = JSONObject() }, enabled = !busy) { Text("Create") }
        }
        OutlinedButton(onClick = { unpack = true }, enabled = !busy) { Text("Unpack bundled agents") }
        if (loading) Text("Loading agents…", color = OmpColors.TextMuted)
        error?.let { Text(it, color = OmpColors.StatusError) }
        notice?.let { Text(it, color = OmpColors.TextMuted) }
        if (!loading && error == null && rows.isEmpty()) Text("No agents match these filters.", color = OmpColors.TextMuted)
        if (!loading && error == null) rows.forEach { row ->
            Column(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(row.getString("name"), color = OmpColors.Text)
                Text(row.getString("description"), color = OmpColors.TextMuted)
                Text(row.getString("source") + if (row.optBoolean("disabled")) " · disabled" else "", color = OmpColors.TextMuted)
                OutlinedButton(onClick = {
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
                            error = "Could not open the full agent: ${if (e is RelayRequestException) "${e.code}: ${e.message}" else e.message ?: "Request failed"}. Retry View / edit."
                        } finally { busy = false }
                    }
                }, enabled = !busy) { Text("View / edit") }
                HorizontalDivider(color = OmpColors.Border)
            }
        }
        Text(if (total == 0) "0 agents" else "${offset + 1}–${minOf(offset + rows.size, total)} of $total", color = OmpColors.TextMuted)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { offset = maxOf(0, offset - pageLimit) }, enabled = offset > 0 && !loading && !busy) { Text("Previous") }
            OutlinedButton(onClick = { offset += pageLimit }, enabled = hasMore && !loading && !busy && error == null) { Text("Next") }
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
    val scope = rememberCoroutineScope()

    fun mutate(action: String, args: JSONObject, close: Boolean = false) {
        busy = true
        error = null
        notice = null
        scope.launch {
            try {
                requester.request("extensions", action, args)
                onChanged()
                if (close) onClose() else notice = "Changes saved."
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = "$action failed: ${if (e is RelayRequestException) "${e.code}: ${e.message}" else e.message ?: "Request failed"}. Your input is retained; correct it or reconnect, then retry."
            } finally { busy = false }
        }
    }

    AlertDialog(
        onDismissRequest = { if (!busy) onClose() },
        containerColor = OmpColors.BgPanel,
        title = { Text(if (!existing) "Create agent" else "Agent: $name", color = OmpColors.Text) },
        text = {
            Column(Modifier.fillMaxWidth().heightIn(max = 560.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (existing) {
                    Text("Source: $source", color = OmpColors.TextMuted)
                    initial.optString("filePath").takeIf { it.isNotBlank() }?.let { Text(it, color = OmpColors.TextMuted) }
                    if (!writable) Text("This source is read-only. Copy it to user or project scope to edit its definition. Disabled state and overrides can still be changed.", color = OmpColors.TextMuted)
                }
                AgentTextField("Name (kebab-case)", name, { name = it }, !busy && !existing)
                AgentChoice("Save scope", saveScope, listOf("user", "project"), !busy && !existing) { saveScope = it }
                AgentTextField("Description", description, { description = it }, !busy && writable, multiline = true)
                AgentTextField("Full system prompt", prompt, { prompt = it }, !busy && writable, multiline = true, minLines = 8)
                Text(if (existing) "Definition updates preserve omitted fields. Blank model/thinking and inherit choices leave existing values unchanged. To restore default tools, enable Specify tools and leave the list empty." else "Blank fields and inherit choices use defaults. An empty tools list uses default tools.", color = OmpColors.TextMuted)
                AgentToggle("Specify tools", customTools, !busy && writable) { customTools = it }
                if (customTools) AgentTextField("Tools — one per line", tools, { tools = it }, !busy && writable, multiline = true)
                AgentTextField("Model selectors — one per line; optional", model, { model = it }, !busy && writable, multiline = true)
                AgentTextField("Thinking level — optional", thinking, { thinking = it }, !busy && writable)
                AgentBooleanString("Prewalk", prewalk, { prewalk = it }, prewalkText, { prewalkText = it }, !busy && writable)
                AgentBooleanString("Advisor", advisor, { advisor = it }, advisorText, { advisorText = it }, !busy && writable)
                AgentChoice("Blocking", blocking, listOf("inherit", "enabled", "disabled"), !busy && writable) { blocking = it }
                if (writable) Button(onClick = {
                    val args = JSONObject().put("cwd", cwd).put("name", name.trim()).put("scope", saveScope)
                        .put("description", description).put("systemPrompt", prompt)
                    if (customTools) args.put("tools", JSONArray(tools.lines().map { it.trim() }.filter { it.isNotEmpty() }))
                    if (model.isNotBlank()) args.put("model", agentModelValue(model))
                    if (thinking.isNotBlank()) args.put("thinkingLevel", thinking.trim())
                    agentSettingValue(prewalk, prewalkText)?.let { args.put("prewalk", it) }
                    agentSettingValue(advisor, advisorText)?.let { args.put("advisor", it) }
                    agentSettingValue(blocking, "")?.let { args.put("blocking", it) }
                    mutate("agents.save", args, close = true)
                }, enabled = !busy && name.isNotBlank() && description.isNotBlank() && (saveScope != "project" || cwd.isNotBlank())) { Text("Save definition") }
                if (existing) {
                    HorizontalDivider(color = OmpColors.Border)
                    Text("Global per-name settings", color = OmpColors.Text)
                    AgentToggle("Disabled", disabled, !busy) { disabled = it }
                    OutlinedButton(onClick = { mutate("agents.setDisabled", JSONObject().put("name", name).put("disabled", disabled)) }, enabled = !busy) { Text("Save disabled state") }
                    AgentOverrides(initial, !busy) { kind, value ->
                        mutate("agents.setOverride", JSONObject().put("name", name).put("kind", kind).put("value", value ?: JSONObject.NULL))
                    }
                    OutlinedButton(onClick = onCopy, enabled = !busy) { Text("Create editable copy") }
                    if (writable) OutlinedButton(onClick = { deleting = true }, enabled = !busy) { Text("Delete agent", color = OmpColors.StatusError) }
                }
                if (busy) Text("Saving…", color = OmpColors.TextMuted)
                notice?.let { Text(it, color = OmpColors.TextMuted) }
                error?.let { Text(it, color = OmpColors.StatusError) }
            }
        },
        confirmButton = { TextButton(onClick = onClose, enabled = !busy) { Text("Close") } },
    )
    if (deleting) AlertDialog(
        onDismissRequest = { if (!busy) deleting = false },
        containerColor = OmpColors.BgPanel,
        title = { Text("Delete agent?", color = OmpColors.Text) },
        text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Permanently delete $name from $source scope? This cannot be undone.", color = OmpColors.TextMuted)
            error?.let { Text(it, color = OmpColors.StatusError) }
        } },
        confirmButton = { TextButton(onClick = {
            mutate("agents.delete", JSONObject().put("cwd", cwd).put("name", name).put("scope", source), close = true)
        }, enabled = !busy) { Text("Delete", color = OmpColors.StatusError) } },
        dismissButton = { TextButton(onClick = { deleting = false }, enabled = !busy) { Text("Cancel") } },
    )
}

@Composable
private fun AgentOverrides(initial: JSONObject, enabled: Boolean, onSave: (String, Any?) -> Unit) {
    var model by remember { mutableStateOf(agentListText(initial.opt("overrideModel"))) }
    var prewalk by remember { mutableStateOf(agentSettingMode(initial.opt("prewalkOverride"))) }
    var prewalkText by remember { mutableStateOf(initial.opt("prewalkOverride") as? String ?: "") }
    var advisor by remember { mutableStateOf(agentSettingMode(initial.opt("advisorOverride"))) }
    var advisorText by remember { mutableStateOf(initial.opt("advisorOverride") as? String ?: "") }
    AgentTextField("Model override — one selector per line", model, { model = it }, enabled, multiline = true)
    OutlinedButton(onClick = { onSave("model", if (model.isBlank()) null else agentModelValue(model)) }, enabled = enabled) { Text(if (model.isBlank()) "Clear model override" else "Save model override") }
    AgentBooleanString("Prewalk override", prewalk, { prewalk = it }, prewalkText, { prewalkText = it }, enabled)
    OutlinedButton(onClick = { onSave("prewalk", agentSettingValue(prewalk, prewalkText)) }, enabled = enabled) { Text(if (prewalk == "inherit") "Clear prewalk override" else "Save prewalk override") }
    AgentBooleanString("Advisor override", advisor, { advisor = it }, advisorText, { advisorText = it }, enabled)
    OutlinedButton(onClick = { onSave("advisor", agentSettingValue(advisor, advisorText)) }, enabled = enabled) { Text(if (advisor == "inherit") "Clear advisor override" else "Save advisor override") }
}

@Composable
private fun AgentUnpackDialog(requester: RelayRequester, cwd: String, onClose: () -> Unit, onSuccess: (String) -> Unit) {
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
                onSuccess("Unpacked ${result.getInt("count")} agents to ${result.getString("targetDir")}.")
            } catch (e: CancellationException) { throw e
            } catch (e: Exception) {
                error = "Unpack failed: ${if (e is RelayRequestException) "${e.code}: ${e.message}" else e.message ?: "Request failed"}. Settings are retained; retry after resolving the error."
            } finally { busy = false }
        }
    }
    AlertDialog(
        onDismissRequest = { if (!busy) onClose() }, containerColor = OmpColors.BgPanel,
        title = { Text("Unpack bundled agents", color = OmpColors.Text) },
        text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Create editable agent files in the selected scope.", color = OmpColors.TextMuted)
            AgentChoice("Target scope", target, listOf("user", "project"), !busy) { target = it }
            AgentToggle("Overwrite existing files (force)", force, !busy) { force = it }
            error?.let { Text(it, color = OmpColors.StatusError) }
        } },
        confirmButton = { TextButton(onClick = { if (force) confirmingForce = true else unpack() }, enabled = !busy && (target != "project" || cwd.isNotBlank())) { Text(if (busy) "Unpacking…" else "Unpack") } },
        dismissButton = { TextButton(onClick = onClose, enabled = !busy) { Text("Cancel") } },
    )
    if (confirmingForce) AlertDialog(
        onDismissRequest = { if (!busy) confirmingForce = false }, containerColor = OmpColors.BgPanel,
        title = { Text("Overwrite agent files?", color = OmpColors.Text) },
        text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Force unpack into $target scope can replace existing agent definitions and prompts. This cannot be undone.", color = OmpColors.TextMuted)
            error?.let { Text(it, color = OmpColors.StatusError) }
        } },
        confirmButton = { TextButton(onClick = { unpack() }, enabled = !busy) { Text("Overwrite and unpack", color = OmpColors.StatusError) } },
        dismissButton = { TextButton(onClick = { confirmingForce = false }, enabled = !busy) { Text("Cancel") } },
    )
}

@Composable
private fun AgentTextField(label: String, value: String, onChange: (String) -> Unit, enabled: Boolean = true, multiline: Boolean = false, minLines: Int = 1) {
    OutlinedTextField(value = value, onValueChange = onChange, label = { Text(label) },
        modifier = Modifier.fillMaxWidth(), readOnly = !enabled, singleLine = !multiline, minLines = minLines,
        colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
            focusedTextColor = OmpColors.Text, unfocusedTextColor = OmpColors.Text,
            focusedBorderColor = OmpColors.Accent, unfocusedBorderColor = OmpColors.Border,
            focusedLabelColor = OmpColors.Accent, unfocusedLabelColor = OmpColors.TextMuted,
        ))
}

@Composable
private fun AgentChoice(label: String, value: String, options: List<String>, enabled: Boolean, onChange: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Column {
        OutlinedButton(onClick = { expanded = true }, enabled = enabled, modifier = Modifier.fillMaxWidth()) { Text("$label: $value") }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { option -> DropdownMenuItem(text = { Text(option) }, onClick = { expanded = false; onChange(option) }) }
        }
    }
}

@Composable
private fun AgentToggle(label: String, value: Boolean, enabled: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, Modifier.weight(1f), color = OmpColors.Text)
        Switch(checked = value, onCheckedChange = onChange, enabled = enabled)
    }
}

@Composable
private fun AgentBooleanString(label: String, mode: String, onMode: (String) -> Unit, text: String, onText: (String) -> Unit, enabled: Boolean) {
    AgentChoice(label, mode, listOf("inherit", "enabled", "disabled", "custom"), enabled, onMode)
    if (mode == "custom") AgentTextField("$label custom value", text, onText, enabled, multiline = true)
}

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
