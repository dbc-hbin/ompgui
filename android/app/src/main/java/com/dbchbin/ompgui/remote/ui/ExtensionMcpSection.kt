@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package com.dbchbin.ompgui.remote.ui

import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.FilterChip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.saveable.rememberSaveable
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
import android.content.res.Resources
import com.dbchbin.ompgui.remote.R
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.dbchbin.ompgui.remote.relay.RelayRequestException
import com.dbchbin.ompgui.remote.relay.RelayRequester
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import org.json.JSONArray
import org.json.JSONObject

private data class McpInventoryEntry(val name: String, val source: String, val status: String, val type: String)
private enum class McpSecretIntent { Keep, Replace, Clear }
private data class McpSecretDraft(
    val configured: Boolean = false,
    val intent: McpSecretIntent = McpSecretIntent.Keep,
    val input: String = "",
)
private data class McpDraft(
    val previousName: String? = null,
    val name: String = "",
    val type: String = "stdio",
    val command: String = "",
    val url: String = "",
    val args: List<String> = emptyList(),
    val serverCwd: String = "",
    val timeout: String = "",
    val enabled: Boolean = true,
    val requestIdFormat: String = "",
    val env: McpSecretDraft = McpSecretDraft(),
    val headers: McpSecretDraft = McpSecretDraft(),
)

@Composable
fun ExtensionMcpSection(requester: RelayRequester, cwd: String) {
    key(requester, cwd) { McpSectionContent(requester, cwd) }
}

