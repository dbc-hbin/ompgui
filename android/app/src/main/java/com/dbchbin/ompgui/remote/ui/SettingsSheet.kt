package com.dbchbin.ompgui.remote.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.activity.compose.BackHandler
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
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
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var snapshot by remember { mutableStateOf(settings) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var query by rememberSaveable { mutableStateOf("") }
    var reload by remember { mutableIntStateOf(0) }
    var category by rememberSaveable { mutableStateOf("Browse") }
    var confirmation by remember { mutableStateOf<Pair<String, () -> Unit>?>(null) }
    var showUsage by remember { mutableStateOf(false) }
    val sectionState = rememberSaveableStateHolder()
    val scrollPositions = remember { mutableMapOf<String, androidx.compose.foundation.ScrollState>() }
    val scrollKey = if (query.isBlank()) category else "search"
    val contentScroll = scrollPositions.getOrPut(scrollKey) { androidx.compose.foundation.ScrollState(0) }
    var modelsVisited by remember { mutableStateOf(false) }
    val modelCategory = category == "Models" || category == "Providers"
    val categories = listOf("Browse", "General", "Safety", "Models", "Providers", "Intelligence", "Agents", "Tools", "System")
    val categoryTitles = listOf(
        stringResource(R.string.settings_category_browse),
        stringResource(R.string.settings_category_general),
        stringResource(R.string.settings_category_safety),
        stringResource(R.string.settings_category_models),
        stringResource(R.string.settings_category_providers),
        stringResource(R.string.settings_category_intelligence),
        stringResource(R.string.settings_category_agents),
        stringResource(R.string.settings_category_tools),
        stringResource(R.string.settings_category_system),
    )
    val categoryDescriptions = listOf(
        stringResource(R.string.settings_browse_hint),
        stringResource(R.string.settings_category_desc_general),
        stringResource(R.string.settings_category_desc_safety),
        stringResource(R.string.settings_category_desc_models),
        stringResource(R.string.settings_category_desc_providers),
        stringResource(R.string.settings_category_desc_intelligence),
        stringResource(R.string.settings_category_desc_agents),
        stringResource(R.string.settings_category_desc_tools),
        stringResource(R.string.settings_category_desc_system),
    )
    val contentCategories = categories.drop(1)
    val contentTitles = categoryTitles.drop(1)
    val contentDescriptions = categoryDescriptions.drop(1)
    val selectedCategoryIndex = categories.indexOf(category).coerceAtLeast(0)
    val selectedCategoryDescription = categoryDescriptions.getOrElse(selectedCategoryIndex) { "" }
    val groupAdvisor = stringResource(R.string.settings_group_advisor)
    val groupCompaction = stringResource(R.string.settings_group_compaction)
    val groupMemory = stringResource(R.string.settings_group_memory)
    val groupRetry = stringResource(R.string.settings_group_retry)
    val groupTask = stringResource(R.string.settings_group_task)
    val groupMcp = stringResource(R.string.settings_group_mcp)
    val groupModels = stringResource(R.string.settings_group_models)
    val groupToolsSafety = stringResource(R.string.settings_group_tools_safety)
    val groupAppearance = stringResource(R.string.settings_group_appearance)
    val groupInterface = stringResource(R.string.settings_group_interface)
    val tabAgentInventory = stringResource(R.string.settings_tab_agent_inventory)
    val tabTaskDefaults = stringResource(R.string.settings_tab_task_defaults)
    val settingsSubtabAria = stringResource(R.string.settings_subtab_aria)
    val settingsNavAria = stringResource(R.string.settings_nav_aria)
    val settingsAllSections = stringResource(R.string.settings_all_sections)
    val settingsBrowseTitle = stringResource(R.string.settings_browse_title)
    LaunchedEffect(modelCategory) { if (modelCategory) modelsVisited = true }
    // Migrate stale saveable values if any future ids change; keep unknown as Browse.
    LaunchedEffect(category) {
        if (category !in categories) category = "Browse"
    }
    val save: (String, Any) -> Unit = { path, value ->
        if (!busy) scope.launch {
            busy = true
            error = null
            notice = null
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
                notice = if (result.optJSONObject("application")?.optString("mode") == "runtime-refresh") {
                    context.getString(R.string.settings_saved_runtime)
                } else {
                    context.getString(R.string.settings_saved_new_sessions)
                }
            } catch (failure: CancellationException) { throw failure
            } catch (failure: Exception) { error = failure.message ?: context.getString(R.string.settings_update_failed)
            } finally { busy = false }
        }
    }
    LaunchedEffect(requester, reload) {
        busy = true
        error = null
        try { snapshot = requester.request("system", "settings.get", JSONObject()).getJSONObject("settings")
        } catch (failure: CancellationException) { throw failure
        } catch (failure: Exception) { error = failure.message ?: context.getString(R.string.settings_load_failed)
        } finally { busy = false }
    }
    OmpModalSheet(
        onDismissRequest = onDismiss,
        fullHeight = true,
        containerColor = OmpColors.Bg,
        contentColor = OmpColors.Text,
    ) {
        // Hierarchy only — Dialog owns system Back dismiss when this is inactive.
        BackHandler(enabled = !showUsage && (query.isNotBlank() || category != "Browse")) {
            if (query.isNotBlank()) query = ""
            else category = "Browse"
        }
        Column(Modifier.fillMaxWidth().weight(1f)) {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 16.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.settings_title), style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                IconButton(enabled = !busy, onClick = { notice = null; reload++ }, modifier = Modifier.size(48.dp)) { Icon(Icons.Default.Refresh, stringResource(R.string.settings_refresh), modifier = Modifier.size(20.dp)) }
                IconButton(onClick = onDismiss, modifier = Modifier.size(48.dp)) { Icon(Icons.Default.Close, stringResource(R.string.settings_close), modifier = Modifier.size(20.dp)) }
            }
            HorizontalDivider(color = OmpColors.Border)

            Column(Modifier.padding(horizontal = 16.dp, vertical = 10.dp)) {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    placeholder = { Text(stringResource(R.string.settings_search)) },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 40.dp),
                    singleLine = true,
                    textStyle = MaterialTheme.typography.bodyMedium,
                    shape = MaterialTheme.shapes.small,
                    trailingIcon = if (query.isNotBlank()) {
                        {
                            IconButton(onClick = { query = "" }, modifier = Modifier.size(40.dp)) {
                                Icon(Icons.Default.Close, stringResource(R.string.settings_clear_search), modifier = Modifier.size(16.dp))
                            }
                        }
                    } else null,
                )
            }

            val showBrowseOverview = query.isBlank() && category == "Browse"
            if (!showBrowseOverview) {
                val quickTabIndex = contentCategories.indexOf(category).coerceAtLeast(0)
                ScrollableTabRow(
                    selectedTabIndex = quickTabIndex,
                    edgePadding = 0.dp,
                    containerColor = OmpColors.Bg,
                    contentColor = OmpColors.Text,
                    modifier = Modifier.semantics { contentDescription = settingsNavAria },
                    indicator = { tabPositions ->
                        if (tabPositions.isNotEmpty() && quickTabIndex in tabPositions.indices) {
                            TabRowDefaults.SecondaryIndicator(
                                Modifier.tabIndicatorOffset(tabPositions[quickTabIndex]),
                                color = OmpColors.Accent,
                            )
                        }
                    },
                ) {
                    contentCategories.forEachIndexed { index, name ->
                        val title = contentTitles[index]
                        val description = contentDescriptions[index]
                        Tab(
                            selected = category == name,
                            onClick = { category = name; query = ""; notice = null },
                            modifier = Modifier
                                .heightIn(min = 48.dp)
                                .semantics { contentDescription = "$title. $description" },
                            text = {
                                Text(
                                    title,
                                    style = MaterialTheme.typography.labelMedium,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            },
                        )
                    }
                }
                HorizontalDivider(color = OmpColors.Border)
            }

            Column(
                Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                notice?.let { Text(it, color = OmpColors.TextMuted, style = MaterialTheme.typography.bodySmall) }
                if (query.isBlank()) {
                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.Top,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(
                                if (showBrowseOverview) settingsBrowseTitle else categoryTitles[selectedCategoryIndex],
                                style = MaterialTheme.typography.titleSmall,
                                color = OmpColors.Text,
                            )
                            Text(
                                if (showBrowseOverview) stringResource(R.string.settings_browse_hint) else selectedCategoryDescription,
                                style = MaterialTheme.typography.bodySmall,
                                color = OmpColors.TextMuted,
                            )
                        }
                        if (!showBrowseOverview) {
                            TextButton(
                                onClick = { category = "Browse"; query = ""; notice = null },
                                modifier = Modifier.heightIn(min = 48.dp),
                            ) {
                                Text(settingsAllSections)
                            }
                        }
                    }
                }
            }
            Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(contentScroll).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                sectionState.SaveableStateProvider(if (query.isBlank()) category else "search") {
                    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (showBrowseOverview) {
                        SettingsCategoryOverview(
                            categories = contentCategories,
                            titles = contentTitles,
                            descriptions = contentDescriptions,
                            onSelect = { selected ->
                                category = selected
                                query = ""
                                notice = null
                            },
                        )
                    }
                    var showTaskDefaults by rememberSaveable(category) { mutableStateOf(false) }
                    if (query.isBlank() && category == "Agents") {
                        val tabs = listOf(tabAgentInventory, tabTaskDefaults)
                        ScrollableTabRow(
                            selectedTabIndex = if (showTaskDefaults) 1 else 0,
                            edgePadding = 0.dp,
                            containerColor = OmpColors.Bg,
                            contentColor = OmpColors.Text,
                            modifier = Modifier.semantics { contentDescription = settingsSubtabAria },
                        ) {
                            tabs.forEachIndexed { index, title ->
                                Tab(
                                    selected = showTaskDefaults == (index == 1),
                                    onClick = { showTaskDefaults = index == 1 },
                                    modifier = Modifier.heightIn(min = 48.dp),
                                    text = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                )
                            }
                        }
                    }
                    val localMatches = query.isBlank() && category == "General" || query.isNotBlank() && listOf("general", "theme", "palette", "language", "appearance", "completion chime", "submit", "collapse tool calls", "interface").any { it.contains(query, true) }
                    if (localMatches) LocalPreferencesSection(groupAppearance = groupAppearance, groupInterface = groupInterface)
                    val groupLabels = SettingsGroupLabels(
                        advisor = groupAdvisor,
                        compaction = groupCompaction,
                        memory = groupMemory,
                        retry = groupRetry,
                        task = groupTask,
                        mcp = groupMcp,
                        models = groupModels,
                        toolsSafety = groupToolsSafety,
                    )
                    val fields = settingFields.filter {
                        if (query.isBlank()) {
                            when (category) {
                                "Browse" -> false
                                "Agents" -> showTaskDefaults && it.category == "Agents"
                                // Tools fields render inside ExtensionSettingsPanel Optional Tools.
                                "Tools" -> false
                                else -> it.category == category
                            }
                        } else {
                            val matchedCategories = contentCategories.filterIndexed { index, _ ->
                                contentTitles[index].contains(query, true) ||
                                    contentDescriptions[index].contains(query, true)
                            }
                            it.path.contains(query, true) ||
                                it.category.contains(query, true) ||
                                groupLabels.forField(it).contains(query, true) ||
                                it.category in matchedCategories
                        }
                    }
                    if (query.isNotBlank() && fields.isEmpty() && !localMatches) Text(stringResource(R.string.settings_no_matches), color = OmpColors.TextMuted)
                    SettingFieldGroups(
                        fields = fields,
                        snapshot = snapshot,
                        busy = busy,
                        groupLabels = groupLabels,
                        onConfirm = { message, action -> confirmation = message to action },
                        save = save,
                    )
                    if (query.isBlank()) when (category) {
                        "Models" -> currentModel?.let { Text(stringResource(R.string.settings_current_model, it.displayName(), it.provider), style = MaterialTheme.typography.bodySmall) }
                        "Agents" -> if (!showTaskDefaults) ExtensionAgentsSection(requester, settingsCwd)
                        "Tools" -> ExtensionSettingsPanel(requester, settingsCwd) {
                            SettingFieldGroups(
                                fields = settingFields.filter { it.category == "Tools" },
                                snapshot = snapshot,
                                busy = busy,
                                groupLabels = groupLabels,
                                onConfirm = { message, action -> confirmation = message to action },
                                save = save,
                            )
                        }
                        "System" -> {
                            Text(stringResource(R.string.settings_connection), style = MaterialTheme.typography.titleSmall)
                            for ((label, value) in listOf(
                                stringResource(R.string.settings_relay) to serverUrl,
                                stringResource(R.string.settings_device) to deviceId,
                                stringResource(R.string.settings_status) to connection.toString(),
                            )) {
                                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    Text(label, style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted)
                                    SelectionContainer { Text(value, style = MaterialTheme.typography.bodyMedium) }
                                }
                            }
                            OutlinedButton(onClick = { showUsage = true }, modifier = Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.small) { Text(stringResource(R.string.settings_usage)) }
                            SystemControls(requester, deviceId, onUnpair)
                        }
                    }
                    }
                }
                if (modelsVisited || modelCategory) {
                    val visible = modelCategory && query.isBlank()
                    val visibility = if (visible) Modifier else Modifier.clearAndSetSemantics {}.layout { _, _ -> layout(0, 0) {} }
                    Column(Modifier.fillMaxWidth().then(visibility)) {
                        ModelSettingsPanel(requester, settingsCwd, selectedSection = if (category == "Providers") ModelSettingsSection.Providers else ModelSettingsSection.Defaults)
                    }
                }
            }
        }
    }
    confirmation?.let { pending -> AlertDialog(onDismissRequest = { confirmation = null }, title = { Text(stringResource(R.string.settings_confirm_security_title)) }, text = { OmpDialogSystemBars(); Text(pending.first) }, confirmButton = { TextButton(onClick = { confirmation = null; pending.second() }) { Text(stringResource(R.string.settings_confirm)) } }, dismissButton = { TextButton(onClick = { confirmation = null }) { Text(stringResource(R.string.settings_cancel)) } }) }
    if (showUsage) UsageSheet(requester = requester, onDismiss = { showUsage = false })
}

