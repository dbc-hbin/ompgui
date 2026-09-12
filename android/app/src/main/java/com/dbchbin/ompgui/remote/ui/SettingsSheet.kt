package com.dbchbin.ompgui.remote.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.dbchbin.ompgui.remote.R
import com.dbchbin.ompgui.remote.net.ConnectionState
import com.dbchbin.ompgui.remote.relay.ModelRef
import com.dbchbin.ompgui.remote.relay.RelayRequester
import com.dbchbin.ompgui.remote.store.AppPreferences
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

private data class SettingsMutation(
    val path: String,
    val value: Any? = null,
    val reset: Boolean = false,
    val secret: String? = null,
    val clearSecret: Boolean = false,
)

private data class LocalField(
    val path: String,
    val kind: String = "boolean",
    val choices: List<String> = emptyList(),
)

private data class CatalogDraft(
    val value: String,
    val error: String? = null,
    val secret: String = "",
    val arrayAddition: String = "",
    val dirty: Boolean = false,
)

private data class CatalogDraftKey(val scope: String, val cwd: String, val path: String)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsSheet(
    requester: RelayRequester,
    serverUrl: String,
    connection: ConnectionState,
    currentModel: ModelRef?,
    onUnpair: () -> Unit,
    onDismiss: () -> Unit,
    @Suppress("UNUSED_PARAMETER") settings: JSONObject? = null,
    deviceId: String = "",
    settingsCwd: String = "",
) {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    val korean = context.resources.configuration.locales[0].language == "ko"
    var selectedScope by rememberSaveable(settingsCwd) { mutableStateOf("global") }
    var snapshot by remember { mutableStateOf<NativeSettingsSnapshot?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var query by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf("browse") }
    var confirmation by remember { mutableStateOf<Pair<String, () -> Unit>?>(null) }
    var showUsage by remember { mutableStateOf(false) }
    // Deliberately not saveable: this owner survives filtering/collapse/category changes,
    // while write-only credentials never enter Android saved-instance-state Bundles.
    val catalogDrafts = remember { mutableStateMapOf<CatalogDraftKey, CatalogDraft>() }

    fun hasDirtyDrafts(scope: String = selectedScope, cwd: String = settingsCwd) =
        catalogDrafts.any { (key, draft) -> draft.dirty && key.scope == scope && key.cwd == cwd }
    fun discardDrafts(scope: String = selectedScope, cwd: String = settingsCwd) {
        catalogDrafts.keys.filter { it.scope == scope && it.cwd == cwd }.forEach(catalogDrafts::remove)
    }

    val fixedCategories = listOf("browse", "general", "roles", "providers", "models", "intelligence", "agents", "tools", "safety", "administrator", "system")

    fun requestArgs(): JSONObject = JSONObject().put("scope", selectedScope).apply {
        if (selectedScope == "project") put("cwd", settingsCwd)
    }
    fun switchScope(next: String) {
        if (next == selectedScope) return
        val switch = { discardDrafts(); snapshot = null; selectedScope = next }
        if (hasDirtyDrafts()) {
            confirmation = context.getString(R.string.settings_unsaved_scope_change) to switch
        } else switch()
    }
    fun refresh() {
        val action: () -> Unit = { reload++; Unit }
        if (hasDirtyDrafts()) confirmation = context.getString(R.string.settings_unsaved_refresh) to action else action()
    }
    fun requestDismiss() {
        val action = { discardDrafts(); onDismiss() }
        if (hasDirtyDrafts()) confirmation = context.getString(R.string.settings_unsaved_dismiss) to action else action()
    }
    suspend fun load() {
        busy = true
        error = null
        try {
            snapshot = parseNativeSettingsSnapshot(requester.request("system", "settings.get", requestArgs()))
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            error = failure.message ?: context.getString(R.string.settings_load_failed)
        } finally {
            busy = false
        }
    }
    fun mutate(mutation: SettingsMutation, confirmed: Boolean = false, onSuccess: () -> Unit = {}) {
        if (busy) return
        val definition = snapshot?.catalog?.firstOrNull { it.path == mutation.path } ?: return
        val action = {
            coroutineScope.launch {
                busy = true
                error = null
                notice = null
                try {
                    val args = requestArgs()
                    when {
                        mutation.reset -> args.put("reset", JSONArray().put(mutation.path))
                        definition.secret -> args.put("secrets", JSONObject().put(mutation.path, if (mutation.clearSecret) JSONObject.NULL else mutation.secret))
                        else -> args.put("settings", nestedSettingsPatch(mutation.path, requireNotNull(mutation.value)))
                    }
                    if (definition.confirmation) args.put("confirm", JSONArray().put(mutation.path))
                    val result = requester.request("system", "settings.update", args)
                    snapshot = parseNativeSettingsSnapshot(result)
                    notice = context.getString(R.string.settings_saved_new_sessions)
                    onSuccess()
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (failure: Exception) {
                    error = failure.message ?: context.getString(R.string.settings_update_failed)
                } finally {
                    busy = false
                }
            }
        }
        if (definition.confirmation && !confirmed) {
            val proposed = when {
                mutation.reset -> if (selectedScope == "project") context.getString(R.string.settings_state_inherited) else context.getString(R.string.settings_state_default)
                definition.secret && mutation.clearSecret -> context.getString(R.string.settings_secret_delete)
                definition.secret -> context.getString(R.string.settings_secret_masked_replacement)
                else -> formatSettingValue(mutation.value)
            }
            confirmation = context.getString(R.string.settings_confirm_scoped_change, if (selectedScope == "project") context.getString(R.string.settings_scope_project) else context.getString(R.string.settings_scope_global), mutation.path, proposed) to {
                mutate(mutation, confirmed = true, onSuccess = onSuccess)
            }
        } else action()
    }

    LaunchedEffect(requester, selectedScope, settingsCwd, reload) { load() }
    LaunchedEffect(category) { if (category !in fixedCategories) category = "browse" }

    OmpModalSheet(onDismissRequest = ::requestDismiss, fullHeight = true, containerColor = OmpColors.Bg, contentColor = OmpColors.Text) {
        BackHandler(enabled = !showUsage && (query.isNotBlank() || category != "browse")) {
            if (query.isNotBlank()) query = "" else category = "browse"
        }
        Column(Modifier.fillMaxWidth().weight(1f)) {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.settings_title), style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                IconButton(enabled = !busy, onClick = { refresh() }, modifier = Modifier.size(48.dp)) { Icon(Icons.Default.Refresh, stringResource(R.string.settings_refresh)) }
                IconButton(onClick = ::requestDismiss, modifier = Modifier.size(48.dp)) { Icon(Icons.Default.Close, stringResource(R.string.settings_close)) }
            }
            HorizontalDivider(color = OmpColors.Border)
            Column(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(query, { query = it }, modifier = Modifier.fillMaxWidth(), singleLine = true, placeholder = { Text(stringResource(R.string.settings_search)) }, trailingIcon = if (query.isBlank()) null else {{ IconButton(onClick = { query = "" }) { Icon(Icons.Default.Close, stringResource(R.string.settings_clear_search)) } }})
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = selectedScope == "global", onClick = { switchScope("global") }, enabled = !busy, label = { Text(stringResource(R.string.settings_scope_global)) }, modifier = Modifier.heightIn(min = 48.dp))
                    FilterChip(selected = selectedScope == "project", onClick = { switchScope("project") }, enabled = !busy && settingsCwd.isNotBlank(), label = { Text(stringResource(R.string.settings_scope_project)) }, modifier = Modifier.heightIn(min = 48.dp))
                }
                Text(
                    if (selectedScope == "project") stringResource(R.string.settings_scope_project_path, snapshot?.cwd ?: settingsCwd)
                    else stringResource(R.string.settings_scope_global_path, snapshot?.path ?: stringResource(R.string.settings_path_loading)),
                    style = MaterialTheme.typography.bodySmall,
                    color = OmpColors.TextMuted,
                )
                if (selectedScope == "project") Text(stringResource(R.string.settings_scope_config_path, snapshot?.path ?: stringResource(R.string.settings_path_loading)), style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted)
                Text(stringResource(R.string.settings_apply_new_sessions), style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted)
                if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                notice?.let { Text(it, color = OmpColors.TextMuted, style = MaterialTheme.typography.bodySmall) }
                snapshot?.issues?.forEach { issue -> Text(stringResource(R.string.settings_stored_value_issue, issue.path, issue.message), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
            if (category != "browse" || query.isNotBlank()) {
                ScrollableTabRow(selectedTabIndex = fixedCategories.drop(1).indexOf(category).coerceAtLeast(0), edgePadding = 0.dp, containerColor = OmpColors.Bg) {
                    fixedCategories.drop(1).forEach { id -> Tab(selected = category == id, onClick = { category = id; query = "" }, modifier = Modifier.heightIn(min = 48.dp), text = { Text(settingsCategoryTitle(id), maxLines = 1, overflow = TextOverflow.Ellipsis) }) }
                }
            }
            Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (category == "browse" && query.isBlank()) {
                    fixedCategories.drop(1).forEach { id ->
                        Surface(Modifier.fillMaxWidth().heightIn(min = 64.dp).clickable(role = Role.Button) { category = id }, color = OmpColors.BgPanel, shape = MaterialTheme.shapes.small, border = BorderStroke(1.dp, OmpColors.Border)) {
                            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) { Text(settingsCategoryTitle(id), style = MaterialTheme.typography.titleSmall); Text(settingsCategoryDescription(id), style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted) }
                                Icon(Icons.AutoMirrored.Filled.ArrowForward, null)
                            }
                        }
                    }
                } else {
                    if (query.isBlank()) { Text(settingsCategoryTitle(category), style = MaterialTheme.typography.titleSmall); Text(settingsCategoryDescription(category), style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted) }
                    if (category == "general" || queryMatches(query, "general theme palette language completion submit collapse thinking interface")) LocalPreferencesSection()
                    val catalog = snapshot?.catalog.orEmpty()
                    val globallyManagedSettings = setOf(
                        "enabledModels", "disabledProviders", "modelProviderOrder", "modelRoles",
                        "task.disabledAgents", "task.agentModelOverrides", "task.agentPrewalk", "task.agentAdvisor",
                    )
                    val fields = catalog.filter { definition ->
                        if (selectedScope == "global" && definition.path in globallyManagedSettings) return@filter false
                        val textMatches = query.isNotBlank() && listOf(definition.path, definition.group, definition.label.localized(korean), definition.description.localized(korean)).any { it.contains(query, true) }
                        if (query.isNotBlank()) textMatches else when (category) {
                            "administrator" -> definition.admin
                            in setOf("models", "intelligence", "agents", "tools", "safety") -> definition.category == category && !definition.admin
                            "system" -> definition.category == "system" && !definition.admin
                            else -> false
                        }
                    }
                    CatalogSettings(fields, snapshot, selectedScope, settingsCwd, busy, korean, catalogDrafts, ::mutate)
                    val hasCatalogMatches = fields.isNotEmpty()
                    val auxiliaryMatch = query.isBlank() && category in setOf("roles", "providers", "agents", "tools", "system")
                    if (query.isNotBlank() && !hasCatalogMatches && !queryMatches(query, "general theme palette language completion submit collapse thinking interface")) Text(stringResource(R.string.settings_no_matches), color = OmpColors.TextMuted)
                    if (query.isBlank()) when (category) {
                        "models" -> { currentModel?.let { Text(stringResource(R.string.settings_current_model, it.displayName(), it.provider), style = MaterialTheme.typography.bodySmall) }; Text(stringResource(R.string.settings_global_model_manager_hint), style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted) }
                        "roles" -> Text(stringResource(R.string.settings_global_model_manager_hint), style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted)
                        "providers" -> Text(stringResource(R.string.settings_global_provider_manager_hint), style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted)
                        "agents" -> { Text(stringResource(R.string.settings_separate_manager_hint), style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted); ExtensionAgentsSection(requester, settingsCwd) }
                        "tools" -> { Text(stringResource(R.string.settings_separate_manager_hint), style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted); ExtensionSettingsPanel(requester, settingsCwd) }
                        "system" -> { ConnectionAndUsage(serverUrl, deviceId, connection) { showUsage = true }; SystemControls(requester, deviceId, onUnpair) }
                    }
                    @Suppress("UNUSED_VARIABLE") val keepCompilerHappy = auxiliaryMatch
                }
                val modelSection = if (query.isNotBlank()) ModelSettingsSection.Hidden else when (category) {
                    "models" -> ModelSettingsSection.Defaults
                    "roles" -> ModelSettingsSection.Roles
                    "providers" -> ModelSettingsSection.Providers
                    else -> ModelSettingsSection.Hidden
                }
                // One composition identity owns provider credentials and OAuth polling for
                // the entire sheet lifetime, including browse and search transitions.
                ModelSettingsPanel(requester, settingsCwd, modelSection)
            }
        }
    }
    confirmation?.let { pending -> AlertDialog(onDismissRequest = { confirmation = null }, title = { Text(stringResource(R.string.settings_confirm_security_title)) }, text = { OmpDialogSystemBars(); Text(pending.first) }, confirmButton = { TextButton(onClick = { confirmation = null; pending.second() }) { Text(stringResource(R.string.settings_confirm)) } }, dismissButton = { TextButton(onClick = { confirmation = null }) { Text(stringResource(R.string.settings_cancel)) } }) }
    if (showUsage) UsageSheet(requester = requester, onDismiss = { showUsage = false })
}