@Composable
private fun McpSectionContent(requester: RelayRequester, cwd: String) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val resources = context.resources
    var inventory by remember { mutableStateOf<List<McpInventoryEntry>>(emptyList()) }
    var liveServers by remember { mutableStateOf<List<McpInventoryEntry>?>(null) }
    var liveTotal by remember { mutableStateOf(0) }
    var liveError by remember { mutableStateOf<String?>(null) }
    var sessionId by remember { mutableStateOf<String?>(null) }
    var offset by rememberSaveable { mutableStateOf(0) }
    var total by remember { mutableStateOf(0) }
    var nextOffset by remember { mutableStateOf(0) }
    var hasMore by remember { mutableStateOf(false) }
    var revision by remember { mutableStateOf(0) }
    var loading by remember { mutableStateOf(true) }
    var opening by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var draft by remember { mutableStateOf<McpDraft?>(null) }
    var deleteTarget by remember { mutableStateOf<McpInventoryEntry?>(null) }
    var deleting by remember { mutableStateOf(false) }

    LaunchedEffect(offset, revision) {
        loading = true
        inventory = emptyList()
        liveServers = null
        liveTotal = 0
        liveError = null
        sessionId = null
        hasMore = false
        error = null
        try {
            val data = requester.request("extensions", "mcp.list", JSONObject().put("cwd", cwd).put("offset", offset).put("limit", 25))
            currentCoroutineContext().ensureActive()
            sessionId = data.optString("sessionId").takeIf { !data.isNull("sessionId") && it.isNotBlank() }
            liveError = data.optString("liveError").takeIf { it.isNotBlank() }
            val liveRows = data.optJSONArray("liveServers")
            liveTotal = liveRows?.length() ?: 0
            liveServers = liveRows?.let { rows ->
                List(rows.length().coerceAtMost(100)) { index ->
                    val row = rows.getJSONObject(index)
                    McpInventoryEntry(row.getString("name"), row.getString("source"), row.getString("status"), row.optString("type"))
                }
            }
            val rows = data.getJSONArray("inventory")
            inventory = List(rows.length().coerceAtMost(25)) { index ->
                val row = rows.getJSONObject(index)
                McpInventoryEntry(row.getString("name"), row.getString("source"), row.getString("status"), row.optString("type"))
            }
            total = data.getInt("total")
            nextOffset = data.getInt("offset") + data.getInt("limit")
            hasMore = data.getBoolean("hasMore")
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            currentCoroutineContext().ensureActive()
            error = mcpFailure(resources, context.getString(R.string.extension_mcp_action_load), failure)
        } finally {
            currentCoroutineContext().ensureActive()
            loading = false
        }
    }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(stringResource(R.string.extension_mcp_title), style = MaterialTheme.typography.titleMedium, color = OmpColors.Text, modifier = Modifier.weight(1f))
            Button(onClick = { draft = McpDraft() }, enabled = !opening && !deleting && cwd.isNotBlank(), shape = MaterialTheme.shapes.small) { Text(stringResource(R.string.extension_mcp_create)) }
            androidx.compose.material3.IconButton(onClick = { revision++ }, enabled = !loading && !opening && !deleting) {
                androidx.compose.material3.Icon(androidx.compose.material.icons.Icons.Default.Refresh, stringResource(R.string.extension_refresh), Modifier.size(20.dp))
            }
        }
        Text(stringResource(R.string.extension_mcp_intro), color = OmpColors.TextMuted, style = MaterialTheme.typography.bodySmall)
        if (cwd.isBlank()) Text(stringResource(R.string.extension_mcp_need_project), color = OmpColors.TextMuted)
        if (loading || opening) LinearProgressIndicator(Modifier.fillMaxWidth())
        error?.let { Text(it, color = OmpColors.StatusError) }
        notice?.let { Text(it, color = OmpColors.StatusSuccess) }
        Text(stringResource(R.string.extension_mcp_session_runtime), style = MaterialTheme.typography.titleSmall, color = OmpColors.Text)
        if (!loading && error == null) {
            Text(sessionId?.let { stringResource(R.string.extension_mcp_current_session, it) } ?: stringResource(R.string.extension_mcp_no_session), color = OmpColors.TextMuted)
            liveError?.let { Text(it, color = OmpColors.StatusError) }
            liveServers?.let { servers ->
                if (servers.isEmpty()) Text(stringResource(R.string.extension_mcp_runtime_empty), color = OmpColors.TextMuted)
                servers.forEach { entry ->
                    val status = when (entry.status) {
                        "connected" -> stringResource(R.string.extension_mcp_status_connected)
                        "not_connected" -> stringResource(R.string.extension_mcp_status_not_connected)
                        "connecting" -> stringResource(R.string.extension_mcp_status_connecting)
                        "inactive" -> stringResource(R.string.extension_mcp_status_inactive)
                        "disabled" -> stringResource(R.string.extension_mcp_status_disabled)
                        else -> stringResource(R.string.extension_mcp_status_unknown)
                    }
                    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(entry.name, color = OmpColors.Text, style = MaterialTheme.typography.titleSmall)
                        val line = if (entry.type.isNotBlank()) stringResource(R.string.extension_mcp_status_line_typed, status, entry.source, entry.type)
                        else stringResource(R.string.extension_mcp_status_line, status, entry.source)
                        Text(line, color = if (entry.status == "connected") OmpColors.StatusSuccess else OmpColors.TextMuted, style = MaterialTheme.typography.bodySmall)
                    }
                }
                if (liveTotal > servers.size) Text(stringResource(R.string.extension_mcp_showing_runtime, servers.size, liveTotal), color = OmpColors.TextMuted)
            }
        }
        HorizontalDivider(color = OmpColors.Border)
        Text(stringResource(R.string.extension_mcp_configured_title), style = MaterialTheme.typography.titleSmall, color = OmpColors.Text)
        Text(stringResource(R.string.extension_mcp_configured_hint), color = OmpColors.TextMuted)
        if (!loading && inventory.isEmpty() && error == null) Text(stringResource(R.string.extension_mcp_configured_empty), color = OmpColors.TextMuted)
        inventory.forEach { entry ->
            Column {
                HorizontalDivider(color = OmpColors.Border)
                Column(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(entry.name, color = OmpColors.Text, style = MaterialTheme.typography.titleSmall)
                    Text(listOf(entry.source, entry.status, entry.type).filter { it.isNotBlank() }.joinToString(" · "), color = OmpColors.TextMuted, style = MaterialTheme.typography.bodySmall)
                    if (entry.source == "Project level") {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            TextButton(enabled = !loading && !opening && !deleting, onClick = {
                                scope.launch {
                                    opening = true
                                    error = null
                                    try {
                                        val data = requester.request("extensions", "mcp.get", JSONObject().put("cwd", cwd).put("name", entry.name))
                                        val config = data.getJSONObject("config")
                                        val arguments = config.optJSONArray("args")
                                        draft = McpDraft(
                                            previousName = data.getString("name"),
                                            name = data.getString("name"),
                                            type = config.optString("type", entry.type),
                                            command = config.optString("command"),
                                            url = config.optString("url"),
                                            args = if (arguments == null) emptyList() else List(arguments.length()) { arguments.getString(it) },
                                            serverCwd = config.optString("cwd"),
                                            timeout = if (config.has("timeout")) config.get("timeout").toString() else "",
                                            enabled = config.optBoolean("enabled", true),
                                            requestIdFormat = config.optString("requestIdFormat"),
                                            env = McpSecretDraft(data.getBoolean("envConfigured")),
                                            headers = McpSecretDraft(data.getBoolean("headersConfigured")),
                                        )
                                    } catch (cancelled: CancellationException) {
                                        throw cancelled
                                    } catch (failure: Exception) {
                                        error = mcpFailure(resources, context.getString(R.string.extension_mcp_action_read), failure)
                                    } finally {
                                        opening = false
                                    }
                                }
                            }) { Text(stringResource(R.string.extension_view_edit)) }
                            TextButton(enabled = !loading && !opening && !deleting, onClick = { deleteTarget = entry }) { Text(stringResource(R.string.extension_delete), color = OmpColors.StatusError) }
                        }
                    } else {
                        Text(stringResource(R.string.extension_mcp_readonly), color = OmpColors.TextMuted, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
        if (!loading && error == null) Text(if (inventory.isEmpty()) stringResource(R.string.extension_mcp_page_empty, total) else stringResource(R.string.extension_mcp_page_range, offset + 1, offset + inventory.size, total), color = OmpColors.TextMuted)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = { offset = (offset - 25).coerceAtLeast(0) }, enabled = offset > 0 && !loading && !opening && !deleting) { Text(stringResource(R.string.extension_previous)) }
            TextButton(onClick = { offset = nextOffset }, enabled = hasMore && !loading && !opening && !deleting) { Text(stringResource(R.string.extension_next)) }
        }
    }
    draft?.let { initial ->
        McpEditor(requester, cwd, initial, onDismiss = { draft = null }, onSaved = {
            draft = null
            notice = context.getString(R.string.extension_mcp_saved)
            offset = 0
            revision++
        })
    }
    deleteTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { if (!deleting) deleteTarget = null },
            title = { OmpDialogSystemBars(); Text(stringResource(R.string.extension_mcp_delete_title)) },
            text = { Column(Modifier.heightIn(max = 480.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.extension_mcp_delete_message, target.name))
                error?.let { Text(it, color = OmpColors.StatusError) }
                if (deleting) LinearProgressIndicator(Modifier.fillMaxWidth())
            } },
            confirmButton = { TextButton(enabled = !deleting, onClick = {
                scope.launch {
                    deleting = true
                    error = null
                    try {
                        requester.request("extensions", "mcp.delete", JSONObject().put("cwd", cwd).put("name", target.name))
                        deleteTarget = null
                        notice = context.getString(R.string.extension_mcp_deleted)
                        offset = 0
                        revision++
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (failure: Exception) {
                        error = mcpFailure(resources, context.getString(R.string.extension_mcp_delete_server), failure)
                    } finally {
                        deleting = false
                    }
                }
            }) { Text(stringResource(R.string.extension_delete), color = OmpColors.StatusError) } },
            dismissButton = { TextButton(enabled = !deleting, onClick = { deleteTarget = null }) { Text(stringResource(R.string.extension_cancel)) } },
        )
    }
}