@Composable
private fun SettingsCategoryOverview(
    categories: List<String>,
    titles: List<String>,
    descriptions: List<String>,
    onSelect: (String) -> Unit,
) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        categories.forEachIndexed { index, id ->
            val categoryTitle = titles[index]
            val categoryDescription = descriptions[index]
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 64.dp)
                    .clickable(role = Role.Button, onClick = { onSelect(id) })
                    .semantics { contentDescription = "$categoryTitle. $categoryDescription" },
                color = OmpColors.BgPanel,
                shape = MaterialTheme.shapes.small,
                border = BorderStroke(1.dp, OmpColors.Border),
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(categoryTitle, style = MaterialTheme.typography.titleSmall, color = OmpColors.Text)
                        Text(categoryDescription, style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted)
                    }
                    Icon(
                        Icons.AutoMirrored.Filled.ArrowForward,
                        contentDescription = null,
                        tint = OmpColors.TextDim,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        }
    }
}

private data class SettingsGroupLabels(
    val advisor: String,
    val compaction: String,
    val memory: String,
    val retry: String,
    val task: String,
    val mcp: String,
    val models: String,
    val toolsSafety: String,
) {
    fun forField(field: SettingField): String = when (field.path.substringBefore('.', field.category)) {
        "advisor" -> advisor
        "compaction" -> compaction
        "memory", "autolearn", "mnemopi" -> memory
        "retry" -> retry
        "task" -> task
        "mcp" -> mcp
        "Models" -> models
        "tools" -> toolsSafety
        else -> field.path.substringBefore('.', field.category).replaceFirstChar { char -> char.uppercase() }
    }
}