@Composable
private fun settingsCategoryTitle(id: String): String = stringResource(when (id) {
    "browse" -> R.string.settings_category_browse
    "general" -> R.string.settings_category_general
    "roles" -> R.string.settings_category_roles
    "providers" -> R.string.settings_category_providers
    "models" -> R.string.settings_category_models
    "intelligence" -> R.string.settings_category_intelligence
    "agents" -> R.string.settings_category_agents
    "tools" -> R.string.settings_category_tools
    "safety" -> R.string.settings_category_safety
    "administrator" -> R.string.settings_category_administrator
    else -> R.string.settings_category_system
})

@Composable
private fun settingsCategoryDescription(id: String): String = stringResource(when (id) {
    "browse" -> R.string.settings_browse_hint
    "general" -> R.string.settings_category_desc_general
    "roles" -> R.string.settings_category_desc_roles
    "providers" -> R.string.settings_category_desc_providers
    "models" -> R.string.settings_category_desc_models
    "intelligence" -> R.string.settings_category_desc_intelligence
    "agents" -> R.string.settings_category_desc_agents
    "tools" -> R.string.settings_category_desc_tools
    "safety" -> R.string.settings_category_desc_safety
    "administrator" -> R.string.settings_category_desc_administrator
    else -> R.string.settings_category_desc_system
})

