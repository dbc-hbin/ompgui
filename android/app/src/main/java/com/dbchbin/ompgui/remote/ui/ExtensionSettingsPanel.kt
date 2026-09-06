@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class, androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.dbchbin.ompgui.remote.ui

import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import com.dbchbin.ompgui.remote.R
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
        var selected by rememberSaveable { mutableStateOf(0) }
        val tabState = rememberSaveableStateHolder()
        val sections = listOf(
            stringResource(R.string.extension_tab_mcp),
            stringResource(R.string.extension_tab_skills),
            stringResource(R.string.extension_tab_plugins),
        )
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            ScrollableTabRow(selectedTabIndex = selected, containerColor = OmpColors.Bg, contentColor = OmpColors.Text, edgePadding = 0.dp) {
                sections.forEachIndexed { index, title ->
                    Tab(selected = selected == index, onClick = { selected = index }, modifier = Modifier.heightIn(min = 48.dp), text = { Text(title) })
                }
            }
            tabState.SaveableStateProvider(selected) {
                when (selected) {
                    0 -> ExtensionMcpSection(requester, cwd)
                    1 -> ExtensionSkillsSection(requester, cwd)
                    else -> ExtensionPluginsSection(requester, cwd)
                }
            }
        }
    }
}

private class ExtensionOperation {
    var pending by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var message by mutableStateOf<String?>(null)

    suspend fun run(fallbackError: String, block: suspend () -> Unit) {
        if (pending) return
        pending = true
        error = null
        message = null
        try {
            block()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            error = failure.message ?: fallbackError
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
        Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(title, color = OmpColors.Text, style = MaterialTheme.typography.titleMedium)
        if (operation.pending) Text(stringResource(R.string.extension_working), color = OmpColors.TextMuted)
        operation.error?.let { Text(it, color = OmpColors.StatusError) }
        operation.message?.let { Text(it, color = OmpColors.TextMuted) }
        content()
    }
}

@Composable
private fun ExtensionScope(value: String, enabled: Boolean, onChange: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.extension_installation_scope), color = OmpColors.TextMuted, modifier = Modifier.weight(1f))
        listOf("global", "project").forEach { scope ->
            FilterChip(selected = value == scope, onClick = { onChange(scope) }, enabled = enabled, label = { Text(scope) })
        }
    }
}

@Composable
private fun ExtensionPages(offset: Int, size: Int, total: Int, hasMore: Boolean, pending: Boolean, onPage: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(when {
            total == 0 -> stringResource(R.string.extension_no_entries)
            size == 0 -> stringResource(R.string.extension_no_entries_page, total)
            else -> stringResource(R.string.extension_pages_range, offset + 1, offset + size, total)
        }, color = OmpColors.TextMuted, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
        TextButton(onClick = { onPage((offset - 25).coerceAtLeast(0)) }, enabled = !pending && offset > 0) { Text(stringResource(R.string.extension_previous)) }
        TextButton(onClick = { onPage(offset + size) }, enabled = !pending && hasMore) { Text(stringResource(R.string.extension_next)) }
    }
}