@Composable
private fun SettingFieldGroups(
    fields: List<SettingField>,
    snapshot: JSONObject?,
    busy: Boolean,
    groupLabels: SettingsGroupLabels,
    onConfirm: (String, () -> Unit) -> Unit,
    save: (String, Any) -> Unit,
) {
    val context = LocalContext.current
    for ((group, groupFields) in fields.groupBy(groupLabels::forField)) {
        Text(group, modifier = Modifier.padding(top = 12.dp, bottom = 4.dp), style = MaterialTheme.typography.titleSmall, color = OmpColors.TextMuted)
        for (field in groupFields) {
            var node: JSONObject? = snapshot
            val segments = field.path.split('.')
            for (segment in segments.dropLast(1)) node = node?.optJSONObject(segment)
            val value = node?.opt(segments.last())?.takeUnless { it == JSONObject.NULL }
            key(field.path) {
                SettingEditor(field, value, !busy && snapshot != null) { newValue ->
                    if (field.path == "computer.enabled" && newValue == true || field.path == "tools.approvalMode" && newValue == "yolo" || field.path == "tools.approval.bash" && newValue == "allow") {
                        onConfirm(context.getString(R.string.settings_confirm_security_grant, field.path, newValue)) { save(field.path, newValue) }
                    } else save(field.path, newValue)
                }
            }
        }
    }
}