private fun queryMatches(query: String, haystack: String) = query.isNotBlank() && haystack.contains(query, true)

@Composable
private fun CatalogSettings(
    fields: List<NativeSettingDefinition>,
    snapshot: NativeSettingsSnapshot?,
    scope: String,
    cwd: String,
    busy: Boolean,
    korean: Boolean,
    drafts: MutableMap<CatalogDraftKey, CatalogDraft>,
    mutate: (SettingsMutation, Boolean, () -> Unit) -> Unit,
) {
    fields.groupBy { it.group }.forEach { (group, grouped) ->
        var expanded by rememberSaveable(group) { mutableStateOf(false) }
        val forceExpanded = fields.size <= 12
        Surface(Modifier.fillMaxWidth(), color = OmpColors.BgPanel, shape = MaterialTheme.shapes.small, border = BorderStroke(1.dp, OmpColors.Border)) {
            Column {
                Row(Modifier.fillMaxWidth().clickable(role = Role.Button) { expanded = !expanded }.heightIn(min = 48.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(group, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                    Text(grouped.size.toString(), color = OmpColors.TextMuted)
                    Icon(if (expanded || forceExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore, null)
                }
                if (expanded || forceExpanded) grouped.forEach { definition ->
                    key(definition.path, scope, cwd) {
                        CatalogSettingEditor(definition, snapshot, scope, cwd, busy, korean, drafts) { mutation, success -> mutate(mutation, false, success) }
                    }
                }
            }
        }
    }
}

@Composable
private fun CatalogSettingEditor(
    definition: NativeSettingDefinition,
    snapshot: NativeSettingsSnapshot?,
    scope: String,
    cwd: String,
    busy: Boolean,
    korean: Boolean,
    drafts: MutableMap<CatalogDraftKey, CatalogDraft>,
    submit: (SettingsMutation, () -> Unit) -> Unit,
) {
    val override = snapshot?.let { nestedSetting(it.settings, definition.path) }
    val effective = snapshot?.let { nestedSetting(it.effectiveSettings, definition.path) } ?: definition.defaultValue
    val storedIssue = snapshot?.let { settingIssueForPath(it.issues, definition.path) }
    val editable = snapshot != null && !busy && (scope == "global" || definition.scope == "both")
    val label = definition.label.localized(korean)
    val draftKey = CatalogDraftKey(scope, cwd, definition.path)
    val baseline = formatSettingValue(override ?: effective)
    val draft = drafts[draftKey] ?: CatalogDraft(value = baseline)
    var menuOpen by remember { mutableStateOf(false) }
    fun updateDraft(next: CatalogDraft) { drafts[draftKey] = next }
    fun clearDraft() { drafts.remove(draftKey) }
    LaunchedEffect(baseline) {
        if (!draft.dirty && draft.value != baseline) updateDraft(draft.copy(value = baseline, error = null))
    }
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        HorizontalDivider(color = OmpColors.Border)
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f)) {
                Text(label, style = MaterialTheme.typography.titleSmall)
                if (definition.description.localized(korean).isNotBlank()) Text(definition.description.localized(korean), style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted)
                Text(definition.path, style = MaterialTheme.typography.labelSmall, color = OmpColors.TextDim)
                Text(
                    when { storedIssue != null -> stringResource(R.string.settings_state_stored_issue); override != null -> stringResource(R.string.settings_state_override); scope == "project" -> stringResource(R.string.settings_state_inherited); else -> stringResource(R.string.settings_state_default) },
                    style = MaterialTheme.typography.labelSmall,
                    color = OmpColors.TextMuted,
                )
                if (storedIssue != null) Text(storedIssue.message, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                if (scope == "project" && definition.scope == "global") Text(stringResource(R.string.settings_global_only), style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted)
            }
            if (definition.kind == "boolean" && !definition.secret) Switch(checked = (override ?: effective) == true, enabled = editable, onCheckedChange = { checked -> submit(SettingsMutation(definition.path, checked)) {} }, modifier = Modifier.heightIn(min = 48.dp).semantics { contentDescription = label })
        }
        when {
            definition.secret -> {
                Text(if (snapshot?.secretStatus?.get(definition.path) == true) stringResource(R.string.settings_secret_configured) else stringResource(R.string.settings_secret_not_configured), style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted)
                OutlinedTextField(draft.secret, { updateDraft(draft.copy(secret = it, error = null, dirty = it.isNotBlank())) }, enabled = editable, modifier = Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.settings_secret_replacement)) }, singleLine = true, visualTransformation = PasswordVisualTransformation(), isError = draft.error != null)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(enabled = editable && snapshot?.secretStatus?.get(definition.path) == true, modifier = Modifier.heightIn(min = 48.dp), onClick = { submit(SettingsMutation(definition.path, clearSecret = true), ::clearDraft) }) { Text(stringResource(R.string.settings_clear)) }
                    TextButton(enabled = editable && draft.secret.isNotBlank(), modifier = Modifier.heightIn(min = 48.dp), onClick = { submit(SettingsMutation(definition.path, secret = draft.secret), ::clearDraft) }) { Text(stringResource(R.string.settings_save)) }
                }
            }
            definition.kind == "enum" -> Box(Modifier.fillMaxWidth()) {
                OutlinedButton(onClick = { menuOpen = true }, enabled = editable, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text((override ?: effective)?.toString() ?: stringResource(R.string.settings_default), Modifier.weight(1f)); Icon(Icons.Default.ExpandMore, null) }
                DropdownMenu(menuOpen, { menuOpen = false }) { definition.choices.forEach { choice -> DropdownMenuItem(text = { Text(choice) }, onClick = { menuOpen = false; submit(SettingsMutation(definition.path, choice)) {} }) } }
            }
            definition.kind == "array" && definition.items != "object" -> OrderedArrayEditor(
                definition = definition,
                value = draft.value,
                addition = draft.arrayAddition,
                enabled = editable,
                onChange = { value, addition -> updateDraft(draft.copy(value = value, arrayAddition = addition, error = null, dirty = value != baseline || addition.isNotBlank())) },
                onSave = {
                    try { val parsed = parseSettingDraft(definition, draft.value); submit(SettingsMutation(definition.path, parsed), ::clearDraft) }
                    catch (failure: Exception) { updateDraft(draft.copy(error = failure.message)) }
                },
            )
            definition.kind != "boolean" -> {
                OutlinedTextField(draft.value, { updateDraft(draft.copy(value = it, error = null, dirty = it != baseline)) }, enabled = editable, modifier = Modifier.fillMaxWidth(), minLines = if (definition.kind in setOf("object", "array")) 3 else 1, maxLines = if (definition.kind in setOf("object", "array")) 10 else 4, singleLine = definition.kind in setOf("number", "string"), keyboardOptions = KeyboardOptions(keyboardType = if (definition.kind == "number") KeyboardType.Decimal else KeyboardType.Text), isError = draft.error != null, label = { Text(if (definition.kind in setOf("object", "array")) stringResource(R.string.settings_json_value) else stringResource(R.string.settings_value)) })
                TextButton(enabled = editable && draft.value != baseline, modifier = Modifier.align(Alignment.End).heightIn(min = 48.dp), onClick = {
                    try { val parsed = parseSettingDraft(definition, draft.value); submit(SettingsMutation(definition.path, parsed), ::clearDraft) }
                    catch (failure: Exception) { updateDraft(draft.copy(error = failure.message)) }
                }) { Text(stringResource(R.string.settings_save)) }
            }
        }
        draft.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
        if ((override != null || storedIssue != null) && !definition.secret) TextButton(enabled = editable, modifier = Modifier.align(Alignment.End).heightIn(min = 48.dp), onClick = { submit(SettingsMutation(definition.path, reset = true), ::clearDraft) }) { Text(stringResource(R.string.settings_reset_inherit)) }
    }
}

