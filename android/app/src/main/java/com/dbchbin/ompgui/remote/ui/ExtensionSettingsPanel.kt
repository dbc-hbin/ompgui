package com.dbchbin.ompgui.remote.ui

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dbchbin.ompgui.remote.relay.RelayRequester
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/** Embedded in the settings scroll container; each inventory has bounded pages. */
@Composable
fun ExtensionSettingsPanel(requester: RelayRequester, cwd: String) {
    key(requester, cwd) {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            ExtensionSkillsSection(requester, cwd)
            ExtensionPluginsSection(requester, cwd)
            ExtensionAgentsSection(requester, cwd)
            ExtensionMcpSection(requester, cwd)
        }
    }
}

private class ExtensionOperation {
    var pending by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var message by mutableStateOf<String?>(null)

    suspend fun run(block: suspend () -> Unit) {
        if (pending) return
        pending = true
        error = null
        message = null
        try {
            block()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            error = failure.message ?: "Request failed. Your inputs have been retained."
        } finally {
            pending = false
        }
    }
}

private fun extensionRows(array: JSONArray): List<JSONObject> =
    List(array.length()) { array.getJSONObject(it) }

@Composable
private fun ExtensionSection(title: String, operation: ExtensionOperation, content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxWidth().border(1.dp, OmpColors.Border, RoundedCornerShape(8.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(title, color = OmpColors.Text, fontWeight = FontWeight.Bold)
        if (operation.pending) Text("Working…", color = OmpColors.TextMuted)
        operation.error?.let { Text(it, color = OmpColors.StatusError) }
        operation.message?.let { Text(it, color = OmpColors.TextMuted) }
        content()
    }
}

@Composable
private fun ExtensionScope(value: String, enabled: Boolean, onChange: (String) -> Unit) {
    Text("Installation scope", color = OmpColors.TextMuted)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("global", "project").forEach { scope ->
            FilterChip(selected = value == scope, onClick = { onChange(scope) }, enabled = enabled, label = { Text(scope) })
        }
    }
}

@Composable
private fun ExtensionPages(offset: Int, size: Int, total: Int, hasMore: Boolean, pending: Boolean, onPage: (Int) -> Unit) {
    Text(when {
        total == 0 -> "No entries"
        size == 0 -> "No entries on this page · $total total"
        else -> "${offset + 1}–${offset + size} of $total"
    }, color = OmpColors.TextMuted)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        TextButton(onClick = { onPage((offset - 25).coerceAtLeast(0)) }, enabled = !pending && offset > 0) { Text("Previous") }
        TextButton(onClick = { onPage(offset + size) }, enabled = !pending && hasMore) { Text("Next") }
    }
}