@Composable
private fun SettingEditor(field: SettingField, value: Any?, enabled: Boolean, save: (Any) -> Unit) {
    val context = LocalContext.current
    var draft by rememberSaveable(field.path, value?.toString()) { mutableStateOf(value?.toString() ?: "") }
    var error by remember(field.path) { mutableStateOf<String?>(null) }
    val label = when (field.path) {
        "Theme" -> stringResource(R.string.settings_label_theme)
        "Palette" -> stringResource(R.string.settings_label_palette)
        "Language" -> stringResource(R.string.settings_label_language)
        "Completion chime" -> stringResource(R.string.settings_label_chime)
        "Submit during run" -> stringResource(R.string.settings_label_submit)
        "Collapse tool calls" -> stringResource(R.string.settings_label_collapse)
        else -> field.path.substringAfterLast('.').replace(Regex("([a-z])([A-Z])"), "$1 $2").replaceFirstChar { it.uppercase() }
    }
    val description = when (field.path) {
        "Theme" -> stringResource(R.string.settings_desc_theme)
        "Palette" -> stringResource(R.string.settings_desc_palette)
        "Language" -> stringResource(R.string.settings_desc_language)
        "Completion chime" -> stringResource(R.string.settings_desc_chime)
        "Submit during run" -> stringResource(R.string.settings_desc_submit)
        "Collapse tool calls" -> stringResource(R.string.settings_desc_collapse)
        "tools.approvalMode" -> stringResource(R.string.settings_desc_approval_mode)
        "tools.approval.bash" -> stringResource(R.string.settings_desc_approval_bash)
        "tools.approval.extension" -> stringResource(R.string.settings_desc_approval_extension)
        "defaultThinkingLevel" -> stringResource(R.string.settings_desc_thinking_level)
        "textVerbosity" -> stringResource(R.string.settings_desc_verbosity)
        "personality" -> stringResource(R.string.settings_desc_personality)
        "hideThinkingBlock" -> stringResource(R.string.settings_desc_hide_thinking)
        "externalThinking" -> stringResource(R.string.settings_desc_external_thinking)
        "advisor.enabled" -> stringResource(R.string.settings_desc_advisor_enabled)
        "advisor.subagents" -> stringResource(R.string.settings_desc_advisor_subagents)
        "advisor.syncBacklog" -> stringResource(R.string.settings_desc_advisor_sync)
        "compaction.enabled" -> stringResource(R.string.settings_desc_compaction_enabled)
        "compaction.autoContinue" -> stringResource(R.string.settings_desc_compaction_auto)
        "compaction.strategy" -> stringResource(R.string.settings_desc_compaction_strategy)
        "compaction.midTurnEnabled" -> stringResource(R.string.settings_desc_compaction_mid)
        "memory.backend" -> stringResource(R.string.settings_desc_memory_backend)
        "autolearn.enabled" -> stringResource(R.string.settings_desc_autolearn_enabled)
        "autolearn.autoContinue" -> stringResource(R.string.settings_desc_autolearn_auto)
        "mnemopi.scoping" -> stringResource(R.string.settings_desc_mnemopi_scoping)
        "mnemopi.autoRecall" -> stringResource(R.string.settings_desc_mnemopi_recall)
        "mnemopi.autoRetain" -> stringResource(R.string.settings_desc_mnemopi_retain)
        "retry.enabled" -> stringResource(R.string.settings_desc_retry_enabled)
        "retry.maxRetries" -> stringResource(R.string.settings_desc_retry_max)
        "retry.modelFallback" -> stringResource(R.string.settings_desc_retry_fallback)
        "retry.fallbackRevertPolicy" -> stringResource(R.string.settings_desc_retry_revert)
        "retry.fallbackChains" -> stringResource(R.string.settings_desc_retry_chains)
        "mcp.enableProjectConfig" -> stringResource(R.string.settings_desc_mcp_project)
        "mcp.renderMarkdownResults" -> stringResource(R.string.settings_desc_mcp_markdown)
        "mcp.notifications" -> stringResource(R.string.settings_desc_mcp_notifications)
        else -> null
    }
    Column(Modifier.fillMaxWidth()) {
        HorizontalDivider(color = OmpColors.Border)
        Column(Modifier.padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(label, style = MaterialTheme.typography.titleSmall)
                    description?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted) }
                    if (field.category != "General") Text(field.path, style = MaterialTheme.typography.labelSmall, color = OmpColors.TextDim)
                    if (value == null) Text(stringResource(R.string.settings_uses_server_default), style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted)
                    if (field.kind == "integer") Text("${field.min}–${field.max}", style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted)
                }
            when {
                field.kind == "integer" -> {
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(draft, { draft = it; error = null }, enabled = enabled, modifier = Modifier.width(96.dp).semantics { contentDescription = label }, singleLine = true, textStyle = MaterialTheme.typography.bodyMedium, keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number), isError = error != null)
                        TextButton(modifier = Modifier.size(48.dp), contentPadding = PaddingValues(0.dp), enabled = enabled && draft != (value?.toString() ?: ""), onClick = {
                            try {
                                val parsed = draft.toInt().also { require(it in field.min..field.max) { context.getString(R.string.settings_integer_range, field.min, field.max) } }
                                save(parsed)
                            } catch (failure: Exception) { error = failure.message ?: context.getString(R.string.settings_invalid_value) }
                        }) { Text(stringResource(R.string.settings_save)) }
                    }
                }
                field.kind == "boolean" && value is Boolean -> {
                    Switch(checked = value, onCheckedChange = { save(it) }, enabled = enabled, modifier = Modifier.heightIn(min = 48.dp).semantics { contentDescription = label })
                }
                field.kind == "boolean" || field.kind == "choice" -> {
                    val options = if (field.kind == "boolean") listOf("true", "false") else field.choices
                    var expanded by remember { mutableStateOf(false) }
                    Box(Modifier.width(128.dp)) {
                        OutlinedButton(onClick = { expanded = true }, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp), contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp), shape = MaterialTheme.shapes.small, border = BorderStroke(1.dp, OmpColors.Border)) {
                            Text(value?.toString() ?: stringResource(R.string.settings_default), Modifier.weight(1f), color = OmpColors.Text)
                            Icon(Icons.Default.ExpandMore, stringResource(R.string.settings_choose, field.path), modifier = Modifier.size(18.dp))
                        }
                        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                            options.forEach { option ->
                                DropdownMenuItem(text = { Text(option) }, onClick = { expanded = false; save(if (field.kind == "boolean") option.toBoolean() else option) })
                            }
                        }
                    }
                }
            }
            }
            if (field.kind != "boolean" && field.kind != "choice" && field.kind != "integer") {
                    OutlinedTextField(draft, { draft = it; error = null }, enabled = enabled, modifier = Modifier.fillMaxWidth(), label = { Text(when (field.kind) { "array" -> stringResource(R.string.settings_json_array); "object" -> stringResource(R.string.settings_json_object); else -> stringResource(R.string.settings_value) }) }, isError = error != null)
                    TextButton(modifier = Modifier.align(Alignment.End).heightIn(min = 48.dp), enabled = enabled && draft != (value?.toString() ?: ""), onClick = {
                        try {
                            val parsed: Any = when (field.kind) {
                                "array" -> JSONArray(draft).also { array -> for (index in 0 until array.length()) require(array.get(index) is String && array.getString(index).isNotBlank()) { context.getString(R.string.settings_array_entries) } }
                                "object" -> JSONObject(draft)
                                else -> draft
                            }
                            save(parsed)
                        } catch (failure: Exception) { error = failure.message ?: context.getString(R.string.settings_invalid_value) }
                    }) { Text(stringResource(R.string.settings_save)) }
            }
            error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
        }
    }
}