@Composable
private fun OrderedArrayEditor(definition: NativeSettingDefinition, value: String, addition: String, enabled: Boolean, onChange: (String, String) -> Unit, onSave: () -> Unit) {
    val initial = remember(value) { runCatching { JSONArray(value) }.getOrElse { JSONArray() } }
    val values = remember(definition.path, value) { mutableStateListOf<String>().apply { for (index in 0 until initial.length()) add(initial.opt(index)?.toString().orEmpty()) } }
    fun sync(nextAddition: String = addition) = onChange(JSONArray().apply { values.forEach { put(if (definition.items == "number") it.toDoubleOrNull() ?: it else it) } }.toString(2), nextAddition)
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        values.forEachIndexed { index, item -> Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(item, Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
            IconButton(enabled = enabled && index > 0, onClick = { values.add(index - 1, values.removeAt(index)); sync() }, modifier = Modifier.size(48.dp)) { Icon(Icons.Default.KeyboardArrowUp, stringResource(R.string.settings_move_up)) }
            IconButton(enabled = enabled && index < values.lastIndex, onClick = { values.add(index + 1, values.removeAt(index)); sync() }, modifier = Modifier.size(48.dp)) { Icon(Icons.Default.KeyboardArrowDown, stringResource(R.string.settings_move_down)) }
            IconButton(enabled = enabled, onClick = { values.removeAt(index); sync() }, modifier = Modifier.size(48.dp)) { Icon(Icons.Default.Delete, stringResource(R.string.settings_remove)) }
        } }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(addition, { onChange(value, it) }, enabled = enabled, modifier = Modifier.weight(1f), singleLine = true, label = { Text(stringResource(R.string.settings_add_item)) })
            IconButton(enabled = enabled && addition.isNotBlank(), onClick = { values.add(addition); sync("") }, modifier = Modifier.size(48.dp)) { Icon(Icons.Default.Add, stringResource(R.string.settings_add_item)) }
        }
        TextButton(enabled = enabled, modifier = Modifier.align(Alignment.End).heightIn(min = 48.dp), onClick = onSave) { Text(stringResource(R.string.settings_save)) }
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
    var showThinking by remember { mutableStateOf(AppPreferences.isThinkingShown(context)) }
    Text(stringResource(R.string.settings_group_appearance), style = MaterialTheme.typography.titleSmall, color = OmpColors.TextMuted)
    LocalChoice(LocalField("Theme", "enum", listOf("system", "light", "dark")), theme) { theme = it; AppPreferences.setTheme(context, it) }
    LocalChoice(LocalField("Palette", "enum", listOf("warm", "omp")), palette) { palette = it; AppPreferences.setPalette(context, it) }
    LocalChoice(LocalField("Language", "enum", listOf("English", "한국어")), language) { language = it; AppPreferences.setLanguage(context, it) }
    Text(stringResource(R.string.settings_group_interface), style = MaterialTheme.typography.titleSmall, color = OmpColors.TextMuted)
    LocalToggle(stringResource(R.string.settings_label_chime), chime) { chime = it; AppPreferences.setSoundChime(context, it) }
    LocalChoice(LocalField("Submit", "enum", listOf("steer", "queue")), submit) { submit = it; AppPreferences.setSubmitBehavior(context, it) }
    LocalToggle(stringResource(R.string.settings_label_collapse), collapsed) { collapsed = it; AppPreferences.setToolCallsCollapsed(context, it) }
    LocalToggle(stringResource(R.string.settings_label_show_thinking), showThinking) { showThinking = it; AppPreferences.setThinkingShown(context, it) }
}