@Composable
private fun ExtensionSkillsSection(requester: RelayRequester, cwd: String) {
    val coroutineScope = rememberCoroutineScope()
    val context = LocalContext.current
    val fallbackError = stringResource(R.string.extension_request_failed_retained)
    val operation = remember { ExtensionOperation() }
    var rows by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var total by remember { mutableStateOf(0) }
    var offset by remember { mutableStateOf(0) }
    var hasMore by remember { mutableStateOf(false) }
    var detail by remember { mutableStateOf<JSONObject?>(null) }
    var expandedSkill by rememberSaveable { mutableStateOf<String?>(null) }
    var query by rememberSaveable { mutableStateOf("") }
    var results by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var searched by remember { mutableStateOf(false) }
    var adding by rememberSaveable { mutableStateOf(false) }
    var packageInput by rememberSaveable { mutableStateOf("") }
    var installScope by rememberSaveable { mutableStateOf("project") }
    var updates by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var confirmation by remember { mutableStateOf<Pair<String, JSONObject>?>(null) }

    suspend fun load(page: Int) {
        val data = requester.request("extensions", "skills.list", JSONObject().put("cwd", cwd).put("offset", page).put("limit", 25))
        rows = extensionRows(data.getJSONArray("skills"))
        total = data.getInt("total")
        offset = data.getInt("offset")
        hasMore = data.getBoolean("hasMore")
    }
    fun page(page: Int) { coroutineScope.launch { operation.run(fallbackError) { load(page) } } }
    fun check(pkg: String? = null, scope: String? = null) {
        coroutineScope.launch {
            operation.run(fallbackError) {
                val args = JSONObject().put("cwd", cwd)
                if (pkg != null) args.put("package", pkg).put("scope", scope)
                updates = extensionRows(requester.request("extensions", "skills.check", args).getJSONArray("updates"))
                operation.message = if (updates.isEmpty()) context.getString(R.string.extension_skills_no_updates) else context.getString(R.string.extension_skills_check_done)
            }
        }
    }
    LaunchedEffect(Unit) { operation.run(fallbackError) { load(0) } }

    ExtensionSection(stringResource(R.string.extension_skills_title), operation) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = !adding, onClick = { adding = false }, label = { Text(stringResource(R.string.extension_installed)) })
            FilterChip(selected = adding, onClick = { adding = true }, label = { Text(stringResource(R.string.extension_skills_add)) })
        }
        if (!adding) {
        TextButton(onClick = { page(offset) }, enabled = !operation.pending) { Text(stringResource(R.string.extension_skills_refresh)) }
        rows.forEach { row ->
            HorizontalDivider(color = OmpColors.Border)
            val expanded = expandedSkill == row.getString("filePath")
            TextButton(onClick = { expandedSkill = if (expanded) null else row.getString("filePath") }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(row.getString("name"), color = OmpColors.Text, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(stringResource(R.string.extension_skills_scope_status, row.optString("scope"), if (row.getBoolean("disableModelInvocation")) stringResource(R.string.extension_skills_invocation_disabled) else stringResource(R.string.extension_skills_invocation_enabled)), color = OmpColors.TextMuted, style = MaterialTheme.typography.bodySmall)
                }
                Text(if (expanded) stringResource(R.string.extension_hide) else stringResource(R.string.extension_manage), color = OmpColors.TextMuted)
            }
            if (expanded) {
            Text(row.optString("description"), color = OmpColors.TextMuted)
            Text(listOf(row.optString("scope"), row.optString("source"), row.getString("filePath")).filter { it.isNotBlank() }.joinToString(" · "), color = OmpColors.TextMuted)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.extension_skills_allow_invocation), color = OmpColors.Text, modifier = Modifier.weight(1f))
                Switch(checked = !row.getBoolean("disableModelInvocation"), enabled = !operation.pending, onCheckedChange = { enabled ->
                    coroutineScope.launch { operation.run(fallbackError) {
                        requester.request("extensions", "skills.toggle", JSONObject().put("cwd", cwd).put("filePath", row.getString("filePath")).put("disableModelInvocation", !enabled))
                        load(offset)
                    } }
                })
            }
            TextButton(enabled = !operation.pending, onClick = {
                coroutineScope.launch { operation.run(fallbackError) {
                    detail = requester.request("extensions", "skills.get", JSONObject().put("cwd", cwd).put("filePath", row.getString("filePath")))
                } }
            }) { Text(stringResource(R.string.extension_skills_read_details)) }
            row.optJSONObject("install")?.let { install ->
                val pkg = install.optString("package")
                val scope = install.optString("scope")
                if (pkg.isNotBlank() && scope in listOf("global", "project")) {
                    Text(stringResource(R.string.extension_skills_pkg_scope, pkg, scope), color = OmpColors.TextMuted)
                    if (install.optBoolean("canCheckForUpdates")) {
                        TextButton(enabled = !operation.pending, onClick = { check(pkg, scope) }) { Text(stringResource(R.string.extension_skills_check_one)) }
                        TextButton(enabled = !operation.pending, onClick = {
                            confirmation = context.getString(R.string.extension_skills_confirm_update_scope, pkg, scope) to JSONObject().put("package", pkg).put("scope", scope).put("action", "skills.update")
                        }) { Text(stringResource(R.string.extension_skills_update)) }
                    } else Text(stringResource(R.string.extension_skills_auto_updates_unavailable), color = OmpColors.TextMuted)
                }
            }
            }
        }
        ExtensionPages(offset, rows.size, total, hasMore, operation.pending, ::page)
        TextButton(onClick = { check() }, enabled = !operation.pending) { Text(stringResource(R.string.extension_skills_check_all)) }
        updates.forEach { update ->
            Text(stringResource(R.string.extension_skills_pkg_scope, update.getString("package"), update.getString("scope")), color = OmpColors.Text)
            Text(update.getString("state"), color = OmpColors.TextMuted)
            if (update.has("currentVersion")) Text(stringResource(R.string.extension_skills_installed_version, update.optString("currentVersion")), color = OmpColors.TextMuted)
            if (update.has("latestVersion")) Text(stringResource(R.string.extension_skills_latest_version, update.optString("latestVersion")), color = OmpColors.TextMuted)
            if (update.has("message")) Text(update.optString("message"), color = OmpColors.TextMuted)
            if (update.getString("state") == "update-available") {
                TextButton(enabled = !operation.pending, onClick = {
                    confirmation = context.getString(R.string.extension_skills_confirm_update, update.getString("package")) to JSONObject().put("package", update.getString("package")).put("scope", update.getString("scope")).put("action", "skills.update")
                }) { Text(stringResource(R.string.extension_skills_apply_update)) }
            }
        }
        } else {
        Text(stringResource(R.string.extension_skills_find_hint), color = OmpColors.TextMuted)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(query, { query = it }, label = { Text(stringResource(R.string.extension_skills_search_label)) }, modifier = Modifier.weight(1f), singleLine = true)
        Button(shape = MaterialTheme.shapes.small, enabled = !operation.pending && query.isNotBlank(), onClick = {
            coroutineScope.launch { operation.run(fallbackError) {
                results = extensionRows(requester.request("extensions", "skills.search", JSONObject().put("query", query.trim()).put("limit", 20)).getJSONArray("results"))
                searched = true
            } }
        }) { Text(stringResource(R.string.extension_search)) }
        }
        if (searched && results.isEmpty()) Text(stringResource(R.string.extension_skills_no_matches), color = OmpColors.TextMuted)
        if (searched) Text(stringResource(R.string.extension_skills_search_limit_hint), color = OmpColors.TextMuted)
        results.forEach { result ->
            Text(result.getString("package"), color = OmpColors.Text)
            if (result.has("installs")) Text(result.getString("installs"), color = OmpColors.TextMuted)
            TextButton(onClick = { packageInput = result.getString("package") }, enabled = !operation.pending) { Text(stringResource(R.string.extension_skills_use_package)) }
        }
        OutlinedTextField(packageInput, { packageInput = it }, label = { Text(stringResource(R.string.extension_skills_package_label)) }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        ExtensionScope(installScope, !operation.pending) { installScope = it }
        Button(shape = MaterialTheme.shapes.small, enabled = !operation.pending && packageInput.isNotBlank(), onClick = {
            confirmation = context.getString(R.string.extension_skills_confirm_install, packageInput.trim(), installScope) to JSONObject().put("package", packageInput.trim()).put("scope", installScope).put("action", "skills.install")
        }) { Text(stringResource(R.string.extension_skills_install)) }
        }
    }
    detail?.let { skill ->
        AlertDialog(onDismissRequest = { detail = null }, containerColor = OmpColors.BgPanel,
            title = { OmpDialogSystemBars(); Text(skill.getString("name"), color = OmpColors.Text, maxLines = 2, overflow = TextOverflow.Ellipsis) },
            text = { Column(Modifier.heightIn(max = 480.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(skill.optString("description"), color = OmpColors.TextMuted)
                Text(skill.getString("filePath"), color = OmpColors.TextMuted)
                skill.optJSONObject("frontmatter")?.let { frontmatter -> SelectionContainer { Text(frontmatter.toString(2), color = OmpColors.TextMuted) } }
                SelectionContainer { Text(skill.getString("contentPreview"), color = OmpColors.Text) }
                if (skill.optBoolean("contentTruncated")) Text(stringResource(R.string.extension_skills_truncated_preview), color = OmpColors.TextMuted)
            } }, confirmButton = { TextButton(onClick = { detail = null }) { Text(stringResource(R.string.extension_close)) } })
    }
    confirmation?.let { (message, payload) ->
        AlertDialog(onDismissRequest = { if (!operation.pending) confirmation = null }, title = { OmpDialogSystemBars(); Text(stringResource(R.string.extension_skills_confirm_change)) }, text = { Column(Modifier.heightIn(max = 480.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(message)
                operation.error?.let { Text(it, color = OmpColors.StatusError) }
            } },
            confirmButton = { TextButton(enabled = !operation.pending, onClick = {
                coroutineScope.launch { operation.run(fallbackError) {
                    val args = JSONObject(payload.toString())
                    val action = args.getString("action")
                    args.remove("action")
                    requester.request("extensions", action, args.put("cwd", cwd))
                    updates = emptyList()
                    confirmation = null
                    operation.message = context.getString(R.string.extension_skills_change_done)
                    load(offset)
                } }
            }) { Text(stringResource(R.string.extension_confirm)) } },
            dismissButton = { TextButton(enabled = !operation.pending, onClick = { confirmation = null }) { Text(stringResource(R.string.extension_cancel)) } })
    }
}

@Composable
private fun ExtensionPluginsSection(requester: RelayRequester, cwd: String) {
    val coroutineScope = rememberCoroutineScope()
    val context = LocalContext.current
    val fallbackError = stringResource(R.string.extension_request_failed_retained)
    val operation = remember { ExtensionOperation() }
    var rows by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var total by remember { mutableStateOf(0) }
    var offset by remember { mutableStateOf(0) }
    var hasMore by remember { mutableStateOf(false) }
    var adding by rememberSaveable { mutableStateOf(false) }
    var source by rememberSaveable { mutableStateOf("") }
    var installScope by rememberSaveable { mutableStateOf("project") }
    var confirmation by remember { mutableStateOf<JSONObject?>(null) }
    suspend fun load(page: Int) {
        val data = requester.request("extensions", "plugins.list", JSONObject().put("cwd", cwd).put("offset", page).put("limit", 25))
        rows = extensionRows(data.getJSONArray("packages"))
        total = data.getInt("total")
        offset = data.getInt("offset")
        hasMore = data.getBoolean("hasMore")
    }
    fun page(page: Int) { coroutineScope.launch { operation.run(fallbackError) { load(page) } } }
    fun change(action: String, pluginSource: String?, scope: String) {
        confirmation = JSONObject().put("action", action).put("scope", scope).put("cwd", cwd).apply {
            if (pluginSource != null) put("source", pluginSource)
        }
    }
    LaunchedEffect(Unit) { operation.run(fallbackError) { load(0) } }
    ExtensionSection(stringResource(R.string.extension_plugins_title), operation) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = !adding, onClick = { adding = false }, label = { Text(stringResource(R.string.extension_installed)) })
            FilterChip(selected = adding, onClick = { adding = true }, label = { Text(stringResource(R.string.extension_plugins_add)) })
        }
        if (!adding) {
        TextButton(onClick = { page(offset) }, enabled = !operation.pending) { Text(stringResource(R.string.extension_plugins_refresh)) }
        rows.forEach { row ->
            val pluginSource = row.getString("source")
            val scope = row.getString("scope")
            HorizontalDivider(color = OmpColors.Border)
            Text(pluginSource, color = OmpColors.Text, style = MaterialTheme.typography.titleSmall)
            Text(listOf(scope, row.optString("status"), row.optString("version")).filter { it.isNotBlank() }.joinToString(" · "), color = OmpColors.TextMuted)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(enabled = !operation.pending, onClick = { change(if (row.getBoolean("disabled")) "enable" else "disable", pluginSource, scope) }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(if (row.getBoolean("disabled")) stringResource(R.string.extension_enable) else stringResource(R.string.extension_disable))
                }
                TextButton(enabled = !operation.pending, onClick = { change("update", pluginSource, scope) }, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.extension_update)) }
                TextButton(enabled = !operation.pending, onClick = { change("remove", pluginSource, scope) }, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.extension_remove), color = OmpColors.StatusError) }
            }
        }
        ExtensionPages(offset, rows.size, total, hasMore, operation.pending, ::page)
        ExtensionScope(installScope, !operation.pending) { installScope = it }
        TextButton(enabled = !operation.pending, onClick = { change("update", null, installScope) }) { Text(stringResource(R.string.extension_plugins_update_all, installScope)) }
        } else {
        Text(stringResource(R.string.extension_plugins_trust_hint), color = OmpColors.TextMuted)
        OutlinedTextField(source, { source = it }, label = { Text(stringResource(R.string.extension_plugins_source_label)) }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        ExtensionScope(installScope, !operation.pending) { installScope = it }
        Button(shape = MaterialTheme.shapes.small, enabled = !operation.pending && source.isNotBlank(), onClick = { change("install", source.trim(), installScope) }) { Text(stringResource(R.string.extension_plugins_install)) }
        }
    }
    confirmation?.let { args ->
        AlertDialog(onDismissRequest = { if (!operation.pending) confirmation = null },
            title = { OmpDialogSystemBars(); Text(stringResource(R.string.extension_plugins_confirm_action, args.getString("action"))) },
            text = { Column(Modifier.heightIn(max = 480.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.extension_plugins_source_scope, args.optString("source", context.getString(R.string.extension_plugins_all)), args.getString("scope")))
                if (args.getString("action") == "install") Text(stringResource(R.string.extension_plugins_install_warning))
                operation.error?.let { Text(it, color = OmpColors.StatusError) }
            } },
            confirmButton = { TextButton(enabled = !operation.pending, onClick = {
                coroutineScope.launch { operation.run(fallbackError) {
                    requester.request("extensions", "plugins.action", args)
                    confirmation = null
                    operation.message = context.getString(R.string.extension_plugins_action_done, args.getString("action"))
                    load(offset)
                } }
            }) { Text(stringResource(R.string.extension_confirm)) } },
            dismissButton = { TextButton(enabled = !operation.pending, onClick = { confirmation = null }) { Text(stringResource(R.string.extension_cancel)) } })
    }
}