@Composable
private fun McpEditor(requester: RelayRequester, cwd: String, initial: McpDraft, onDismiss: () -> Unit, onSaved: () -> Unit) {
    val context = LocalContext.current
    val resources = context.resources
    var draft by remember { mutableStateOf(initial) }
    var busy by remember { mutableStateOf(false) }
    var feedback by remember { mutableStateOf<String?>(null) }
    var valid by remember { mutableStateOf(false) }
    var clearTarget by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    fun change(value: McpDraft) {
        draft = value
        feedback = null
        valid = false
    }
    fun submit(save: Boolean) {
        scope.launch {
            busy = true
            feedback = null
            valid = false
            try {
                val server = mcpServerPayload(resources, draft)
                val args = JSONObject().put("name", draft.name.trim()).put("server", server)
                if (save) {
                    args.put("cwd", cwd)
                    draft.previousName?.let { args.put("previousName", it) }
                    requester.request("extensions", "mcp.save", args)
                    onSaved()
                } else {
                    val result = requester.request("extensions", "mcp.validate", args)
                    check(result.getBoolean("ok"))
                    valid = true
                    feedback = context.getString(R.string.extension_mcp_validate_ok)
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (invalid: McpInputException) {
                feedback = invalid.message
            } catch (failure: Exception) {
                feedback = mcpFailure(resources, context.getString(if (save) R.string.extension_mcp_save_server else R.string.extension_mcp_validate_server), failure)
            } finally {
                busy = false
            }
        }
    }
    OmpModalSheet(
        onDismissRequest = { if (!busy) onDismiss() },
        fullHeight = true,
        containerColor = OmpColors.BgPanel,
    ) {
        Column(Modifier.fillMaxWidth().weight(1f).padding(horizontal = 16.dp).padding(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(if (draft.previousName == null) stringResource(R.string.extension_mcp_create_title) else stringResource(R.string.extension_mcp_edit_title), maxLines = 2, overflow = TextOverflow.Ellipsis)
            Column(Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.extension_mcp_project, cwd), color = OmpColors.TextMuted)
                McpField(draft.name, { change(draft.copy(name = it)) }, stringResource(R.string.extension_mcp_name), !busy)
                if (draft.previousName != null && draft.name != draft.previousName) Text(stringResource(R.string.extension_mcp_rename_note, draft.previousName!!), color = OmpColors.TextMuted)
                McpChoices(stringResource(R.string.extension_mcp_transport), listOf("stdio", "http", "sse"), draft.type, !busy) { change(draft.copy(type = it)) }
                if (draft.type == "stdio") {
                    McpField(draft.command, { change(draft.copy(command = it)) }, stringResource(R.string.extension_mcp_command), !busy)
                    Text(stringResource(R.string.extension_mcp_args_hint))
                    draft.args.forEachIndexed { index, argument ->
                        McpField(argument, { text -> change(draft.copy(args = draft.args.toMutableList().also { it[index] = text })) }, stringResource(R.string.extension_mcp_argument_n, index + 1), !busy)
                        TextButton(enabled = !busy, onClick = { change(draft.copy(args = draft.args.filterIndexed { position, _ -> position != index })) }) { Text(stringResource(R.string.extension_mcp_remove_argument_n, index + 1)) }
                    }
                    TextButton(enabled = !busy, onClick = { change(draft.copy(args = draft.args + "")) }) { Text(stringResource(R.string.extension_mcp_add_argument)) }
                } else {
                    McpField(draft.url, { change(draft.copy(url = it)) }, stringResource(R.string.extension_mcp_server_url), !busy)
                }
                HorizontalDivider(color = OmpColors.Border)
                Text(stringResource(R.string.extension_mcp_connection_options), style = MaterialTheme.typography.titleSmall, color = OmpColors.Text)
                McpField(draft.serverCwd, { change(draft.copy(serverCwd = it)) }, stringResource(R.string.extension_mcp_server_cwd), !busy)
                OutlinedTextField(value = draft.timeout, onValueChange = { change(draft.copy(timeout = it)) }, label = { Text(stringResource(R.string.extension_mcp_timeout)) }, enabled = !busy, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(stringResource(R.string.extension_mcp_enabled), modifier = Modifier.weight(1f))
                    Switch(checked = draft.enabled, onCheckedChange = { change(draft.copy(enabled = it)) }, enabled = !busy)
                }
                McpChoices(stringResource(R.string.extension_mcp_request_id_format), listOf("", "number", "string"), draft.requestIdFormat, !busy) { change(draft.copy(requestIdFormat = it)) }
                HorizontalDivider()
                McpSecrets(stringResource(R.string.extension_mcp_env), draft.env, !busy, { change(draft.copy(env = it)) }, { clearTarget = "env" })
                HorizontalDivider()
                McpSecrets(stringResource(R.string.extension_mcp_headers), draft.headers, !busy, { change(draft.copy(headers = it)) }, { clearTarget = "headers" })
                if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                feedback?.let { Text(it, color = if (valid) OmpColors.StatusSuccess else OmpColors.StatusError) }
                TextButton(onClick = { submit(false) }, enabled = !busy) { Text(stringResource(R.string.extension_mcp_validate_config)) }
            }
            FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                TextButton(onClick = onDismiss, enabled = !busy) { Text(stringResource(R.string.extension_cancel)) }
                Button(onClick = { submit(true) }, enabled = !busy, shape = MaterialTheme.shapes.small) { Text(if (busy) stringResource(R.string.extension_working) else stringResource(R.string.extension_save)) }
            }
        }
    }
    clearTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { clearTarget = null },
            title = { OmpDialogSystemBars(); Text(if (target == "env") stringResource(R.string.extension_mcp_clear_env_title) else stringResource(R.string.extension_mcp_clear_headers_title)) },
            text = { Text(stringResource(R.string.extension_mcp_clear_secret_body), modifier = Modifier.heightIn(max = 480.dp).verticalScroll(rememberScrollState())) },
            confirmButton = { TextButton(onClick = {
                if (target == "env") change(draft.copy(env = draft.env.copy(intent = McpSecretIntent.Clear, input = "")))
                else change(draft.copy(headers = draft.headers.copy(intent = McpSecretIntent.Clear, input = "")))
                clearTarget = null
            }) { Text(stringResource(R.string.extension_mcp_clear_on_save), color = OmpColors.StatusError) } },
            dismissButton = { TextButton(onClick = { clearTarget = null }) { Text(stringResource(R.string.extension_cancel)) } },
        )
    }
}

