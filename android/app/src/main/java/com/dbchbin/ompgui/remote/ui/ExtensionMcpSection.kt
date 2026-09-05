package com.dbchbin.ompgui.remote.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.dbchbin.ompgui.remote.relay.RelayRequestException
import com.dbchbin.ompgui.remote.relay.RelayRequester
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
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
    var inventory by remember { mutableStateOf<List<McpInventoryEntry>>(emptyList()) }
    var offset by remember { mutableStateOf(0) }
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
        hasMore = false
        error = null
        try {
            val data = requester.request("extensions", "mcp.list", JSONObject().put("cwd", cwd).put("offset", offset).put("limit", 25))
            val rows = data.getJSONArray("inventory")
            inventory = List(rows.length()) { index ->
                val row = rows.getJSONObject(index)
                McpInventoryEntry(row.getString("name"), row.getString("source"), row.getString("status"), row.optString("type"))
            }
            total = data.getInt("total")
            nextOffset = data.getInt("offset") + data.getInt("limit")
            hasMore = data.getBoolean("hasMore")
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            error = mcpFailure("Load MCP servers", failure)
        } finally {
            loading = false
        }
    }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("MCP servers", style = MaterialTheme.typography.titleMedium, color = OmpColors.Text)
        Text("Project servers can be edited here. User and discovered sources are read-only. Saved credentials are never downloaded.", color = OmpColors.TextMuted)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { draft = McpDraft() }, enabled = !opening && !deleting && cwd.isNotBlank()) { Text("Create server") }
            TextButton(onClick = { revision++ }, enabled = !loading && !opening && !deleting) { Text("Refresh") }
        }
        if (cwd.isBlank()) Text("Open a project to create or edit its MCP configuration.", color = OmpColors.TextMuted)
        if (loading || opening) LinearProgressIndicator(Modifier.fillMaxWidth())
        error?.let { Text(it, color = OmpColors.StatusError) }
        notice?.let { Text(it, color = OmpColors.StatusSuccess) }
        if (!loading && inventory.isEmpty() && error == null) Text("No MCP servers on this page.", color = OmpColors.TextMuted)
        inventory.forEach { entry ->
            Surface(color = OmpColors.BgPanel, shape = MaterialTheme.shapes.small) {
                Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(entry.name, color = OmpColors.Text, style = MaterialTheme.typography.titleSmall)
                    Text(listOf(entry.source, entry.status, entry.type).filter { it.isNotBlank() }.joinToString(" · "), color = OmpColors.TextMuted)
                    if (entry.source == "Project level") {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
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
                                        error = mcpFailure("Read server configuration", failure)
                                    } finally {
                                        opening = false
                                    }
                                }
                            }) { Text("View / edit") }
                            TextButton(enabled = !loading && !opening && !deleting, onClick = { deleteTarget = entry }) { Text("Delete", color = OmpColors.StatusError) }
                        }
                    } else {
                        Text("Read-only source — manage this server in its originating application or user configuration.", color = OmpColors.TextMuted)
                    }
                }
            }
        }
        if (!loading && error == null) Text(if (inventory.isEmpty()) "$total servers · page is empty" else "${offset + 1}–${offset + inventory.size} of $total servers", color = OmpColors.TextMuted)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = { offset = (offset - 25).coerceAtLeast(0) }, enabled = offset > 0 && !loading && !opening && !deleting) { Text("Previous") }
            TextButton(onClick = { offset = nextOffset }, enabled = hasMore && !loading && !opening && !deleting) { Text("Next") }
        }
    }
    draft?.let { initial ->
        McpEditor(requester, cwd, initial, onDismiss = { draft = null }, onSaved = {
            draft = null
            notice = "MCP server saved."
            offset = 0
            revision++
        })
    }
    deleteTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { if (!deleting) deleteTarget = null },
            title = { Text("Delete ${target.name}?") },
            text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("This removes the project server and its saved environment variables and headers. This cannot be undone.")
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
                        notice = "MCP server deleted."
                        offset = 0
                        revision++
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (failure: Exception) {
                        error = mcpFailure("Delete server", failure)
                    } finally {
                        deleting = false
                    }
                }
            }) { Text("Delete", color = OmpColors.StatusError) } },
            dismissButton = { TextButton(enabled = !deleting, onClick = { deleteTarget = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun McpEditor(requester: RelayRequester, cwd: String, initial: McpDraft, onDismiss: () -> Unit, onSaved: () -> Unit) {
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
                val server = mcpServerPayload(draft)
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
                    feedback = "Configuration is valid. Validation does not connect to the server or save changes."
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (invalid: McpInputException) {
                feedback = invalid.message
            } catch (failure: Exception) {
                feedback = mcpFailure(if (save) "Save server" else "Validate server", failure)
            } finally {
                busy = false
            }
        }
    }
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(if (draft.previousName == null) "Create MCP server" else "Edit MCP server") },
        text = {
            Column(Modifier.fillMaxWidth().heightIn(max = 520.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Project: $cwd", color = OmpColors.TextMuted)
                McpField(draft.name, { change(draft.copy(name = it)) }, "Name", !busy)
                if (draft.previousName != null && draft.name != draft.previousName) Text("Saving renames ${draft.previousName}; unchanged secrets are preserved.", color = OmpColors.TextMuted)
                Text("Transport", style = MaterialTheme.typography.titleSmall)
                McpChoices(listOf("stdio", "http", "sse"), draft.type, !busy) { change(draft.copy(type = it)) }
                if (draft.type == "stdio") {
                    McpField(draft.command, { change(draft.copy(command = it)) }, "Command", !busy)
                    Text("Arguments (one value per field, no shell splitting)")
                    draft.args.forEachIndexed { index, argument ->
                        McpField(argument, { text -> change(draft.copy(args = draft.args.toMutableList().also { it[index] = text })) }, "Argument ${index + 1}", !busy)
                        TextButton(enabled = !busy, onClick = { change(draft.copy(args = draft.args.filterIndexed { position, _ -> position != index })) }) { Text("Remove argument ${index + 1}") }
                    }
                    TextButton(enabled = !busy, onClick = { change(draft.copy(args = draft.args + "")) }) { Text("Add argument") }
                } else {
                    McpField(draft.url, { change(draft.copy(url = it)) }, "Server URL", !busy)
                }
                McpField(draft.serverCwd, { change(draft.copy(serverCwd = it)) }, "Server working directory (optional)", !busy)
                OutlinedTextField(value = draft.timeout, onValueChange = { change(draft.copy(timeout = it)) }, label = { Text("Timeout in milliseconds (optional)") }, enabled = !busy, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Enabled")
                    Switch(checked = draft.enabled, onCheckedChange = { change(draft.copy(enabled = it)) }, enabled = !busy)
                }
                Text("Request ID format")
                McpChoices(listOf("", "number", "string"), draft.requestIdFormat, !busy) { change(draft.copy(requestIdFormat = it)) }
                HorizontalDivider()
                McpSecrets("Environment variables", draft.env, !busy, { change(draft.copy(env = it)) }, { clearTarget = "env" })
                HorizontalDivider()
                McpSecrets("Headers", draft.headers, !busy, { change(draft.copy(headers = it)) }, { clearTarget = "headers" })
                if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                feedback?.let { Text(it, color = if (valid) OmpColors.StatusSuccess else OmpColors.StatusError) }
                TextButton(onClick = { submit(false) }, enabled = !busy) { Text("Validate configuration") }
            }
        },
        confirmButton = { Button(onClick = { submit(true) }, enabled = !busy) { Text(if (busy) "Working…" else "Save") } },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text("Cancel") } },
    )
    clearTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { clearTarget = null },
            title = { Text(if (target == "env") "Clear environment variables?" else "Clear headers?") },
            text = { Text("Saving will permanently remove all saved values in this secret map. The server may stop working. Nothing is removed until you save.") },
            confirmButton = { TextButton(onClick = {
                if (target == "env") change(draft.copy(env = draft.env.copy(intent = McpSecretIntent.Clear, input = "")))
                else change(draft.copy(headers = draft.headers.copy(intent = McpSecretIntent.Clear, input = "")))
                clearTarget = null
            }) { Text("Clear on save", color = OmpColors.StatusError) } },
            dismissButton = { TextButton(onClick = { clearTarget = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun McpField(value: String, onChange: (String) -> Unit, label: String, enabled: Boolean) {
    OutlinedTextField(value = value, onValueChange = onChange, label = { Text(label) }, enabled = enabled, singleLine = true, modifier = Modifier.fillMaxWidth())
}

@Composable
private fun McpChoices(options: List<String>, selected: String, enabled: Boolean, onSelect: (String) -> Unit) {
    Column(Modifier.selectableGroup()) {
        options.forEach { option ->
            Row(
                Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .selectable(selected = option == selected, enabled = enabled, role = Role.RadioButton, onClick = { onSelect(option) }),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RadioButton(selected = option == selected, onClick = null, enabled = enabled)
                Text(option.ifEmpty { "Default" })
            }
        }
    }
}

@Composable
private fun McpSecrets(label: String, value: McpSecretDraft, enabled: Boolean, onChange: (McpSecretDraft) -> Unit, onClear: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, style = MaterialTheme.typography.titleSmall)
        Text(if (value.configured) "Saved values: configured (hidden)" else "Saved values: not configured", color = OmpColors.TextMuted)
        Text(when (value.intent) {
            McpSecretIntent.Keep -> "Unchanged — saved values will be preserved."
            McpSecretIntent.Replace -> "Replace the entire map on save. Existing values cannot be revealed."
            McpSecretIntent.Clear -> "All saved values will be cleared on save."
        }, color = if (value.intent == McpSecretIntent.Clear) OmpColors.StatusWarning else OmpColors.TextMuted)
        TextButton(enabled = enabled, onClick = { onChange(value.copy(intent = McpSecretIntent.Keep, input = "")) }) { Text("Keep saved values") }
        TextButton(enabled = enabled, onClick = { onChange(value.copy(intent = McpSecretIntent.Replace)) }) { Text("Replace values") }
        if (value.intent == McpSecretIntent.Replace) {
            OutlinedTextField(
                value = value.input,
                onValueChange = { onChange(value.copy(input = it)) },
                label = { Text("New $label JSON object") },
                supportingText = { Text("Write-only string-to-string JSON map. Use Clear below to remove all values.") },
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                enabled = enabled,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        TextButton(enabled = enabled, onClick = onClear) { Text("Clear all saved values…", color = OmpColors.StatusError) }
    }
}

private class McpInputException(message: String) : Exception(message)

private fun mcpServerPayload(draft: McpDraft): JSONObject {
    if (draft.name.isBlank()) throw McpInputException("Enter a server name before validating or saving.")
    val server = JSONObject().put("type", draft.type).put("enabled", draft.enabled)
    if (draft.type == "stdio") {
        if (draft.command.isBlank()) throw McpInputException("Enter the command for a stdio server.")
        server.put("command", draft.command).put("args", JSONArray(draft.args))
    } else {
        if (draft.url.isBlank()) throw McpInputException("Enter the URL for an HTTP or SSE server.")
        server.put("url", draft.url)
    }
    if (draft.serverCwd.isNotBlank()) server.put("cwd", draft.serverCwd)
    if (draft.timeout.isNotBlank()) {
        val timeout = draft.timeout.toLongOrNull()
        if (timeout == null || timeout !in 0L..600_000L) throw McpInputException("Timeout must be a whole number from 0 to 600000 milliseconds.")
        server.put("timeout", timeout)
    }
    if (draft.requestIdFormat.isNotEmpty()) server.put("requestIdFormat", draft.requestIdFormat)
    for ((field, secret) in listOf("env" to draft.env, "headers" to draft.headers)) {
        when (secret.intent) {
            McpSecretIntent.Keep -> Unit // Redacted reads must never become a destructive empty write.
            McpSecretIntent.Clear -> server.put(field, JSONObject.NULL)
            McpSecretIntent.Replace -> {
                val values = try { JSONObject(secret.input) } catch (_: Exception) {
                    throw McpInputException("$field must be a JSON object with string values. Your input is retained and hidden.")
                }
                if (values.length() == 0) throw McpInputException("Use the confirmed Clear action to remove $field, or enter a non-empty replacement map.")
                val keys = values.keys()
                while (keys.hasNext()) {
                    if (values.get(keys.next()) !is String) throw McpInputException("Every $field value must be a JSON string. Your input is retained and hidden.")
                }
                server.put(field, values)
            }
        }
    }
    return server
}

private fun mcpFailure(action: String, failure: Exception): String {
    // Server/parser exception messages can include submitted secrets; never echo them.
    val guidance = when ((failure as? RelayRequestException)?.code) {
        "invalid_mcp", "invalid_args" -> "Check the name, transport, command or URL, timeout, and secret-map formats, then retry."
        "not_found", "mcp_not_found" -> "The server no longer exists. Refresh the inventory and try again."
        "forbidden", "path_not_allowed", "invalid_cwd" -> "Open an allowed project folder and check the desktop relay's file-access settings."
        "disconnected", "timeout" -> "Reconnect to the desktop relay, then retry."
        else -> "Check the desktop relay connection and project configuration permissions, then retry."
    }
    return "$action failed. $guidance Unsaved edits are retained."
}