@Composable private fun LocalToggle(label: String, value: Boolean, change: (Boolean) -> Unit) { Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) { Text(label, Modifier.weight(1f)); Switch(value, change, modifier = Modifier.heightIn(min = 48.dp)) } }
@Composable private fun LocalChoice(field: LocalField, value: String, change: (String) -> Unit) { var open by remember { mutableStateOf(false) }; Box(Modifier.fillMaxWidth()) { OutlinedButton({ open = true }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(field.path, Modifier.weight(1f)); Text(value); Icon(Icons.Default.ExpandMore, null) }; DropdownMenu(open, { open = false }) { field.choices.forEach { choice -> DropdownMenuItem({ Text(choice) }, { open = false; change(choice) }) } } } }

@Composable
private fun ConnectionAndUsage(serverUrl: String, deviceId: String, connection: ConnectionState, showUsage: () -> Unit) {
    Text(stringResource(R.string.settings_connection), style = MaterialTheme.typography.titleSmall)
    listOf(stringResource(R.string.settings_relay) to serverUrl, stringResource(R.string.settings_device) to deviceId, stringResource(R.string.settings_status) to connection.toString()).forEach { (label, value) -> Column { Text(label, style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted); SelectionContainer { Text(value) } } }
    OutlinedButton(showUsage, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(stringResource(R.string.settings_usage)) }
}