@Composable
private fun McpField(value: String, onChange: (String) -> Unit, label: String, enabled: Boolean) {
    OutlinedTextField(value = value, onValueChange = onChange, label = { Text(label) }, enabled = enabled, singleLine = true, textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace), modifier = Modifier.fillMaxWidth())
}

@Composable
private fun McpChoices(label: String, options: List<String>, selected: String, enabled: Boolean, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, modifier = Modifier.weight(1f), color = OmpColors.TextMuted)
        androidx.compose.foundation.layout.Box {
            TextButton(onClick = { expanded = true }, enabled = enabled, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(selected.ifEmpty { stringResource(R.string.extension_default) }, color = OmpColors.Text)
                androidx.compose.material3.Icon(androidx.compose.material.icons.Icons.Default.ExpandMore, stringResource(R.string.extension_choose_label, label), Modifier.size(20.dp))
            }
            androidx.compose.material3.DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                options.forEach { option ->
                    androidx.compose.material3.DropdownMenuItem(text = { Text(option.ifEmpty { stringResource(R.string.extension_default) }) }, onClick = { expanded = false; onSelect(option) })
                }
            }
        }
    }
}

@Composable
private fun McpSecrets(label: String, value: McpSecretDraft, enabled: Boolean, onChange: (McpSecretDraft) -> Unit, onClear: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, style = MaterialTheme.typography.titleSmall)
        Text(if (value.configured) stringResource(R.string.extension_mcp_secrets_configured) else stringResource(R.string.extension_mcp_secrets_not_configured), color = OmpColors.TextMuted)
        Text(when (value.intent) {
            McpSecretIntent.Keep -> stringResource(R.string.extension_mcp_secrets_keep)
            McpSecretIntent.Replace -> stringResource(R.string.extension_mcp_secrets_replace)
            McpSecretIntent.Clear -> stringResource(R.string.extension_mcp_secrets_clear)
        }, color = if (value.intent == McpSecretIntent.Clear) OmpColors.StatusWarning else OmpColors.TextMuted)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = value.intent == McpSecretIntent.Keep, enabled = enabled, onClick = { onChange(value.copy(intent = McpSecretIntent.Keep, input = "")) }, label = { Text(stringResource(R.string.extension_mcp_keep_saved)) })
            FilterChip(selected = value.intent == McpSecretIntent.Replace, enabled = enabled, onClick = { onChange(value.copy(intent = McpSecretIntent.Replace)) }, label = { Text(stringResource(R.string.extension_mcp_replace)) })
        }
        if (value.intent == McpSecretIntent.Replace) {
            OutlinedTextField(
                value = value.input,
                onValueChange = { onChange(value.copy(input = it)) },
                label = { Text(stringResource(R.string.extension_mcp_new_json, label)) },
                supportingText = { Text(stringResource(R.string.extension_mcp_secret_supporting)) },
                visualTransformation = PasswordVisualTransformation(),
                minLines = 3,
                maxLines = 8,
                textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                enabled = enabled,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        TextButton(enabled = enabled, onClick = onClear) { Text(stringResource(R.string.extension_mcp_clear_all), color = OmpColors.StatusError) }
    }
}