@Composable
private fun ExtensionSkillsSection(requester: RelayRequester, cwd: String) {
    val coroutineScope = rememberCoroutineScope()
    val operation = remember { ExtensionOperation() }
    var rows by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var total by remember { mutableStateOf(0) }
    var offset by remember { mutableStateOf(0) }
    var hasMore by remember { mutableStateOf(false) }
    var detail by remember { mutableStateOf<JSONObject?>(null) }
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var searched by remember { mutableStateOf(false) }
    var packageInput by remember { mutableStateOf("") }
    var installScope by remember { mutableStateOf("project") }
    var updates by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var confirmation by remember { mutableStateOf<Pair<String, JSONObject>?>(null) }

    suspend fun load(page: Int) {
        val data = requester.request("extensions", "skills.list", JSONObject().put("cwd", cwd).put("offset", page).put("limit", 25))
        rows = extensionRows(data.getJSONArray("skills"))
        total = data.getInt("total")
        offset = data.getInt("offset")
        hasMore = data.getBoolean("hasMore")
    }
    fun page(page: Int) { coroutineScope.launch { operation.run { load(page) } } }
    fun check(pkg: String? = null, scope: String? = null) {
        coroutineScope.launch {
            operation.run {
                val args = JSONObject().put("cwd", cwd)
                if (pkg != null) args.put("package", pkg).put("scope", scope)
                updates = extensionRows(requester.request("extensions", "skills.check", args).getJSONArray("updates"))
                operation.message = if (updates.isEmpty()) "No update records returned." else "Update check completed."
            }
        }
    }
    LaunchedEffect(Unit) { operation.run { load(0) } }

    ExtensionSection("Skills", operation) {
        TextButton(onClick = { page(offset) }, enabled = !operation.pending) { Text("Refresh installed skills") }
        rows.forEach { row ->
            HorizontalDivider(color = OmpColors.Border)
            Text(row.getString("name"), color = OmpColors.Text, fontWeight = FontWeight.SemiBold)
            Text(row.optString("description"), color = OmpColors.TextMuted)
            Text(listOf(row.optString("scope"), row.optString("source"), row.getString("filePath")).filter { it.isNotBlank() }.joinToString(" · "), color = OmpColors.TextMuted)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Allow model invocation", color = OmpColors.Text, modifier = Modifier.weight(1f))
                Switch(checked = !row.getBoolean("disableModelInvocation"), enabled = !operation.pending, onCheckedChange = { enabled ->
                    coroutineScope.launch { operation.run {
                        requester.request("extensions", "skills.toggle", JSONObject().put("cwd", cwd).put("filePath", row.getString("filePath")).put("disableModelInvocation", !enabled))
                        load(offset)
                    } }
                })
            }
            TextButton(enabled = !operation.pending, onClick = {
                coroutineScope.launch { operation.run {
                    detail = requester.request("extensions", "skills.get", JSONObject().put("cwd", cwd).put("filePath", row.getString("filePath")))
                } }
            }) { Text("Read skill details") }
            row.optJSONObject("install")?.let { install ->
                val pkg = install.optString("package")
                val scope = install.optString("scope")
                if (pkg.isNotBlank() && scope in listOf("global", "project")) {
                    Text("$pkg · $scope", color = OmpColors.TextMuted)
                    if (install.optBoolean("canCheckForUpdates")) {
                        TextButton(enabled = !operation.pending, onClick = { check(pkg, scope) }) { Text("Check this skill") }
                        TextButton(enabled = !operation.pending, onClick = {
                            confirmation = "Update $pkg in $scope scope?" to JSONObject().put("package", pkg).put("scope", scope).put("action", "skills.update")
                        }) { Text("Update skill") }
                    } else Text("Automatic updates are unavailable for this source.", color = OmpColors.TextMuted)
                }
            }
        }
        ExtensionPages(offset, rows.size, total, hasMore, operation.pending, ::page)
        TextButton(onClick = { check() }, enabled = !operation.pending) { Text("Check all skill updates") }
        updates.forEach { update ->
            Text("${update.getString("package")} · ${update.getString("scope")}", color = OmpColors.Text)
            Text(update.getString("state"), color = OmpColors.TextMuted)
            if (update.has("currentVersion")) Text("Installed: ${update.optString("currentVersion")}", color = OmpColors.TextMuted)
            if (update.has("latestVersion")) Text("Latest: ${update.optString("latestVersion")}", color = OmpColors.TextMuted)
            if (update.has("message")) Text(update.optString("message"), color = OmpColors.TextMuted)
            if (update.getString("state") == "update-available") {
                TextButton(enabled = !operation.pending, onClick = {
                    confirmation = "Update ${update.getString("package")}?" to JSONObject().put("package", update.getString("package")).put("scope", update.getString("scope")).put("action", "skills.update")
                }) { Text("Apply update") }
            }
        }
        HorizontalDivider(color = OmpColors.Border)
        OutlinedTextField(query, { query = it }, label = { Text("Search skill directory") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        Button(enabled = !operation.pending && query.isNotBlank(), onClick = {
            coroutineScope.launch { operation.run {
                results = extensionRows(requester.request("extensions", "skills.search", JSONObject().put("query", query.trim()).put("limit", 20)).getJSONArray("results"))
                searched = true
            } }
        }) { Text("Search") }
        if (searched && results.isEmpty()) Text("No matching skills.", color = OmpColors.TextMuted)
        if (searched) Text("Directory search returns up to 20 matches. Refine your search to browse others.", color = OmpColors.TextMuted)
        results.forEach { result ->
            Text(result.getString("package"), color = OmpColors.Text)
            if (result.has("installs")) Text(result.getString("installs"), color = OmpColors.TextMuted)
            TextButton(onClick = { packageInput = result.getString("package") }, enabled = !operation.pending) { Text("Use this package") }
        }
        OutlinedTextField(packageInput, { packageInput = it }, label = { Text("Skill package") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        ExtensionScope(installScope, !operation.pending) { installScope = it }
        Button(enabled = !operation.pending && packageInput.isNotBlank(), onClick = {
            confirmation = "Install ${packageInput.trim()} in $installScope scope? Only install trusted skill sources." to JSONObject().put("package", packageInput.trim()).put("scope", installScope).put("action", "skills.install")
        }) { Text("Install skill") }
    }
    detail?.let { skill ->
        AlertDialog(onDismissRequest = { detail = null }, containerColor = OmpColors.BgPanel,
            title = { Text(skill.getString("name"), color = OmpColors.Text) },
            text = { Column(Modifier.heightIn(max = 480.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(skill.optString("description"), color = OmpColors.TextMuted)
                Text(skill.getString("filePath"), color = OmpColors.TextMuted)
                skill.optJSONObject("frontmatter")?.let { frontmatter -> SelectionContainer { Text(frontmatter.toString(2), color = OmpColors.TextMuted) } }
                SelectionContainer { Text(skill.getString("contentPreview"), color = OmpColors.Text) }
                if (skill.optBoolean("contentTruncated")) Text("The server returned a truncated skill preview.", color = OmpColors.TextMuted)
            } }, confirmButton = { TextButton(onClick = { detail = null }) { Text("Close") } })
    }
    confirmation?.let { (message, payload) ->
        AlertDialog(onDismissRequest = { if (!operation.pending) confirmation = null }, title = { Text("Confirm skill change") }, text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(message)
                operation.error?.let { Text(it, color = OmpColors.StatusError) }
            } },
            confirmButton = { TextButton(enabled = !operation.pending, onClick = {
                coroutineScope.launch { operation.run {
                    val args = JSONObject(payload.toString())
                    val action = args.getString("action")
                    args.remove("action")
                    requester.request("extensions", action, args.put("cwd", cwd))
                    updates = emptyList()
                    confirmation = null
                    operation.message = "Skill change completed."
                    load(offset)
                } }
            }) { Text("Confirm") } },
            dismissButton = { TextButton(enabled = !operation.pending, onClick = { confirmation = null }) { Text("Cancel") } })
    }
}

@Composable
private fun ExtensionPluginsSection(requester: RelayRequester, cwd: String) {
    val coroutineScope = rememberCoroutineScope()
    val operation = remember { ExtensionOperation() }
    var rows by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var total by remember { mutableStateOf(0) }
    var offset by remember { mutableStateOf(0) }
    var hasMore by remember { mutableStateOf(false) }
    var source by remember { mutableStateOf("") }
    var installScope by remember { mutableStateOf("project") }
    var confirmation by remember { mutableStateOf<JSONObject?>(null) }
    suspend fun load(page: Int) {
        val data = requester.request("extensions", "plugins.list", JSONObject().put("cwd", cwd).put("offset", page).put("limit", 25))
        rows = extensionRows(data.getJSONArray("packages"))
        total = data.getInt("total")
        offset = data.getInt("offset")
        hasMore = data.getBoolean("hasMore")
    }
    fun page(page: Int) { coroutineScope.launch { operation.run { load(page) } } }
    fun change(action: String, pluginSource: String?, scope: String) {
        confirmation = JSONObject().put("action", action).put("scope", scope).put("cwd", cwd).apply {
            if (pluginSource != null) put("source", pluginSource)
        }
    }
    LaunchedEffect(Unit) { operation.run { load(0) } }
    ExtensionSection("Plugins", operation) {
        TextButton(onClick = { page(offset) }, enabled = !operation.pending) { Text("Refresh plugins") }
        rows.forEach { row ->
            val pluginSource = row.getString("source")
            val scope = row.getString("scope")
            HorizontalDivider(color = OmpColors.Border)
            Text(pluginSource, color = OmpColors.Text, fontWeight = FontWeight.SemiBold)
            Text(listOf(scope, row.optString("status"), row.optString("version")).filter { it.isNotBlank() }.joinToString(" · "), color = OmpColors.TextMuted)
            TextButton(enabled = !operation.pending, onClick = { change(if (row.getBoolean("disabled")) "enable" else "disable", pluginSource, scope) }) {
                Text(if (row.getBoolean("disabled")) "Enable" else "Disable")
            }
            TextButton(enabled = !operation.pending, onClick = { change("update", pluginSource, scope) }) { Text("Update") }
            TextButton(enabled = !operation.pending, onClick = { change("remove", pluginSource, scope) }) { Text("Remove", color = OmpColors.StatusError) }
        }
        ExtensionPages(offset, rows.size, total, hasMore, operation.pending, ::page)
        OutlinedTextField(source, { source = it }, label = { Text("Plugin source (package or marketplace ID)") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        ExtensionScope(installScope, !operation.pending) { installScope = it }
        Button(enabled = !operation.pending && source.isNotBlank(), onClick = { change("install", source.trim(), installScope) }) { Text("Install plugin") }
        TextButton(enabled = !operation.pending, onClick = { change("update", null, installScope) }) { Text("Update all plugins in $installScope scope") }
    }
    confirmation?.let { args ->
        AlertDialog(onDismissRequest = { if (!operation.pending) confirmation = null },
            title = { Text("Confirm plugin ${args.getString("action")}") },
            text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("${args.optString("source", "All plugins")} · ${args.getString("scope")}")
                if (args.getString("action") == "install") Text("Plugins can execute code on the host. Install only sources you trust.")
                operation.error?.let { Text(it, color = OmpColors.StatusError) }
            } },
            confirmButton = { TextButton(enabled = !operation.pending, onClick = {
                coroutineScope.launch { operation.run {
                    requester.request("extensions", "plugins.action", args)
                    confirmation = null
                    operation.message = "Plugin ${args.getString("action")} completed."
                    load(offset)
                } }
            }) { Text("Confirm") } },
            dismissButton = { TextButton(enabled = !operation.pending, onClick = { confirmation = null }) { Text("Cancel") } })
    }
}