@Composable
private fun SystemControls(requester: RelayRequester, deviceId: String, onUnpair: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var result by remember { mutableStateOf<JSONObject?>(null) }
    var devices by remember { mutableStateOf<JSONArray?>(null) }
    var confirmation by remember { mutableStateOf<Pair<String, () -> Unit>?>(null) }
    val request: (String, JSONObject) -> Unit = { action, args -> scope.launch { busy = true; error = null; try { result = requester.request("system", action, args); if (action == "devices.list") devices = result?.getJSONArray("devices"); if (action == "devices.revoke") { if (args.optString("deviceId") == deviceId) onUnpair() else devices = requester.request("system", "devices.list", JSONObject()).getJSONArray("devices") } } catch (cancelled: CancellationException) { throw cancelled } catch (failure: Exception) { error = failure.message ?: context.getString(R.string.settings_request_failed) } finally { busy = false } } }
    Text(stringResource(R.string.settings_system_updates), style = MaterialTheme.typography.titleSmall)
    if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    listOf(stringResource(R.string.settings_omp_version) to "omp.check", stringResource(R.string.settings_app_version) to "app.check", stringResource(R.string.settings_paired_devices) to "devices.list").forEach { (label, action) -> Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) { Text(label, Modifier.weight(1f)); TextButton(enabled = !busy, onClick = { request(action, JSONObject().apply { if (action == "app.check") put("force", true) }) }, modifier = Modifier.heightIn(min = 48.dp)) { Text(if (action == "devices.list") stringResource(R.string.settings_refresh_action) else stringResource(R.string.settings_check_version)) } } }
    result?.let { response -> var expanded by remember(response) { mutableStateOf(false) }; TextButton({ expanded = !expanded }, Modifier.heightIn(min = 48.dp)) { Text(if (expanded) stringResource(R.string.settings_hide_response) else stringResource(R.string.settings_show_response)) }; if (expanded) SelectionContainer { Text(response.toString(2), style = MaterialTheme.typography.bodySmall) } }
    Text(stringResource(R.string.settings_updates_hint), style = MaterialTheme.typography.bodySmall)
    devices?.let { list -> for (index in 0 until list.length()) { val device = list.optJSONObject(index) ?: continue; Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text(device.optString("label")); Text(device.optString("id"), style = MaterialTheme.typography.bodySmall) }; TextButton(onClick = { confirmation = context.getString(R.string.settings_revoke_confirm, device.optString("label")) to { request("devices.revoke", JSONObject().put("deviceId", device.getString("id"))) } }) { Text(stringResource(R.string.settings_revoke_device)) } } } }
    HorizontalDivider(color = OmpColors.Border)
    OutlinedButton(onClick = { confirmation = context.getString(R.string.settings_restart_confirm) to { request("omp.restart", JSONObject().put("confirm", true)) } }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp), enabled = !busy) { Text(stringResource(R.string.settings_restart_omp)) }
    OutlinedButton(onClick = { confirmation = context.getString(R.string.settings_unpair_confirm) to onUnpair }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp), enabled = !busy) { Text(stringResource(R.string.settings_unpair_device)) }
    confirmation?.let { pending -> AlertDialog({ confirmation = null }, { TextButton({ confirmation = null; pending.second() }) { Text(stringResource(R.string.settings_confirm)) } }, title = { Text(stringResource(R.string.settings_confirm_title)) }, text = { OmpDialogSystemBars(); Text(pending.first) }, dismissButton = { TextButton({ confirmation = null }) { Text(stringResource(R.string.settings_cancel)) } }) }
}