private class McpInputException(message: String) : Exception(message)

private fun mcpServerPayload(resources: Resources, draft: McpDraft): JSONObject {
    if (draft.name.isBlank()) throw McpInputException(resources.getString(R.string.extension_mcp_err_name))
    val server = JSONObject().put("type", draft.type).put("enabled", draft.enabled)
    if (draft.type == "stdio") {
        if (draft.command.isBlank()) throw McpInputException(resources.getString(R.string.extension_mcp_err_command))
        server.put("command", draft.command).put("args", JSONArray(draft.args))
    } else {
        if (draft.url.isBlank()) throw McpInputException(resources.getString(R.string.extension_mcp_err_url))
        server.put("url", draft.url)
    }
    if (draft.serverCwd.isNotBlank()) server.put("cwd", draft.serverCwd)
    if (draft.timeout.isNotBlank()) {
        val timeout = draft.timeout.toLongOrNull()
        if (timeout == null || timeout !in 0L..600_000L) throw McpInputException(resources.getString(R.string.extension_mcp_err_timeout))
        server.put("timeout", timeout)
    }
    if (draft.requestIdFormat.isNotEmpty()) server.put("requestIdFormat", draft.requestIdFormat)
    for ((field, secret) in listOf("env" to draft.env, "headers" to draft.headers)) {
        when (secret.intent) {
            McpSecretIntent.Keep -> Unit // Redacted reads must never become a destructive empty write.
            McpSecretIntent.Clear -> server.put(field, JSONObject.NULL)
            McpSecretIntent.Replace -> {
                val values = try { JSONObject(secret.input) } catch (_: Exception) {
                    throw McpInputException(resources.getString(R.string.extension_mcp_err_json_object, field))
                }
                if (values.length() == 0) throw McpInputException(resources.getString(R.string.extension_mcp_err_use_clear, field))
                val keys = values.keys()
                while (keys.hasNext()) {
                    if (values.get(keys.next()) !is String) throw McpInputException(resources.getString(R.string.extension_mcp_err_json_string, field))
                }
                server.put(field, values)
            }
        }
    }
    return server
}

private fun mcpFailure(resources: Resources, action: String, failure: Exception): String {
    // Server/parser exception messages can include submitted secrets; never echo them.
    val guidance = when ((failure as? RelayRequestException)?.code) {
        "invalid_mcp", "invalid_args" -> resources.getString(R.string.extension_mcp_guide_invalid)
        "not_found", "mcp_not_found" -> resources.getString(R.string.extension_mcp_guide_not_found)
        "forbidden", "path_not_allowed", "invalid_cwd" -> resources.getString(R.string.extension_mcp_guide_forbidden)
        "disconnected", "timeout" -> resources.getString(R.string.extension_mcp_guide_disconnected)
        else -> resources.getString(R.string.extension_mcp_guide_generic)
    }
    return resources.getString(R.string.extension_mcp_failed, action, guidance)
}