@Composable
private fun LocalPreferencesSection(
    groupAppearance: String,
    groupInterface: String,
) {
    val context = LocalContext.current
    var theme by remember { mutableStateOf(AppPreferences.getTheme(context)) }
    var palette by remember { mutableStateOf(AppPreferences.getPalette(context)) }
    var language by remember { mutableStateOf(AppPreferences.getLanguage(context, java.util.Locale.getDefault().language)) }
    var chime by remember { mutableStateOf(AppPreferences.isSoundChime(context)) }
    var submit by remember { mutableStateOf(AppPreferences.getSubmitBehavior(context)) }
    var collapsed by remember { mutableStateOf(AppPreferences.isToolCallsCollapsed(context)) }
    Text(groupAppearance, style = MaterialTheme.typography.titleSmall, color = OmpColors.TextMuted)
    SettingEditor(SettingField("Theme", "General", "choice", listOf("system", "light", "dark")), theme, true) { theme = it.toString(); AppPreferences.setTheme(context, theme) }
    SettingEditor(SettingField("Palette", "General", "choice", listOf("warm", "omp")), palette, true) { palette = it.toString(); AppPreferences.setPalette(context, palette) }
    SettingEditor(SettingField("Language", "General", "choice", listOf("English", "한국어")), language, true) { language = it.toString(); AppPreferences.setLanguage(context, language) }
    Text(groupInterface, modifier = Modifier.padding(top = 12.dp, bottom = 4.dp), style = MaterialTheme.typography.titleSmall, color = OmpColors.TextMuted)
    SettingEditor(SettingField("Completion chime", "General"), chime, true) { chime = it == true; AppPreferences.setSoundChime(context, chime) }
    SettingEditor(SettingField("Submit during run", "General", "choice", listOf("steer", "queue")), submit, true) { submit = it.toString(); AppPreferences.setSubmitBehavior(context, submit) }
    SettingEditor(SettingField("Collapse tool calls", "General"), collapsed, true) { collapsed = it == true; AppPreferences.setToolCallsCollapsed(context, collapsed) }
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
            } catch (failure: Exception) { error = failure.message ?: context.getString(R.string.settings_request_failed)
            } finally { busy = false }
        }
    }
    Text(stringResource(R.string.settings_system_updates), modifier = Modifier.padding(top = 12.dp, bottom = 4.dp), style = MaterialTheme.typography.titleSmall)
    if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    for ((label, action) in listOf(
        stringResource(R.string.settings_omp_version) to "omp.check",
        stringResource(R.string.settings_app_version) to "app.check",
        stringResource(R.string.settings_paired_devices) to "devices.list",
    )) {
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
            TextButton(modifier = Modifier.width(128.dp).heightIn(min = 48.dp), enabled = !busy, onClick = { request(action, JSONObject().apply { if (action == "app.check") put("force", true) }) }) {
                Text(if (action == "devices.list") stringResource(R.string.settings_refresh_action) else stringResource(R.string.settings_check_version))
            }
        }
    }
    result?.let { response ->
        var expanded by remember(response) { mutableStateOf(true) }
        TextButton(onClick = { expanded = !expanded }) { Text(if (expanded) stringResource(R.string.settings_hide_response) else stringResource(R.string.settings_show_response)) }
        if (expanded) Surface(color = OmpColors.BgPanel, shape = MaterialTheme.shapes.small) {
            SelectionContainer { Text(response.toString(2), Modifier.padding(12.dp), style = MaterialTheme.typography.bodySmall) }
        }
    }
    Text(stringResource(R.string.settings_updates_hint), style = MaterialTheme.typography.bodySmall)
    devices?.let { list ->
        Text(stringResource(R.string.settings_paired_devices), style = MaterialTheme.typography.titleSmall)
        for (index in 0 until list.length()) {
        val device = list.optJSONObject(index) ?: continue
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(device.optString("label"), style = MaterialTheme.typography.bodyMedium)
                Text("${device.optString("id")}\n${context.getString(R.string.settings_last_seen, device.opt("lastSeenAt"))}", style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted)
            }
            TextButton(modifier = Modifier.width(128.dp).heightIn(min = 48.dp), enabled = !busy, onClick = { confirmation = context.getString(R.string.settings_revoke_confirm, device.optString("label")) to { request("devices.revoke", JSONObject().put("deviceId", device.getString("id"))) } }) { Text(stringResource(R.string.settings_revoke_device)) }
        }
    } }
    HorizontalDivider(color = OmpColors.Border)
    Text(stringResource(R.string.settings_session_actions), modifier = Modifier.padding(top = 12.dp, bottom = 4.dp), style = MaterialTheme.typography.titleSmall)
    OutlinedButton(modifier = Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.small, enabled = !busy, onClick = { confirmation = context.getString(R.string.settings_restart_confirm) to { request("omp.restart", JSONObject().put("confirm", true)) } }) { Text(stringResource(R.string.settings_restart_omp)) }
    OutlinedButton(modifier = Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.small, enabled = !busy, onClick = { confirmation = context.getString(R.string.settings_unpair_confirm) to onUnpair }) { Text(stringResource(R.string.settings_unpair_device)) }
    confirmation?.let { pending -> AlertDialog(onDismissRequest = { confirmation = null }, title = { Text(stringResource(R.string.settings_confirm_title)) }, text = { OmpDialogSystemBars(); Text(pending.first) }, confirmButton = { TextButton(onClick = { confirmation = null; pending.second() }) { Text(stringResource(R.string.settings_confirm)) } }, dismissButton = { TextButton(onClick = { confirmation = null }) { Text(stringResource(R.string.settings_cancel)) } }) }
}
