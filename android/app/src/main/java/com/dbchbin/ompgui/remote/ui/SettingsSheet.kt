package com.dbchbin.ompgui.remote.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.dbchbin.ompgui.remote.net.ConnectionState
import com.dbchbin.ompgui.remote.relay.ModelRef
import com.dbchbin.ompgui.remote.relay.RelayRequester
import com.dbchbin.ompgui.remote.store.AppPreferences
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

private data class SettingField(val path: String, val category: String, val kind: String = "boolean", val choices: List<String> = emptyList(), val min: Int = 0, val max: Int = Int.MAX_VALUE)

private val settingFields = buildList {
    add(SettingField("defaultThinkingLevel", "Models", "choice", listOf("auto", "minimal", "low", "medium", "high", "xhigh", "max")))
    add(SettingField("textVerbosity", "Models", "choice", listOf("low", "medium", "high")))
    add(SettingField("personality", "Models", "choice", listOf("default", "friendly", "pragmatic", "none")))
    for (path in listOf("hideThinkingBlock", "externalThinking", "registryHasScopedEntries")) add(SettingField(path, "Models"))
    for (path in listOf("enabledModels", "disabledProviders", "modelProviderOrder")) add(SettingField(path, "Models", "array"))
    add(SettingField("tools.approvalMode", "Safety", "choice", listOf("always-ask", "write", "yolo")))
    add(SettingField("tools.approval.bash", "Safety", "choice", listOf("allow", "prompt", "deny")))
    add(SettingField("tools.approval.extension", "Safety", "choice", listOf("allow", "prompt")))
    for (path in listOf("advisor.enabled", "advisor.subagents", "retry.enabled", "retry.modelFallback", "compaction.enabled", "compaction.midTurnEnabled", "compaction.autoContinue", "compaction.remoteEnabled", "autolearn.enabled", "autolearn.autoContinue", "mnemopi.autoRecall", "mnemopi.autoRetain", "mnemopi.noEmbeddings")) add(SettingField(path, "Intelligence"))
    add(SettingField("advisor.syncBacklog", "Intelligence", "choice", listOf("off", "1", "3", "5")))
    add(SettingField("advisor.immuneTurns", "Intelligence", "integer", min = 0, max = 20))
    add(SettingField("retry.maxRetries", "Intelligence", "integer", min = 0, max = 20))
    add(SettingField("retry.fallbackRevertPolicy", "Intelligence", "choice", listOf("cooldown-expiry", "never")))
    add(SettingField("retry.fallbackChains", "Models", "object"))
    add(SettingField("compaction.strategy", "Intelligence", "choice", listOf("snapcompact", "handoff", "context-full", "shake", "off")))
    add(SettingField("compaction.keepRecentTokens", "Intelligence", "integer", min = 1000, max = 1000000))
    add(SettingField("autolearn.minToolCalls", "Intelligence", "integer", min = 0, max = 100))
    add(SettingField("memory.backend", "Intelligence", "choice", listOf("off", "local", "mnemopi", "hindsight")))
    add(SettingField("mnemopi.scoping", "Intelligence", "choice", listOf("global", "per-project", "per-project-tagged")))
    add(SettingField("task.eager", "Agents", "choice", listOf("default", "preferred", "always")))
    add(SettingField("task.prewalk", "Agents"))
    add(SettingField("task.disabledAgents", "Agents", "array"))
    for (path in listOf("task.agentModelOverrides", "task.agentPrewalk", "task.agentAdvisor")) add(SettingField(path, "Agents", "object"))
    for (path in listOf("mcp.enableProjectConfig", "mcp.renderMarkdownResults", "mcp.notifications", "browser.enabled", "browser.relay", "browser.headless", "computer.enabled", "web_search.enabled", "github.enabled", "security.enabled", "checkpoint.enabled")) add(SettingField(path, "Tools"))
    add(SettingField("mcp.notificationDebounceMs", "Tools", "integer", min = 0, max = 60000))
    add(SettingField("computer.display", "Tools", "string"))
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsSheet(
    requester: RelayRequester,
    serverUrl: String,
    connection: ConnectionState,
    currentModel: ModelRef?,
    onUnpair: () -> Unit,
    onDismiss: () -> Unit,
    settings: JSONObject? = null,
    deviceId: String = "",
    settingsCwd: String = "",
) {
    val scope = rememberCoroutineScope()
    var snapshot by remember { mutableStateOf(settings) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var query by remember { mutableStateOf("") }
    var reload by remember { mutableIntStateOf(0) }
    var category by remember { mutableStateOf("General") }
    var confirmation by remember { mutableStateOf<Pair<String, () -> Unit>?>(null) }
    var showUsage by remember { mutableStateOf(false) }
    val save: (String, Any) -> Unit = { path, value ->
        if (!busy) scope.launch {
            busy = true
            error = null
            try {
                val patch = JSONObject()
                var node = patch
                val segments = path.split('.')
                for (segment in segments.dropLast(1)) {
                    val child = JSONObject()
                    node.put(segment, child)
                    node = child
                }
                node.put(segments.last(), value)
                val result = requester.request("system", "settings.update", JSONObject().put("settings", patch))
                snapshot = result.getJSONObject("settings")
                notice = if (result.optJSONObject("application")?.optString("mode") == "runtime-refresh") "Saved; runtime refreshed" else "Saved; applies to new sessions"
            } catch (failure: CancellationException) { throw failure
            } catch (failure: Exception) { error = failure.message ?: "Settings update failed"
            } finally { busy = false }
        }
    }
    LaunchedEffect(requester, reload) {
        busy = true
        error = null
        try { snapshot = requester.request("system", "settings.get", JSONObject()).getJSONObject("settings")
        } catch (failure: CancellationException) { throw failure
        } catch (failure: Exception) { error = failure.message ?: "Settings load failed"
        } finally { busy = false }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = OmpColors.BgPanel) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp)) {
            Text("Settings", style = MaterialTheme.typography.titleLarge)
            OutlinedTextField(query, { query = it }, label = { Text("Search settings by name") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            androidx.compose.foundation.lazy.LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(7) { index ->
                    val name = listOf("General", "Safety", "Models", "Intelligence", "Agents", "Tools", "System")[index]
                    FilterChip(category == name, { category = name; query = "" }, label = { Text(name) })
                }
            }
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            notice?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            TextButton(enabled = !busy, onClick = { reload++ }) { Text("Refresh settings") }
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (category == "General" && query.isBlank() || query.isNotBlank() && listOf("general", "theme", "palette", "language", "completion chime", "submit", "collapse tool calls").any { it.contains(query, true) }) LocalPreferencesSection()
                for (field in settingFields.filter { if (query.isBlank()) it.category == category else it.path.contains(query, true) || it.category.contains(query, true) }) {
                    var node: JSONObject? = snapshot
                    val segments = field.path.split('.')
                    for (segment in segments.dropLast(1)) node = node?.optJSONObject(segment)
                    val value = node?.opt(segments.last())?.takeUnless { it == JSONObject.NULL }
                    SettingEditor(field, value, !busy && snapshot != null) { newValue ->
                        if (field.path == "computer.enabled" && newValue == true || field.path == "tools.approvalMode" && newValue == "yolo" || field.path == "tools.approval.bash" && newValue == "allow") {
                            confirmation = "Allow ${field.path} = $newValue? This grants the agent additional control over the host." to { save(field.path, newValue) }
                        } else save(field.path, newValue)
                    }
                }
                if (query.isBlank()) when (category) {
                    "Models" -> { currentModel?.let { Text("Current model: ${it.displayName()} · ${it.provider}") }; ModelSettingsPanel(requester, settingsCwd) }
                    "Agents", "Tools" -> ExtensionSettingsPanel(requester, settingsCwd)
                    "System" -> {
                        Text("Relay: $serverUrl\nDevice: $deviceId\nConnection: $connection")
                        Button(onClick = { showUsage = true }) { Text("Usage and capacity") }
                        SystemControls(requester, deviceId, onUnpair)
                    }
                }
            }
        }
    }
    confirmation?.let { pending -> AlertDialog(onDismissRequest = { confirmation = null }, title = { Text("Confirm security change") }, text = { Text(pending.first) }, confirmButton = { TextButton(onClick = { confirmation = null; pending.second() }) { Text("Confirm") } }, dismissButton = { TextButton(onClick = { confirmation = null }) { Text("Cancel") } }) }
    if (showUsage) UsageSheet(requester = requester, onDismiss = { showUsage = false })
}

@Composable
private fun SettingEditor(field: SettingField, value: Any?, enabled: Boolean, save: (Any) -> Unit) {
    var draft by remember(field.path, value?.toString()) { mutableStateOf(value?.toString() ?: "") }
    var error by remember(field.path) { mutableStateOf<String?>(null) }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(field.path, style = MaterialTheme.typography.titleSmall)
            if (value == null) Text("Not overridden — uses the server's OMP default", style = MaterialTheme.typography.bodySmall)
            when (field.kind) {
                "boolean", "choice" -> {
                    val options = if (field.kind == "boolean") listOf("true", "false") else field.choices
                    androidx.compose.foundation.lazy.LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(options.size) { index ->
                            val option = options[index]
                            FilterChip(value?.toString() == option, { save(if (field.kind == "boolean") option.toBoolean() else option) }, enabled = enabled, label = { Text(option) })
                        }
                    }
                }
                else -> {
                    OutlinedTextField(draft, { draft = it; error = null }, enabled = enabled, modifier = Modifier.fillMaxWidth(), label = { Text(when (field.kind) { "integer" -> "${field.min}–${field.max}"; "array" -> "JSON array of names"; "object" -> "JSON object"; else -> "Value" }) }, isError = error != null)
                    TextButton(enabled = enabled && draft != (value?.toString() ?: ""), onClick = {
                        try {
                            val parsed: Any = when (field.kind) {
                                "integer" -> draft.toInt().also { require(it in field.min..field.max) { "Enter an integer from ${field.min} to ${field.max}" } }
                                "array" -> JSONArray(draft).also { array -> for (index in 0 until array.length()) require(array.get(index) is String && array.getString(index).isNotBlank()) { "Use non-empty string entries" } }
                                "object" -> JSONObject(draft)
                                else -> draft
                            }
                            save(parsed)
                        } catch (failure: Exception) { error = failure.message ?: "Invalid value" }
                    }) { Text("Save") }
                    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                }
            }
        }
    }
}

@Composable
private fun LocalPreferencesSection() {
    val context = LocalContext.current
    var theme by remember { mutableStateOf(AppPreferences.getTheme(context)) }
    var palette by remember { mutableStateOf(AppPreferences.getPalette(context)) }
    var language by remember { mutableStateOf(AppPreferences.getLanguage(context, java.util.Locale.getDefault().language)) }
    var chime by remember { mutableStateOf(AppPreferences.isSoundChime(context)) }
    var submit by remember { mutableStateOf(AppPreferences.getSubmitBehavior(context)) }
    var collapsed by remember { mutableStateOf(AppPreferences.isToolCallsCollapsed(context)) }
    SettingEditor(SettingField("Theme", "General", "choice", listOf("system", "light", "dark")), theme, true) { theme = it.toString(); AppPreferences.setTheme(context, theme) }
    SettingEditor(SettingField("Palette", "General", "choice", listOf("warm", "omp")), palette, true) { palette = it.toString(); AppPreferences.setPalette(context, palette) }
    SettingEditor(SettingField("Language", "General", "choice", listOf("English", "한국어")), language, true) { language = it.toString(); AppPreferences.setLanguage(context, language) }
    SettingEditor(SettingField("Completion chime", "General"), chime, true) { chime = it == true; AppPreferences.setSoundChime(context, chime) }
    SettingEditor(SettingField("Submit during run", "General", "choice", listOf("steer", "queue")), submit, true) { submit = it.toString(); AppPreferences.setSubmitBehavior(context, submit) }
    SettingEditor(SettingField("Collapse tool calls", "General"), collapsed, true) { collapsed = it == true; AppPreferences.setToolCallsCollapsed(context, collapsed) }
}

@Composable
private fun SystemControls(requester: RelayRequester, deviceId: String, onUnpair: () -> Unit) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var result by remember { mutableStateOf<JSONObject?>(null) }
    var devices by remember { mutableStateOf<JSONArray?>(null) }
    var confirmation by remember { mutableStateOf<Pair<String, () -> Unit>?>(null) }
    val request: (String, JSONObject) -> Unit = { action, args ->
        scope.launch {
            busy = true; error = null
            try {
                result = requester.request("system", action, args)
                if (action == "devices.list") devices = result?.getJSONArray("devices")
                if (action == "devices.revoke") {
                    if (args.optString("deviceId") == deviceId) onUnpair()
                    else devices = requester.request("system", "devices.list", JSONObject()).getJSONArray("devices")
                }
            } catch (failure: CancellationException) { throw failure
            } catch (failure: Exception) { error = failure.message ?: "Request failed"
            } finally { busy = false }
        }
    }
    if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    for ((label, action) in listOf("Check OMP version" to "omp.check", "Check app version" to "app.check", "Refresh paired devices" to "devices.list")) {
        OutlinedButton(enabled = !busy, onClick = { request(action, JSONObject().apply { if (action == "app.check") put("force", true) }) }) { Text(label) }
    }
    result?.let { SelectionContainer { Text(it.toString(2), style = MaterialTheme.typography.bodySmall) } }
    Text("Updates are installed on the host. Version checks provide the exact update command; remote self-update is disabled.", style = MaterialTheme.typography.bodySmall)
    devices?.let { list -> for (index in 0 until list.length()) {
        val device = list.optJSONObject(index) ?: continue
        Text("${device.optString("label")} · ${device.optString("id")}\nLast seen: ${device.opt("lastSeenAt")}")
        TextButton(enabled = !busy, onClick = { confirmation = "Revoke ${device.optString("label")}? This disconnects that device." to { request("devices.revoke", JSONObject().put("deviceId", device.getString("id"))) } }) { Text("Revoke device") }
    } }
    OutlinedButton(enabled = !busy, onClick = { confirmation = "Restart all OMP sessions? Active work may be interrupted." to { request("omp.restart", JSONObject().put("confirm", true)) } }) { Text("Restart OMP sessions") }
    OutlinedButton(enabled = !busy, onClick = { confirmation = "Unpair this device and remove its saved connection?" to onUnpair }) { Text("Unpair this device") }
    confirmation?.let { pending -> AlertDialog(onDismissRequest = { confirmation = null }, title = { Text("Confirm") }, text = { Text(pending.first) }, confirmButton = { TextButton(onClick = { confirmation = null; pending.second() }) { Text("Confirm") } }, dismissButton = { TextButton(onClick = { confirmation = null }) { Text("Cancel") } }) }
}
