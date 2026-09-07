@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package com.dbchbin.ompgui.remote.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.TextButton
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.ui.layout.layout
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dbchbin.ompgui.remote.relay.RelayRequestException
import com.dbchbin.ompgui.remote.relay.RelayRequester
import java.util.Locale
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * Native models/providers/auth settings panel.
 *
 * Talks to the `models` domain only (see lib/relay/models-requests.ts):
 * catalog/roles/registry/providers/fallback/auth actions. Credentials and
 * headers are write-only: the panel never prefills or displays secret values,
 * only the server-owned `apiKeyConfigured` / `headersConfigured` flags.
 * Server-disabled operations (API-key store/remove, logout) surface the exact
 * 501 capability codes plus terminal guidance instead of fake success.
 */
enum class ModelSettingsSection { All, Defaults, Providers }

@Composable
fun ModelSettingsPanel(
    requester: RelayRequester,
    cwd: String,
    selectedSection: ModelSettingsSection = ModelSettingsSection.All,
) {
    // The models registry is global, not per-cwd; cwd is accepted per the
    // shared UI contract and keys reloads so a project switch refreshes.
    val korean = remember { Locale.getDefault().language == "ko" }
    var catalog by remember { mutableStateOf(ModelCatalogState()) }
    var catalogLoading by remember { mutableStateOf(false) }
    var catalogError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun refreshCatalog() {
        scope.launch {
            catalogLoading = true
            catalogError = null
            try {
                val data = requester.request("models", "catalog.get", JSONObject())
                catalog = parseModelCatalog(data)
            } catch (e: Exception) {
                catalogError = modelRequestErrorNote(e, "catalog.get")
            } finally {
                catalogLoading = false
            }
        }
    }

    LaunchedEffect(cwd) { refreshCatalog() }

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // Keep both domains composed: changing category must not drop provider
        // drafts, write-only credentials, or a running OAuth coroutine.
        val hidden = Modifier.clearAndSetSemantics { }.layout { _, _ -> layout(0, 0) { } }
        Column(
            modifier = if (selectedSection == ModelSettingsSection.Providers) hidden else Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ModelCatalogSection(
                korean = korean,
                catalog = catalog,
                loading = catalogLoading,
                error = catalogError,
                onRefresh = ::refreshCatalog,
            )
            ModelRolesSection(korean = korean, requester = requester, catalog = catalog)
            ModelRegistrySection(korean = korean, requester = requester, catalog = catalog)
            ModelFallbackSection(korean = korean, requester = requester, catalog = catalog)
        }
        Column(
            modifier = if (selectedSection == ModelSettingsSection.Defaults) hidden else Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ModelProvidersSection(korean = korean, requester = requester, catalog = catalog)
            ModelAuthSection(korean = korean, requester = requester)
        }
    }
}

// ---------------------------------------------------------------------------
// Shared state + pure helpers (covered by ModelSettingsPanelTest).
// ---------------------------------------------------------------------------

data class CatalogModel(
    val provider: String,
    val id: String,
    val name: String,
    val thinkingLevels: List<String> = emptyList(),
    val supportsFastMode: Boolean = false,
    val contextWindow: Int? = null,
) {
    val selector: String get() = "$provider/$id"
}

data class ConnectedProvider(val id: String, val name: String, val disabled: Boolean)

data class ModelCatalogState(
    val models: List<CatalogModel> = emptyList(),
    val defaultModel: String? = null,
    val connectedProviders: List<ConnectedProvider> = emptyList(),
    val unavailable: Boolean = false,
)

/** Native OMP role selectors, mirroring the desktop ModelRolesDetail. */
val nativeModelRoles: List<String> = listOf(
    "default", "smol", "slow", "vision", "plan",
    "designer", "commit", "tiny", "task", "advisor",
)

val modelApiOptions: List<String> = listOf(
    "openai-completions",
    "openai-responses",
    "openai-codex-responses",
    "azure-openai-responses",
    "anthropic-messages",
    "bedrock-converse-stream",
    "google-generative-ai",
    "google-gemini-cli",
    "google-vertex",
)

/** Terminal phases of the tunneled login flow; anything else keeps polling. */
fun isModelLoginTerminal(phase: String): Boolean =
    phase == "success" || phase == "error" || phase == "cancelled"

/**
 * Mirrors the desktop `/api/model-roles` PUT filter: only non-empty
 * role/selector string pairs are kept; anything else is dropped so one bad
 * row never rejects the whole save.
 */
fun sanitizeRolesForSave(roles: Map<String, String?>): Map<String, String> {
    val out = LinkedHashMap<String, String>()
    for ((role, selector) in roles) {
        if (selector == null) continue
        val key = role.trim()
        val value = selector.trim()
        if (key.isEmpty() || key.length > 128 || value.isEmpty() || value.length > 512) continue
        out[key] = value
    }
    return out
}

fun parseModelCatalog(data: JSONObject): ModelCatalogState {
    val models = mutableListOf<CatalogModel>()
    val array = data.optJSONArray("models")
    if (array != null) {
        for (i in 0 until array.length()) {
            val entry = array.optJSONObject(i) ?: continue
            val provider = entry.optString("provider").trim()
            val id = entry.optString("id").trim()
            if (provider.isEmpty() || id.isEmpty()) continue
            val name = entry.optString("name").ifBlank { id }
            val levels = mutableListOf<String>()
            val rawLevels = entry.optJSONArray("thinkingLevels")
            if (rawLevels != null) {
                for (j in 0 until rawLevels.length()) {
                    val level = rawLevels.optString(j)
                    if (level.isNotBlank()) levels.add(level)
                }
            }
            models.add(
                CatalogModel(
                    provider = provider,
                    id = id,
                    name = name,
                    thinkingLevels = levels,
                    supportsFastMode = entry.optBoolean("supportsFastMode", false),
                    contextWindow = if (entry.has("contextWindow")) entry.optInt("contextWindow").takeIf { it > 0 } else null,
                ),
            )
        }
    }
    val defaultObj = data.optJSONObject("defaultModel")
    val defaultModel = if (defaultObj != null) {
        val provider = defaultObj.optString("provider")
        val modelId = defaultObj.optString("modelId")
        if (provider.isNotBlank() && modelId.isNotBlank()) "$provider/$modelId" else null
    } else {
        null
    }
    val connected = mutableListOf<ConnectedProvider>()
    val rawConnected = data.optJSONArray("connectedProviders")
    if (rawConnected != null) {
        for (i in 0 until rawConnected.length()) {
            val entry = rawConnected.optJSONObject(i) ?: continue
            val id = entry.optString("id")
            if (id.isBlank()) continue
            connected.add(
                ConnectedProvider(
                    id = id,
                    name = entry.optString("name").ifBlank { id },
                    disabled = entry.optBoolean("disabled", false),
                ),
            )
        }
    }
    return ModelCatalogState(
        models = models,
        defaultModel = defaultModel,
        connectedProviders = connected,
        unavailable = data.optBoolean("unavailable", false),
    )
}

fun parseRoleMap(data: JSONObject): Map<String, String> {
    val roles = data.optJSONObject("roles") ?: return emptyMap()
    val out = LinkedHashMap<String, String>()
    val keys = roles.keys()
    while (keys.hasNext()) {
        val key = keys.next()
        val value = roles.optString(key)
        if (value.isNotBlank()) out[key] = value
    }
    return out
}

fun optStringList(obj: JSONObject, key: String): List<String> {
    val array = obj.optJSONArray(key) ?: return emptyList()
    val out = mutableListOf<String>()
    for (i in 0 until array.length()) {
        val value = array.optString(i)
        if (value.isNotBlank()) out.add(value)
    }
    return out
}

/**
 * Redaction guard: a redacted provider object must never carry raw secret
 * values — only the `apiKeyConfigured` / `headersConfigured` flags. The
 * panel asserts this before rendering any provider payload.
 */
fun providerRedactionHolds(provider: JSONObject): Boolean =
    !provider.has("apiKey") && !provider.has("headers")

/**
 * Formats a models-domain request failure. Coded server rejections
 * ([RelayRequestException] with the exact wire code, e.g.
 * `models_config_invalid`, `api_key_store_unsupported`, `logout_unsupported`,
 * `login_device_mismatch`) surface the code plus message so capability limits
 * stay visible; transport failures fall back to the action name.
 */
fun modelRequestErrorNote(error: Exception, action: String): String {
    if (error is RelayRequestException && error.code.isNotBlank()) {
        val detail = error.message
        return if (detail.isNullOrBlank()) "${error.code} ($action failed)" else "${error.code}: $detail"
    }
    val detail = error.message
    return if (detail.isNullOrBlank()) "$action failed" else detail
}

fun modelSelectorLabel(selector: String, catalog: List<CatalogModel>): String {
    val match = catalog.firstOrNull { it.selector == selector }
    return if (match != null && match.name != match.id) "${match.name} ($selector)" else selector
}

// ---------------------------------------------------------------------------
// Catalog.
// ---------------------------------------------------------------------------

@Composable
internal fun ModelSearchField(query: String, onQueryChange: (String) -> Unit, modifier: Modifier = Modifier) {
    val korean = Locale.getDefault().language == "ko"
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        label = { Text(if (korean) "모델 검색" else "Search models") },
        leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
        singleLine = true,
        trailingIcon = {
            if (query.isNotEmpty()) {
                androidx.compose.material3.IconButton(onClick = { onQueryChange("") }, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Default.Close, contentDescription = if (korean) "모델 검색 지우기" else "Clear model search")
                }
            }
        },
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
    )
}

@Composable
private fun ModelCatalogSection(
    korean: Boolean,
    catalog: ModelCatalogState,
    loading: Boolean,
    error: String?,
    onRefresh: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var expanded by remember { mutableStateOf(false) }
    ModelSectionHeader(title = if (korean) "모델 카탈로그" else "Model catalog")
    ModelCard {
        ModelRow(
            label = if (korean) "기본 모델(OMP 해석)" else "Default model (resolved by OMP)",
            value = catalog.defaultModel ?: if (korean) "없음" else "None",
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        if (catalog.connectedProviders.isNotEmpty()) {
            Text(
                text = catalog.connectedProviders.joinToString(" · ") {
                    "${it.name}${if (it.disabled) " (disabled)" else ""}"
                },
                fontSize = 12.sp,
                color = OmpColors.TextMuted,
                modifier = Modifier.padding(vertical = 4.dp),
            )
            HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        }
        ModelActionLink(label = if (expanded) "Hide catalog" else "Browse ${catalog.models.size} models", onClick = { expanded = !expanded; query = "" })
        if (expanded) {
        ModelSearchField(query, { query = it })
        var visibleCount by remember { mutableStateOf(60) }
        LaunchedEffect(query, catalog.models) { visibleCount = 60 }
        val matching = remember(query, catalog.models) {
            val q = query.trim().lowercase()
            if (q.isEmpty()) {
                catalog.models
            } else {
                catalog.models.filter {
                    it.provider.lowercase().contains(q) || it.id.lowercase().contains(q) || it.name.lowercase().contains(q)
                }
            }
        }
        val filtered = matching.take(visibleCount)
        if (loading) {
            ModelStatusText(text = if (korean) "불러오는 중…" else "Loading…")
        } else if (filtered.isEmpty()) {
            ModelStatusText(text = if (korean) "모델이 없습니다" else "No models")
        } else {
            Column(modifier = Modifier.fillMaxWidth().heightIn(max = 320.dp).verticalScroll(rememberScrollState())) {
                filtered.forEachIndexed { index, model ->
                    if (index > 0) HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
                    ModelRow(label = model.selector, value = model.name)
                }
                if (matching.size > filtered.size) {
                    ModelStatusText(
                        text = if (korean) {
                            "${filtered.size} / ${matching.size} 표시 중"
                        } else {
                            "Showing ${filtered.size} of ${matching.size}"
                        },
                    )
                    ModelActionLink(
                        label = if (korean) {
                            "더 보기 (+${minOf(60, matching.size - filtered.size)})"
                        } else {
                            "Show more (+${minOf(60, matching.size - filtered.size)})"
                        },
                        onClick = { visibleCount += 60 },
                    )
                }
            }
        }
        }
        if (catalog.unavailable) {
            ModelStatusText(
                text = if (korean) {
                    "모델 목록을 일시적으로 사용할 수 없습니다. 설정을 확인하고 새로고침하세요."
                } else {
                    "Model list is temporarily unavailable. Check configuration and refresh."
                },
            )
        }
        error?.let { ModelErrorText(text = it) }
        ModelActionLink(
            label = if (korean) "새로고침" else "Refresh",
            onClick = onRefresh,
        )
    }
}

// ---------------------------------------------------------------------------
// Roles.
// ---------------------------------------------------------------------------

@Composable
private fun ModelRolesSection(
    korean: Boolean,
    requester: RelayRequester,
    catalog: ModelCatalogState,
) {
    val scope = rememberCoroutineScope()
    var roles by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var loaded by remember { mutableStateOf(false) }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var savedNote by remember { mutableStateOf<String?>(null) }

    fun load() {
        scope.launch {
            pending = true
            error = null
            try {
                val data = requester.request("models", "roles.get", JSONObject())
                roles = parseRoleMap(data)
                loaded = true
            } catch (e: Exception) {
                error = modelRequestErrorNote(e, "roles.get")
            } finally {
                pending = false
            }
        }
    }

    LaunchedEffect(Unit) { load() }

    fun save() {
        scope.launch {
            pending = true
            error = null
            savedNote = null
            try {
                val args = JSONObject().put("roles", JSONObject(sanitizeRolesForSave(roles)))
                val data = requester.request("models", "roles.set", args)
                roles = parseRoleMap(data)
                savedNote = if (korean) "저장됨" else "Saved"
            } catch (e: Exception) {
                // Inputs are kept on failure so nothing the user typed is lost.
                error = modelRequestErrorNote(e, "roles.set")
            } finally {
                pending = false
            }
        }
    }

    ModelSectionHeader(title = if (korean) "모델 역할" else "Model roles")
    ModelCard(disclosure = if (korean) "역할별 모델 및 추론 설정" else "Models and reasoning by role") {
        var pickerFor by remember { mutableStateOf<String?>(null) }
        var pickerQuery by remember { mutableStateOf("") }
        Text(
            text = if (korean) {
                "~/.omp/agent/config.yml의 modelRoles에 저장됩니다. provider/model ID 형식을 사용하세요."
            } else {
                "Stored as modelRoles in ~/.omp/agent/config.yml. Use provider/model IDs."
            },
            fontSize = 12.sp,
            color = OmpColors.TextMuted,
        )
        if (!loaded && pending) {
            ModelStatusText(text = if (korean) "불러오는 중…" else "Loading…")
        } else {
            nativeModelRoles.forEach { role ->
                HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
                val raw = roles[role].orEmpty()
                val modelPart = raw.substringBeforeLast(":", missingDelimiterValue = raw)
                val looksQualified = modelPart.contains("/")
                Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(role, style = MaterialTheme.typography.labelLarge, color = OmpColors.Text)
                            Text(raw.ifBlank { if (korean) "재정의 없음" else "No override" },
                                style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted)
                        }
                        TextButton(onClick = {
                            pickerFor = if (pickerFor == role) null else role
                            pickerQuery = ""
                        }) { Text(if (pickerFor == role) "Close" else "Edit") }
                    }
                    if (raw.isNotBlank() && !looksQualified) {
                        ModelErrorText(
                            text = if (korean) {
                                "모호할 수 있습니다. provider/model 형식을 권장합니다."
                            } else {
                                "May be ambiguous. Prefer provider/model form."
                            },
                        )
                    } else if (raw.isNotBlank()) {
                        Text(
                            text = modelSelectorLabel(modelPart, catalog.models),
                            fontSize = 12.sp,
                            color = OmpColors.TextMuted,
                        )
                    }
                    if (pickerFor == role) {
                        ModelTextField(raw, { roles = roles + (role to it) }, "provider/model[:effort]")
                        ModelSearchField(pickerQuery, { pickerQuery = it })
                        val q = pickerQuery.trim()
                        val options = catalog.models
                            .filter { q.isEmpty() || it.selector.contains(q, ignoreCase = true) || it.name.contains(q, ignoreCase = true) }
                        if (options.isEmpty()) ModelStatusText(if (korean) "검색 결과가 없습니다" else "No matching models")
                        Column(Modifier.fillMaxWidth().heightIn(max = 320.dp).verticalScroll(rememberScrollState())) {
                        options.forEach { option ->
                            Text(
                                text = "${option.name} (${option.selector})",
                                fontSize = 13.sp,
                                color = OmpColors.Text,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .heightIn(min = 48.dp)
                                    .clip(RoundedCornerShape(6.dp))
                                    .clickable {
                                        val effort = raw.substringAfterLast(":", missingDelimiterValue = "")
                                        val suffix = if (effort.isNotEmpty() && !effort.contains("/")) ":$effort" else ""
                                        roles = roles + (role to (option.selector + suffix))
                                        pickerFor = null
                                    }
                                    .padding(horizontal = 4.dp, vertical = 6.dp),
                            )
                        }
                        }
                        if (raw.isNotBlank()) {
                            ModelActionLink(
                                label = if (korean) "비우기 (override 없음)" else "Clear (no override)",
                                danger = true,
                                onClick = {
                                    roles = roles + (role to "")
                                    pickerFor = null
                                },
                            )
                        }
                    }
                }
            }
        }
        error?.let { ModelErrorText(text = it) }
        savedNote?.let { ModelStatusText(text = it) }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ModelActionLink(
                label = if (pending) {
                    if (korean) "처리 중…" else "Working…"
                } else {
                    if (korean) "역할 저장" else "Save roles"
                },
                onClick = { if (!pending) save() },
                primary = true,
                enabled = !pending,
            )
            ModelActionLink(
                label = if (korean) "다시 불러오기" else "Reload",
                onClick = { if (!pending) load() },
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Native registry: allow-list, disabled providers, provider order.
// ---------------------------------------------------------------------------

@Composable
private fun ModelRegistrySection(
    korean: Boolean,
    requester: RelayRequester,
    catalog: ModelCatalogState,
) {
    val scope = rememberCoroutineScope()
    var enabledModels by remember { mutableStateOf<List<String>?>(null) }
    var disabledProviders by remember { mutableStateOf<List<String>>(emptyList()) }
    var providerOrder by remember { mutableStateOf<List<String>>(emptyList()) }
    var scopedEntries by remember { mutableStateOf(false) }
    var restrict by remember { mutableStateOf(false) }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var savedNote by remember { mutableStateOf<String?>(null) }

    fun load() {
        scope.launch {
            pending = true
            error = null
            try {
                val data = requester.request("models", "registry.get", JSONObject())
                val settings = data.optJSONObject("settings") ?: JSONObject()
                val allow = if (settings.has("enabledModels")) optStringList(settings, "enabledModels") else null
                enabledModels = allow
                restrict = (allow?.size ?: 0) > 0
                disabledProviders = optStringList(settings, "disabledProviders")
                providerOrder = optStringList(settings, "modelProviderOrder")
                scopedEntries = settings.optBoolean("registryHasScopedEntries", false)
            } catch (e: Exception) {
                error = modelRequestErrorNote(e, "registry.get")
            } finally {
                pending = false
            }
        }
    }

    LaunchedEffect(Unit) { load() }

    fun save(next: JSONObject) {
        scope.launch {
            pending = true
            error = null
            savedNote = null
            try {
                val data = requester.request("models", "registry.set", next)
                val settings = data.optJSONObject("settings") ?: JSONObject()
                enabledModels = if (settings.has("enabledModels")) optStringList(settings, "enabledModels") else null
                restrict = (enabledModels?.size ?: 0) > 0
                disabledProviders = optStringList(settings, "disabledProviders")
                providerOrder = optStringList(settings, "modelProviderOrder")
                savedNote = if (korean) "저장됨" else "Saved"
            } catch (e: Exception) {
                error = modelRequestErrorNote(e, "registry.set")
            } finally {
                pending = false
            }
        }
    }

    val allSelectors = remember(catalog.models, enabledModels) {
        val fromCatalog = catalog.models.map { it.selector }
        val extra = (enabledModels ?: emptyList()).filter { it !in fromCatalog }
        fromCatalog + extra
    }
    val allowSet = remember(enabledModels, allSelectors) {
        enabledModels?.toSet() ?: allSelectors.toSet()
    }
    val providers = remember(catalog.models, disabledProviders) {
        val union = LinkedHashSet<String>()
        union.addAll(catalog.models.map { it.provider })
        union.addAll(disabledProviders)
        union.addAll(providerOrder)
        union.sorted()
    }
    val orderedProviders = remember(providers, providerOrder) {
        providerOrder.filter { it in providers } + providers.filter { it !in providerOrder }
    }

    ModelSectionHeader(title = if (korean) "네이티브 레지스트리" else "Native registry")
    ModelCard(disclosure = "Model availability and provider order") {
        Text(
            text = "config.yml · enabledModels / disabledProviders / modelProviderOrder",
            fontSize = 12.sp,
            color = OmpColors.TextMuted,
        )
        if (scopedEntries) {
            ModelErrorText(
                text = if (korean) {
                    "경로 범위 항목이 설정되어 있습니다. config.yml을 직접 편집하세요."
                } else {
                    "Path-scoped registry entries are configured. Edit config.yml directly."
                },
            )
        }
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        ModelToggleRow(
            label = if (korean) "선택한 모델만 허용" else "Restrict to selected models",
            checked = restrict,
            enabled = !pending && !scopedEntries,
            onCheckedChange = { checked ->
                restrict = checked
                val next = JSONObject()
                if (checked) {
                    next.put("enabledModels", JSONArray(allSelectors))
                } else {
                    next.put("enabledModels", JSONArray())
                }
                save(next)
            },
        )
        if (restrict) {
            var query by remember { mutableStateOf("") }
            ModelSearchField(query, { query = it })
            val q = query.trim()
            val names = remember(catalog.models) { catalog.models.associate { it.selector to it.name } }
            val visible = allSelectors
                .filter { q.isEmpty() || it.contains(q, ignoreCase = true) || names[it]?.contains(q, ignoreCase = true) == true }
            if (visible.isEmpty()) ModelStatusText(if (korean) "검색 결과가 없습니다" else "No matching models")
            Column(Modifier.fillMaxWidth().heightIn(max = 320.dp).verticalScroll(rememberScrollState())) {
            visible.forEach { selector ->
                ModelCheckRow(
                    label = selector,
                    checked = selector in allowSet,
                    enabled = !pending && !scopedEntries,
                    onCheckedChange = { checked ->
                        val next = allowSet.toMutableSet()
                        if (checked) next.add(selector) else next.remove(selector)
                        enabledModels = next.toList()
                        save(JSONObject().put("enabledModels", JSONArray(next.toList())))
                    },
                )
            }
        }
        }
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        Text(
            text = if (korean) "비활성 제공자" else "Disabled providers",
            fontSize = 14.sp,
            color = OmpColors.Text,
        )
        providers.forEach { provider ->
            ModelCheckRow(
                label = provider,
                checked = provider in disabledProviders,
                enabled = !pending && !scopedEntries,
                onCheckedChange = { checked ->
                    val next = disabledProviders.toMutableSet()
                    if (checked) next.add(provider) else next.remove(provider)
                    disabledProviders = next.toList()
                    save(JSONObject().put("disabledProviders", JSONArray(next.toList())))
                },
            )
        }
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        Text(
            text = if (korean) "제공자 우선순위" else "Provider order",
            fontSize = 14.sp,
            color = OmpColors.Text,
        )
        orderedProviders.forEachIndexed { index, provider ->
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "${index + 1}. $provider",
                    fontSize = 13.sp,
                    color = OmpColors.Text,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (index > 0) {
                    Icon(
                        imageVector = Icons.Default.ArrowUpward,
                        contentDescription = null,
                        tint = OmpColors.TextMuted,
                        modifier = Modifier.size(48.dp).semantics { contentDescription = "Move $provider up" }
                            .clickable(enabled = !pending && !scopedEntries, role = Role.Button) {
                            val next = orderedProviders.toMutableList()
                            val tmp = next[index - 1]
                            next[index - 1] = next[index]
                            next[index] = tmp
                            providerOrder = next
                            save(JSONObject().put("modelProviderOrder", JSONArray(next)))
                        }.padding(14.dp),
                    )
                }
                if (index < orderedProviders.lastIndex) {
                    Icon(
                        imageVector = Icons.Default.ArrowDownward,
                        contentDescription = null,
                        tint = OmpColors.TextMuted,
                        modifier = Modifier.size(48.dp).semantics { contentDescription = "Move $provider down" }
                            .clickable(enabled = !pending && !scopedEntries, role = Role.Button) {
                            val next = orderedProviders.toMutableList()
                            val tmp = next[index + 1]
                            next[index + 1] = next[index]
                            next[index] = tmp
                            providerOrder = next
                            save(JSONObject().put("modelProviderOrder", JSONArray(next)))
                        }.padding(14.dp),
                    )
                }
            }
        }
        error?.let { ModelErrorText(text = it) }
        savedNote?.let { ModelStatusText(text = it) }
    }
}

// ---------------------------------------------------------------------------
// Custom providers (models.yml redacted editor).
// ---------------------------------------------------------------------------

@Composable
private fun ModelProvidersSection(
    korean: Boolean,
    requester: RelayRequester,
    @Suppress("UNUSED_PARAMETER") catalog: ModelCatalogState,
) {
    val scope = rememberCoroutineScope()
    var providers by remember { mutableStateOf<Map<String, ProviderDraft>>(emptyMap()) }
    var redactedConfig by remember { mutableStateOf(JSONObject()) }
    var parseError by remember { mutableStateOf<String?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var note by remember { mutableStateOf<String?>(null) }
    var search by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf<String?>(null) }
    var pendingDelete by remember { mutableStateOf<String?>(null) }
    var newName by remember { mutableStateOf("") }
    var validating by remember { mutableStateOf(false) }

    fun load() {
        scope.launch {
            pending = true
            error = null
            note = null
            try {
                val data = requester.request("models", "providers.get", JSONObject())
                val rawError = data.optString("parseError")
                parseError = rawError.ifBlank { null }
                val rawProviders = data.optJSONObject("providers") ?: JSONObject()
                val next = LinkedHashMap<String, ProviderDraft>()
                val keys = rawProviders.keys()
                while (keys.hasNext()) {
                    val name = keys.next()
                    val obj = rawProviders.optJSONObject(name) ?: continue
                    next[name] = providerDraftFromJson(name, obj)
                }
                redactedConfig = data
                providers = next
                loaded = true
                if (selected != null && selected !in next) selected = null
            } catch (e: Exception) {
                error = modelRequestErrorNote(e, "providers.get")
            } finally {
                pending = false
            }
        }
    }

    LaunchedEffect(Unit) { load() }

    fun saveDrafts(drafts: Map<String, ProviderDraft>, mode: String, overwrite: Boolean = false) {
        scope.launch {
            pending = true
            error = null
            note = null
            try {
                val config = providerConfigUpdate(redactedConfig, drafts)
                val args = JSONObject()
                    .put("config", config)
                    .put("mode", mode)
                if (overwrite) args.put("overwrite", true)
                requester.request("models", "providers.update", args)
                note = if (korean) "저장됨" else "Saved"
                load()
            } catch (e: Exception) {
                error = modelRequestErrorNote(e, "providers.update")
            } finally {
                pending = false
            }
        }
    }

    fun validateCurrent() {
        val target = selected?.let { providers[it] } ?: return
        scope.launch {
            validating = true
            error = null
            note = null
            try {
                val config = JSONObject().put(
                    "providers",
                    JSONObject().put(target.name.ifBlank { target.originalName.orEmpty() }, target.toUpdateJson()),
                )
                requester.request("models", "providers.validate", JSONObject().put("config", config))
                note = if (korean) "유효합니다" else "Valid"
            } catch (e: Exception) {
                error = modelRequestErrorNote(e, "providers.validate")
            } finally {
                validating = false
            }
        }
    }

    ModelSectionHeader(title = if (korean) "사용자 제공자 (models.yml)" else "Custom providers (models.yml)")
    ModelCard {
        Text(
            text = if (korean) {
                "API 키와 헤더는 쓰기 전용입니다. 저장된 값은 표시되지 않으며, 비워 두면 유지되고 명시적으로 지울 수 있습니다."
            } else {
                "API keys and headers are write-only. Stored values are never shown; leaving the field empty preserves them, explicit clear removes them."
            },
            fontSize = 12.sp,
            color = OmpColors.TextMuted,
        )
        parseError?.let {
            ModelErrorText(
                text = if (korean) {
                    "models.yml 파싱 실패: 손으로 고친 뒤 덮어쓰기를 확인하세요. ($it)"
                } else {
                    "models.yml parse failure: fix it by hand before overwriting. ($it)"
                },
            )
        }
        if (!loaded && pending) {
            ModelStatusText(text = if (korean) "불러오는 중…" else "Loading…")
        } else {
            ModelTextField(
                value = search,
                onValueChange = { search = it },
                placeholder = if (korean) "제공자 검색" else "Search providers",
            )
            val q = search.trim().lowercase()
            val visible = providers.keys
                .filter { q.isEmpty() || it.lowercase().contains(q) }
                .sorted()
            if (visible.isEmpty()) {
                ModelStatusText(text = if (korean) "제공자가 없습니다" else "No providers")
            } else {
                visible.forEach { name ->
                    val draft = providers[name] ?: return@forEach
                    HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .clickable { selected = if (selected == name) null else name }
                            .padding(vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(text = name, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = OmpColors.Text)
                            Text(
                                text = listOfNotNull(
                                    draft.baseUrl.ifBlank { null },
                                    if (draft.apiKeyConfigured) "key set" else "no key",
                                    if (draft.headersConfigured) "headers set" else null,
                                    "${draft.models.size} models",
                                ).joinToString(" · "),
                                fontSize = 12.sp,
                                color = OmpColors.TextMuted,
                            )
                        }
                        Icon(
                            imageVector = if (selected == name) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                            contentDescription = if (selected == name) "Collapse $name" else "Edit $name",
                            tint = OmpColors.TextMuted,
                            modifier = Modifier.padding(horizontal = 8.dp).size(20.dp),
                        )
                    }
                    if (selected == name) {
                        ProviderEditor(
                            requester = requester,
                            korean = korean,
                            draft = draft,
                            pending = pending,
                            validating = validating,
                            onChange = { next -> providers = providers + (name to next) },
                            onRename = { renamed ->
                                val trimmed = renamed.trim()
                                if (trimmed in providers && trimmed != name) {
                                    error = "Provider name already exists"
                                } else if (trimmed.isNotBlank() && trimmed != name) {
                                    providers = providers - name + (trimmed to draft.copy(name = trimmed))
                                    selected = trimmed
                                }
                            },
                            onValidate = ::validateCurrent,
                            onSave = { saveDrafts(providers, "full") },
                            onDelete = { pendingDelete = name },
                            onTestModel = { model ->
                                scope.launch {
                                    pending = true
                                    error = null
                                    note = null
                                    try {
                                        val providerObj = draft.toUpdateJson().apply {
                                            remove("originalName")
                                        }
                                        val modelObj = JSONObject()
                                            .put("id", model.id.ifBlank { model.originalId.orEmpty() })
                                            .apply {
                                                if (model.api.isNotBlank()) put("api", model.api)
                                            }
                                        val args = JSONObject()
                                            .put("providerName", draft.name.ifBlank { draft.originalName.orEmpty() })
                                            .put("provider", providerObj)
                                            .put("model", modelObj)
                                        val data = requester.request("models", "providers.test", args)
                                        note = data.optString("responseText").ifBlank {
                                            if (korean) "테스트 성공" else "Test passed"
                                        }
                                    } catch (e: Exception) {
                                        error = modelRequestErrorNote(e, "providers.test")
                                    } finally {
                                        pending = false
                                    }
                                }
                            },
                        )
                    }
                }
            }
            HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
            Row(verticalAlignment = Alignment.CenterVertically) {
                ModelInlineField(
                    value = newName,
                    onValueChange = { newName = it },
                    placeholder = if (korean) "새 제공자 이름" else "New provider name",
                    modifier = Modifier.weight(1f),
                )
                Spacer(modifier = Modifier.width(8.dp))
                ModelActionLink(
                    label = if (korean) "추가" else "Add",
                    onClick = {
                        val trimmed = newName.trim()
                        if (trimmed.isBlank() || trimmed in providers) return@ModelActionLink
                        providers = providers + (
                            trimmed to ProviderDraft(
                                originalName = null,
                                name = trimmed,
                                baseUrl = "",
                                api = "openai-completions",
                                auth = "",
                                apiKeyInput = "",
                                apiKeyTouched = false,
                                clearKey = false,
                                apiKeyConfigured = false,
                                headersConfigured = false,
                                headerRows = emptyList(),
                                headersTouched = false,
                                clearHeaders = false,
                                models = emptyList(),
                            )
                        )
                        selected = trimmed
                        newName = ""
                    },
                )
            }
        }
        error?.let { ModelErrorText(text = it) }
        note?.let { ModelStatusText(text = it) }
        ModelActionLink(
            label = if (korean) "다시 불러오기" else "Reload",
            onClick = { if (!pending) load() },
        )
    }

    pendingDelete?.let { name ->
        val doomed = providers[name]
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { pendingDelete = null },
            containerColor = OmpColors.BgPanel,
            title = {
                OmpDialogSystemBars()
                Text(
                    if (korean) "제공자 삭제" else "Delete provider",
                    color = OmpColors.Text,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                )
            },
            text = {
                Text(
                    if (korean) {
                        "$name 및 모델을 models.yml에서 삭제합니다. 전체 스냅샷으로 저장됩니다."
                    } else {
                        "Delete $name and its models from models.yml. Saved as a full snapshot."
                    },
                    modifier = Modifier.heightIn(max = 480.dp).verticalScroll(rememberScrollState()),
                    color = OmpColors.TextMuted,
                    fontSize = 13.sp,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    if (doomed != null) saveDrafts(providers - name, "full")
                    pendingDelete = null
                }) { Text(if (korean) "삭제" else "Delete", color = OmpColors.StatusError) }
            },
            dismissButton = {
                TextButton(onClick = { pendingDelete = null }) {
                    Text(if (korean) "취소" else "Cancel", color = OmpColors.TextMuted)
                }
            },
        )
    }
}

@Composable
private fun ProviderEditor(
    requester: RelayRequester,
    korean: Boolean,
    draft: ProviderDraft,
    pending: Boolean,
    validating: Boolean,
    onChange: (ProviderDraft) -> Unit,
    onRename: (String) -> Unit,
    onValidate: () -> Unit,
    onSave: () -> Unit,
    onDelete: () -> Unit,
    onTestModel: (ModelDraft) -> Unit,
) {
    var rename by remember(draft.name) { mutableStateOf(draft.name) }
    var catalogOpen by remember { mutableStateOf(false) }
    val draftError = remember(draft) { runCatching { draft.toUpdateJson() }.exceptionOrNull()?.message }
    if (catalogOpen) ModelCatalogSheet(requester, draft, { onChange(it); catalogOpen = false }, { catalogOpen = false })
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ModelSectionHeader(if (korean) "연결 설정" else "Connection settings")
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            ModelInlineField(
                value = rename,
                onValueChange = { rename = it },
                placeholder = if (korean) "제공자 이름" else "Provider name",
                modifier = Modifier.fillMaxWidth(),
            )
            if (rename.trim().isNotBlank() && rename.trim() != draft.name) {
                Spacer(modifier = Modifier.width(8.dp))
                ModelActionLink(label = if (korean) "이름 변경" else "Rename", onClick = { onRename(rename) })
            }
        }
        ModelTextField(
            value = draft.baseUrl,
            onValueChange = { onChange(draft.copy(baseUrl = it)) },
            placeholder = "Base URL (https://api.example.com/v1)",
        )
        ModelSelect(
            label = "API protocol",
            options = modelApiOptions,
            selected = draft.api.ifBlank { "openai-completions" },
            onSelect = { onChange(draft.copy(api = it)) },
        )
        ModelSelect(
            label = "Authentication",
            options = listOf("apiKey", "none", "oauth"),
            selected = draft.auth.ifBlank { "apiKey" },
            onSelect = { onChange(draft.copy(auth = if (it == "apiKey") "" else it)) },
        )
        val keyState = when {
            draft.clearKey -> if (korean) "삭제 예정" else "Will clear"
            draft.apiKeyConfigured && !draft.apiKeyTouched -> if (korean) "설정됨 (유지)" else "Set (preserved)"
            draft.apiKeyTouched && draft.apiKeyInput.isNotBlank() -> if (korean) "새 값 입력됨" else "New value entered"
            else -> if (korean) "미설정" else "Not set"
        }
        ModelSectionHeader(if (korean) "인증 정보" else "Credentials")
        Text(text = "API key · $keyState", fontSize = 12.sp, color = OmpColors.TextMuted)
        ModelTextField(
            value = draft.apiKeyInput,
            secret = true,
            onValueChange = { onChange(draft.copy(apiKeyInput = it, apiKeyTouched = true, clearKey = false)) },
            placeholder = if (korean) "새 키 입력 (비워 두면 유지)" else "Enter new key (empty preserves)",
        )
        if (draft.apiKeyConfigured) {
            ModelActionLink(
                label = if (draft.clearKey) {
                    if (korean) "삭제 취소" else "Undo clear"
                } else {
                    if (korean) "저장된 키 삭제" else "Clear stored key"
                },
                onClick = { onChange(draft.copy(clearKey = !draft.clearKey, apiKeyInput = "", apiKeyTouched = false)) },
            )
        }
        val headersState = when {
            draft.clearHeaders -> if (korean) "삭제 예정" else "Will clear"
            draft.headersTouched -> if (korean) "새 값 저장 예정 (${draft.headerRows.size}개)" else "${draft.headerRows.size} new entries to save"
            draft.headersConfigured -> if (korean) "설정됨 (값 표시 안 됨, 유지)" else "Set (values hidden, preserved)"
            else -> if (korean) "미설정" else "Not set"
        }
        ModelSectionHeader(if (korean) "요청 헤더" else "Request headers")
        Text(text = headersState, fontSize = 12.sp, color = OmpColors.TextMuted)
        draft.headerRows.forEachIndexed { index, row ->
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                ModelInlineField(
                    value = row.name,
                    onValueChange = { next ->
                        val rows = draft.headerRows.toMutableList()
                        rows[index] = row.copy(name = next)
                        onChange(draft.copy(headerRows = rows, headersTouched = true, clearHeaders = false))
                    },
                    placeholder = "Header name (X-Custom)",
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(modifier = Modifier.width(8.dp))
                ModelInlineField(
                    value = row.value,
                    secret = true,
                    onValueChange = { next ->
                        val rows = draft.headerRows.toMutableList()
                        rows[index] = row.copy(value = next)
                        onChange(draft.copy(headerRows = rows, headersTouched = true, clearHeaders = false))
                    },
                    placeholder = "Header value",
                    modifier = Modifier.fillMaxWidth(),
                )
                ModelActionLink(label = "Remove header", danger = true, onClick = {
                    onChange(draft.copy(headerRows = draft.headerRows.filterIndexed { i, _ -> i != index }, headersTouched = true, clearHeaders = false))
                })
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ModelActionLink(
                label = if (korean) "헤더 추가" else "Add header",
                onClick = { onChange(draft.copy(headerRows = draft.headerRows + HeaderRow("", ""), headersTouched = true, clearHeaders = false)) },
            )
            if (draft.headersConfigured || draft.headersTouched) {
                ModelActionLink(
                    label = if (draft.clearHeaders) {
                        if (korean) "삭제 취소" else "Undo clear"
                    } else {
                        if (korean) "헤더 삭제" else "Clear headers"
                    },
                    onClick = { onChange(draft.copy(clearHeaders = !draft.clearHeaders)) },
                )
            }
        }
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        AdvancedDraftFields(draft.redacted, draft.advanced, true) { onChange(draft.copy(advanced = it)) }
        ModelActionLink(label = "Add from models.dev", onClick = { catalogOpen = true })
        Text(text = if (korean) "모델 (${draft.models.size})" else "Models (${draft.models.size})", fontSize = 14.sp, color = OmpColors.Text)
        draft.models.forEachIndexed { index, model ->
            ModelDraftEditor(
                korean = korean,
                model = model,
                onChange = { next ->
                    val models = draft.models.toMutableList()
                    models[index] = next
                    onChange(draft.copy(models = models))
                },
                onDelete = {
                    onChange(draft.copy(models = draft.models.filterIndexed { i, _ -> i != index }))
                },
                onTest = { onTestModel(model) },
            )
        }
        ModelActionLink(
            label = if (korean) "모델 추가" else "Add model",
            onClick = {
                onChange(
                    draft.copy(
                        models = draft.models + ModelDraft(
                            originalId = null,
                            id = "",
                            name = "",
                            api = "",
                            baseUrl = "",
                            reasoning = false,
                            contextWindow = "",
                            maxTokens = "",
                        ),
                    ),
                )
            },
        )
        if (draftError != null) Text(draftError, color = OmpColors.StatusError, fontSize = 12.sp)
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ModelActionLink(
                label = if (pending) {
                    if (korean) "저장 중…" else "Saving…"
                } else {
                    if (korean) "제공자 저장" else "Save providers"
                },
                onClick = { if (!pending && draftError == null) onSave() },
                primary = true,
                enabled = !pending && draftError == null,
            )
            ModelActionLink(
                label = if (validating) {
                    if (korean) "검사 중…" else "Validating…"
                } else {
                    if (korean) "유효성 검사" else "Validate"
                },
                onClick = { if (!validating && !pending && draftError == null) onValidate() },
            )
            ModelActionLink(
                label = if (korean) "제공자 삭제" else "Delete provider",
                danger = true,
                onClick = onDelete,
            )
        }
    }
}

@Composable
private fun AdvancedDraftFields(baseline: JSONObject, edits: Map<String, String>, provider: Boolean, onChange: (Map<String, String>) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    ModelActionLink(label = if (expanded) "Hide advanced" else "Advanced settings", onClick = { expanded = !expanded })
    if (!expanded) return
    val fields = if (provider) listOf("compat", "modelOverrides", "extensions") else listOf(
        "input", "cost.input", "cost.output", "cost.cacheRead", "cost.cacheWrite",
        "thinking.mode", "thinking.efforts", "thinking.defaultLevel", "thinking.effortMap", "compat", "extensions",
    )
    Text("Empty removes a field. JSON controls accept objects; extensions cannot replace standard fields.", fontSize = 12.sp, color = OmpColors.TextMuted)
    for (field in fields) {
        val group = when (field) {
            "input" -> "Input"
            "cost.input" -> "Cost · USD / million tokens"
            "thinking.mode" -> "Thinking"
            "compat" -> "Compatibility"
            "modelOverrides" -> "Model overrides"
            "extensions" -> "Additional fields"
            else -> null
        }
        if (group != null) ModelSectionHeader(group)
        val label = when (field) {
            "input" -> "Input modalities (text, image)"
            "thinking.mode" -> "Thinking mode (e.g. effort, budget)"
            "thinking.efforts" -> "Thinking efforts (comma-separated)"
            "thinking.defaultLevel" -> "Default thinking level"
            "thinking.effortMap" -> "Effort map (JSON string values)"
            "compat", "modelOverrides", "extensions" -> "$field (JSON object)"
            else -> "$field (USD / million tokens)"
        }
        val value = advancedDraftValue(baseline, edits, field, provider)
        OutlinedTextField(
            value = value,
            onValueChange = { onChange(edits + (field to it)) },
            label = { Text(label, style = MaterialTheme.typography.bodySmall) },
            textStyle = MaterialTheme.typography.bodyMedium.copy(color = OmpColors.Text),
            minLines = 1, maxLines = 6,
            shape = RoundedCornerShape(8.dp), modifier = Modifier.fillMaxWidth(),
        )
    }
    val error = runCatching { applyAdvancedDraft(baseline, edits, provider) }.exceptionOrNull()?.message
    if (error != null) Text(error, color = OmpColors.StatusError, fontSize = 12.sp)
}

@Composable
private fun ModelDraftEditor(
    korean: Boolean,
    model: ModelDraft,
    onChange: (ModelDraft) -> Unit,
    onDelete: () -> Unit,
    onTest: () -> Unit,
) {
    var expanded by remember(model.originalId) { mutableStateOf(model.id.isBlank()) }
    Column(
        modifier = Modifier.fillMaxWidth()
            .border(1.dp, OmpColors.Border, RoundedCornerShape(8.dp)).padding(horizontal = 12.dp, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(model.name.ifBlank { model.id.ifBlank { "New model" } },
                    style = MaterialTheme.typography.titleSmall, color = OmpColors.Text,
                    maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (model.name.isNotBlank()) Text(model.id, style = MaterialTheme.typography.bodySmall,
                    color = OmpColors.TextMuted, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            TextButton(onClick = { expanded = !expanded }) { Text(if (expanded) "Close" else "Edit") }
        }
        if (expanded) {
            ModelTextField(model.id, { onChange(model.copy(id = it)) }, "Model ID (required)")
            ModelTextField(model.name, { onChange(model.copy(name = it)) }, if (korean) "표시 이름 (선택)" else "Display name (optional)")
            ModelSelect("API", listOf("inherit") + modelApiOptions, model.api.ifBlank { "inherit" },
                { onChange(model.copy(api = if (it == "inherit") "" else it)) })
            ModelTextField(model.baseUrl, { onChange(model.copy(baseUrl = it)) }, "Model base URL (empty inherits)")
            ModelToggleRow("Reasoning", model.reasoning, { onChange(model.copy(reasoning = it)) })
            ModelSectionHeader(if (korean) "토큰 제한" else "Token limits")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ModelInlineField(model.contextWindow, { onChange(model.copy(contextWindow = it)) },
                    "Context window (tokens)", Modifier.weight(1f))
                ModelInlineField(model.maxTokens, { onChange(model.copy(maxTokens = it)) },
                    "Maximum output (tokens)", Modifier.weight(1f))
            }
            AdvancedDraftFields(model.redacted, model.advanced, false) { onChange(model.copy(advanced = it)) }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ModelActionLink(if (korean) "연결 테스트" else "Test connection", onTest)
                ModelActionLink(if (korean) "모델 삭제" else "Remove model", onDelete, danger = true)
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Fallback chains.
// ---------------------------------------------------------------------------

@Composable
private fun ModelFallbackSection(
    korean: Boolean,
    requester: RelayRequester,
    catalog: ModelCatalogState,
) {
    val scope = rememberCoroutineScope()
    var chains by remember { mutableStateOf<Map<String, List<String>>>(emptyMap()) }
    var enabled by remember { mutableStateOf<Boolean?>(null) }
    var maxRetries by remember { mutableStateOf<Int?>(null) }
    var modelFallback by remember { mutableStateOf<Boolean?>(null) }
    var revertPolicy by remember { mutableStateOf<String?>(null) }
    var role by remember { mutableStateOf("default") }
    var candidate by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var note by remember { mutableStateOf<String?>(null) }

    fun load() {
        scope.launch {
            pending = true
            error = null
            try {
                val data = requester.request("models", "fallback.get", JSONObject())
                val rawChains = data.optJSONObject("chains") ?: JSONObject()
                val next = LinkedHashMap<String, List<String>>()
                val keys = rawChains.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    val list = mutableListOf<String>()
                    val arr = rawChains.optJSONArray(key)
                    if (arr != null) {
                        for (i in 0 until arr.length()) {
                            val selector = arr.optString(i)
                            if (selector.isNotBlank()) list.add(selector)
                        }
                    }
                    next[key] = list
                }
                chains = next
                if (data.has("enabled")) enabled = data.optBoolean("enabled")
                if (data.has("maxRetries")) maxRetries = data.optInt("maxRetries")
                if (data.has("modelFallback")) modelFallback = data.optBoolean("modelFallback")
                if (data.has("revertPolicy")) revertPolicy = data.optString("revertPolicy")
            } catch (e: Exception) {
                error = modelRequestErrorNote(e, "fallback.get")
            } finally {
                pending = false
            }
        }
    }

    LaunchedEffect(Unit) { load() }

    fun save(args: JSONObject) {
        scope.launch {
            pending = true
            error = null
            note = null
            try {
                requester.request("models", "fallback.set", args)
                note = if (korean) "저장됨" else "Saved"
                load()
            } catch (e: Exception) {
                error = modelRequestErrorNote(e, "fallback.set")
            } finally {
                pending = false
            }
        }
    }

    fun saveChains(next: Map<String, List<String>>) {
        chains = next
        val chainsObj = JSONObject()
        for ((key, value) in next) chainsObj.put(key, JSONArray(value))
        save(JSONObject().put("chains", chainsObj))
    }

    val chain = chains[role].orEmpty()
    ModelSectionHeader(title = if (korean) "폴백 체인" else "Fallback chains")
    ModelCard(disclosure = "Retry behavior and fallback chains") {
        var candidateQuery by remember(role) { mutableStateOf("") }
        val cq = candidateQuery.trim()
        val options = catalog.models.filter {
            (cq.isEmpty() || it.selector.contains(cq, ignoreCase = true) || it.name.contains(cq, ignoreCase = true)) && it.selector !in chain
        }
        Text(
            text = "retry · fallbackChains / maxRetries / modelFallback / revertPolicy",
            fontSize = 12.sp,
            color = OmpColors.TextMuted,
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        ModelSelect(
            label = if (korean) "역할" else "Role",
            options = (nativeModelRoles + chains.keys).distinct(),
            selected = role,
            onSelect = {
                role = it
                candidate = ""
                candidateQuery = ""
            },
        )
        if (chain.isEmpty()) {
            ModelStatusText(
                text = if (korean) "명시적 체인이 없습니다. OMP 기본 동작을 사용합니다." else "No explicit chain. OMP uses its default fallback behavior.",
            )
        } else {
            chain.forEachIndexed { index, selector ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = "${index + 1}. $selector",
                        fontSize = 13.sp,
                        color = OmpColors.Text,
                        modifier = Modifier.weight(1f),
                    )
                    if (index > 0) {
                        Icon(
                            imageVector = Icons.Default.ArrowUpward,
                            contentDescription = null,
                            tint = OmpColors.TextMuted,
                            modifier = Modifier.size(48.dp).semantics { contentDescription = "Move $selector up" }
                                .clickable(enabled = !pending, role = Role.Button) {
                                val next = chain.toMutableList()
                                val tmp = next[index - 1]
                                next[index - 1] = next[index]
                                next[index] = tmp
                                saveChains(chains + (role to next))
                            }.padding(14.dp),
                        )
                    }
                    if (index < chain.lastIndex) {
                        Icon(
                            imageVector = Icons.Default.ArrowDownward,
                            contentDescription = null,
                            tint = OmpColors.TextMuted,
                            modifier = Modifier.size(48.dp).semantics { contentDescription = "Move $selector down" }
                                .clickable(enabled = !pending, role = Role.Button) {
                                val next = chain.toMutableList()
                                val tmp = next[index + 1]
                                next[index + 1] = next[index]
                                next[index] = tmp
                                saveChains(chains + (role to next))
                            }.padding(14.dp),
                        )
                    }
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = null,
                        tint = OmpColors.StatusError,
                        modifier = Modifier.size(48.dp).semantics { contentDescription = "Remove $selector from fallback chain" }
                            .clickable(enabled = !pending, role = Role.Button) {
                            saveChains(chains + (role to chain.filterIndexed { i, _ -> i != index }))
                        }.padding(14.dp),
                    )
                }
            }
        }
        ModelSearchField(candidateQuery, { candidateQuery = it })
        if (options.isEmpty()) ModelStatusText(if (korean) "검색 결과가 없습니다" else "No matching models")
        Column(Modifier.fillMaxWidth().heightIn(max = 320.dp).verticalScroll(rememberScrollState())) {
            options.forEach { option ->
                Text(
                    text = "${option.name} (${option.selector})",
                    fontSize = 13.sp,
                    color = if (candidate == option.selector) OmpColors.Accent else OmpColors.Text,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .clickable {
                            candidate = option.selector
                            saveChains(chains + (role to (chain + option.selector)))
                            candidateQuery = ""
                            candidate = ""
                        }
                        .padding(horizontal = 4.dp, vertical = 6.dp),
                )
            }
        }
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        if (enabled != null) {
            ModelToggleRow(
                label = "retry.enabled",
                checked = enabled == true,
                onCheckedChange = { save(JSONObject().put("enabled", it)) },
            )
            HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        }
        ModelSelect(
            label = "retry.maxRetries (0–20)",
            options = (0..20).map { it.toString() },
            selected = (maxRetries ?: 10).toString(),
            onSelect = { save(JSONObject().put("maxRetries", it.toInt())) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        if (modelFallback != null) {
            ModelToggleRow(
                label = "retry.modelFallback",
                checked = modelFallback == true,
                onCheckedChange = { save(JSONObject().put("modelFallback", it)) },
            )
            HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        }
        ModelSelect(
            label = "retry.fallbackRevertPolicy",
            options = listOf("cooldown-expiry", "never"),
            selected = revertPolicy ?: "cooldown-expiry",
            onSelect = { save(JSONObject().put("revertPolicy", it)) },
        )
        error?.let { ModelErrorText(text = it) }
        note?.let { ModelStatusText(text = it) }
    }
}

// ---------------------------------------------------------------------------
// Auth: login tunnel (OAuth URL + code confirm), API-key status, logout.
// ---------------------------------------------------------------------------

private data class LoginUiState(
    val token: String,
    val phase: String = "waiting",
    val url: String = "",
    val instructions: String? = null,
    val message: String? = null,
    val placeholder: String? = null,
)

@Composable
private fun ModelAuthSection(korean: Boolean, requester: RelayRequester) {
    val scope = rememberCoroutineScope()
    var providers by remember { mutableStateOf<List<AuthProviderRow>>(emptyList()) }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var expanded by remember { mutableStateOf<String?>(null) }
    var logins by remember { mutableStateOf<Map<String, LoginUiState>>(emptyMap()) }
    var codes by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var keyStatus by remember { mutableStateOf<Map<String, JSONObject>>(emptyMap()) }
    var capabilityNotes by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var loginBusy by remember { mutableStateOf<Set<String>>(emptySet()) }

    fun load() {
        scope.launch {
            pending = true
            error = null
            try {
                val data = requester.request("models", "auth.providers", JSONObject())
                val array = data.optJSONArray("providers") ?: JSONArray()
                val next = mutableListOf<AuthProviderRow>()
                for (i in 0 until array.length()) {
                    val entry = array.optJSONObject(i) ?: continue
                    val id = entry.optString("id")
                    if (id.isBlank()) continue
                    next.add(
                        AuthProviderRow(
                            id = id,
                            name = entry.optString("name").ifBlank { id },
                            loggedIn = entry.optBoolean("loggedIn", false),
                        ),
                    )
                }
                providers = next
            } catch (e: Exception) {
                error = modelRequestErrorNote(e, "auth.providers")
            } finally {
                pending = false
            }
        }
    }

    LaunchedEffect(Unit) { load() }

    fun pollLogin(provider: String, token: String) {
        scope.launch {
            // Bounded polling: ~5 minutes at 2.5s intervals, cancellable via
            // the Cancel button (auth.login.cancel disposes the child).
            repeat(120) {
                delay(2500)
                val current = logins[provider] ?: return@launch
                if (current.token != token || isModelLoginTerminal(current.phase)) return@launch
                try {
                    val data = requester.request(
                        "models",
                        "auth.login.poll",
                        JSONObject().put("provider", provider).put("token", token),
                    )
                    logins = logins + (
                        provider to LoginUiState(
                            token = token,
                            phase = data.optString("phase").ifBlank { "waiting" },
                            url = data.optString("url"),
                            instructions = data.optString("instructions").takeIf { it.isNotBlank() },
                            message = data.optString("message").takeIf { it.isNotBlank() },
                            placeholder = data.optString("placeholder").takeIf { it.isNotBlank() },
                        )
                    )
                    if (isModelLoginTerminal(logins[provider]?.phase.orEmpty())) {
                        loginBusy = loginBusy - provider
                        if (logins[provider]?.phase == "success") load()
                        return@launch
                    }
                } catch (_: Exception) {
                    // A single poll failure must not kill the flow; the next
                    // tick retries until the bound above is reached.
                }
            }
        }
    }

    fun startLogin(provider: String) {
        scope.launch {
            loginBusy = loginBusy + provider
            capabilityNotes = capabilityNotes - provider
            try {
                val data = requester.request(
                    "models",
                    "auth.login.start",
                    JSONObject().put("provider", provider),
                )
                val token = data.optString("token")
                if (token.isBlank()) throw IllegalStateException("auth.login.start returned no token")
                logins = logins + (provider to LoginUiState(token = token))
                codes = codes - provider
                pollLogin(provider, token)
            } catch (e: Exception) {
                loginBusy = loginBusy - provider
                capabilityNotes = capabilityNotes + (provider to modelRequestErrorNote(e, "auth.login.start"))
            }
        }
    }

    fun confirmCode(provider: String) {
        val login = logins[provider] ?: return
        val code = codes[provider].orEmpty()
        if (code.isBlank()) return
        scope.launch {
            loginBusy = loginBusy + provider
            try {
                requester.request(
                    "models",
                    "auth.login.confirm",
                    JSONObject().put("provider", provider).put("token", login.token).put("code", code),
                )
                // The code is write-only: drop it from memory immediately and
                // never include it in any message or log.
                codes = codes - provider
                pollLogin(provider, login.token)
            } catch (e: Exception) {
                codes = codes - provider
                loginBusy = loginBusy - provider
                capabilityNotes = capabilityNotes + (provider to modelRequestErrorNote(e, "auth.login.confirm"))
            }
        }
    }

    fun cancelLogin(provider: String) {
        val login = logins[provider] ?: return
        scope.launch {
            try {
                requester.request(
                    "models",
                    "auth.login.cancel",
                    JSONObject().put("provider", provider).put("token", login.token),
                )
            } catch (_: Exception) {
                // Cancel is best-effort: the registry entry is dropped below.
            } finally {
                logins = logins - provider
                codes = codes - provider
                loginBusy = loginBusy - provider
            }
        }
    }

    fun fetchKeyStatus(provider: String) {
        scope.launch {
            loginBusy = loginBusy + provider
            try {
                val data = requester.request(
                    "models",
                    "auth.apikey.get",
                    JSONObject().put("provider", provider),
                )
                keyStatus = keyStatus + (provider to data)
            } catch (e: Exception) {
                capabilityNotes = capabilityNotes + (provider to modelRequestErrorNote(e, "auth.apikey.get"))
            } finally {
                loginBusy = loginBusy - provider
            }
        }
    }

    fun surfaceCapability(provider: String, action: String, extra: JSONObject = JSONObject()) {
        scope.launch {
            loginBusy = loginBusy + provider
            try {
                val args = JSONObject()
                val keys = extra.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    args.put(key, extra.opt(key))
                }
                args.put("provider", provider)
                requester.request("models", action, args)
                capabilityNotes = capabilityNotes + (
                    provider to if (korean) "예상치 못한 성공 응답" else "Unexpected success response"
                )
            } catch (e: Exception) {
                // Expected path: the server answers with the honest 501
                // capability code plus terminal guidance.
                capabilityNotes = capabilityNotes + (provider to modelRequestErrorNote(e, action))
            } finally {
                loginBusy = loginBusy - provider
            }
        }
    }

    ModelSectionHeader(title = if (korean) "인증" else "Auth")
    ModelCard {
        if (pending && providers.isEmpty()) ModelStatusText(if (korean) "불러오는 중…" else "Loading providers…")
        if (!pending && providers.isEmpty() && error == null) {
            ModelStatusText(text = if (korean) "제공자가 없습니다" else "No providers")
        }
        providers.forEachIndexed { index, provider ->
            if (index > 0) HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
            Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .clickable { expanded = if (expanded == provider.id) null else provider.id }
                        .padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = if (provider.name == provider.id) provider.id else "${provider.name} (${provider.id})",
                            fontSize = 14.sp,
                            color = OmpColors.Text,
                        )
                        Text(
                            text = if (provider.loggedIn) {
                                if (korean) "로그인됨" else "Logged in"
                            } else {
                                if (korean) "로그인 안 됨" else "Not logged in"
                            },
                            fontSize = 12.sp,
                            color = if (provider.loggedIn) OmpColors.StatusSuccess else OmpColors.TextMuted,
                        )
                    }
                    Icon(
                        imageVector = if (expanded == provider.id) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                        contentDescription = if (expanded == provider.id) "Collapse ${provider.name}" else "Manage ${provider.name}",
                        tint = OmpColors.TextMuted,
                        modifier = Modifier.padding(horizontal = 8.dp).size(20.dp),
                    )
                }
                if (expanded == provider.id) {
                    val login = logins[provider.id]
                    val busy = provider.id in loginBusy
                    if (login == null) {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            ModelActionLink(
                                label = if (provider.loggedIn) {
                                    if (korean) "다시 로그인" else "Re-login"
                                } else {
                                    if (korean) "로그인" else "Login"
                                },
                                onClick = { if (!busy) startLogin(provider.id) },
                            )
                            ModelActionLink(
                                label = if (korean) "API 키 상태" else "API key status",
                                onClick = { fetchKeyStatus(provider.id) },
                            )
                        }
                    } else {
                        when (login.phase) {
                            "waiting" -> ModelStatusText(
                                text = if (korean) "로그인 시작 중… URL을 기다립니다." else "Starting login… waiting for the URL.",
                            )
                            "success" -> ModelStatusText(
                                text = if (korean) "연결되었습니다." else "Connected.",
                            )
                            "error" -> ModelErrorText(
                                text = login.message ?: if (korean) "로그인 실패" else "Login failed",
                            )
                            else -> {
                                if (login.url.isNotBlank()) {
                                    ModelAuthUrl(korean = korean, url = login.url, token = login.token)
                                }
                                (login.instructions ?: login.message)?.let {
                                    Text(text = it, fontSize = 13.sp, color = OmpColors.TextMuted)
                                }
                                if (login.phase == "auth" || login.phase == "prompt") {
                                    ModelTextField(
                                        value = codes[provider.id].orEmpty(),
                                        onValueChange = { codes = codes + (provider.id to it) },
                                        placeholder = login.placeholder
                                            ?: if (korean) "인증 코드 붙여넣기" else "Paste the authorization code",
                                    )
                                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        ModelActionLink(
                                            label = if (korean) "코드 전송" else "Submit code",
                                            onClick = { confirmCode(provider.id) },
                                        )
                                        ModelActionLink(
                                            label = if (korean) "취소" else "Cancel",
                                            onClick = { cancelLogin(provider.id) },
                                        )
                                    }
                                } else {
                                    ModelActionLink(
                                        label = if (korean) "취소" else "Cancel",
                                        onClick = { cancelLogin(provider.id) },
                                    )
                                }
                            }
                        }
                        if (isModelLoginTerminal(login.phase)) {
                            ModelActionLink(
                                label = if (korean) "닫기" else "Dismiss",
                                onClick = {
                                    logins = logins - provider.id
                                    loginBusy = loginBusy - provider.id
                                },
                            )
                        }
                    }
                    keyStatus[provider.id]?.let { status ->
                        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
                        Text(
                            text = if (status.optBoolean("configured", false)) {
                                if (korean) {
                                    "API 키: 구성됨 (모델 ${status.optInt("models", 0)}개)"
                                } else {
                                    "API key: configured (${status.optInt("models", 0)} models)"
                                }
                            } else {
                                if (korean) "API 키: 미구성" else "API key: not configured"
                            },
                            fontSize = 13.sp,
                            color = OmpColors.TextMuted,
                        )
                        Text(
                            text = if (korean) {
                                "저장된 키는 터미널에서 `omp`의 /login(/logout)으로, 환경 변수로, 또는 models.yml 제공자의 apiKey로 관리하세요."
                            } else {
                                "Manage stored keys from a terminal via omp /login (/logout), an environment variable, or a models.yml provider apiKey."
                            },
                            fontSize = 12.sp,
                            color = OmpColors.TextMuted,
                        )
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            ModelActionLink(
                                label = if (korean) "키 저장(지원 안 됨 확인)" else "Store key (check unsupported)",
                                onClick = { surfaceCapability(provider.id, "auth.apikey.set") },
                            )
                            ModelActionLink(
                                label = if (korean) "키 삭제(지원 안 됨 확인)" else "Remove key (check unsupported)",
                                danger = true,
                                onClick = { surfaceCapability(provider.id, "auth.apikey.remove") },
                            )
                        }
                    }
                    if (provider.loggedIn) {
                        ModelActionLink(
                            label = if (korean) "연결 해제(터미널 안내)" else "Disconnect (terminal guidance)",
                            danger = true,
                            onClick = { surfaceCapability(provider.id, "auth.logout") },
                        )
                        Text(
                            text = if (korean) {
                                "연결 해제는 omp 자체 UI의 /logout으로만 가능합니다."
                            } else {
                                "Disconnect is only available via /logout in omp's own UI."
                            },
                            fontSize = 12.sp,
                            color = OmpColors.TextMuted,
                        )
                    }
                    capabilityNotes[provider.id]?.let { ModelErrorText(text = it) }
                }
            }
        }
        error?.let { ModelErrorText(text = it) }
        ModelActionLink(
            label = if (korean) "다시 불러오기" else "Reload",
            onClick = { if (!pending) load() },
        )
    }
}

@Composable
private fun ModelAuthUrl(korean: Boolean, url: String, token: String) {
    val context = LocalContext.current
    val safeUrl = remember(url) { safeModelAuthUrl(url) }
    var actionError by remember(url, token) { mutableStateOf<String?>(null) }
    var copied by remember(url, token) { mutableStateOf(false) }
    SelectionContainer {
        Text(
            text = url,
            fontSize = 12.sp,
            color = OmpColors.Accent,
            modifier = Modifier.padding(vertical = 4.dp),
        )
    }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        TextButton(
            enabled = safeUrl != null,
            onClick = {
                actionError = null
                safeUrl?.let {
                    try {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it)).apply {
                            addCategory(Intent.CATEGORY_BROWSABLE)
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        })
                    } catch (_: Exception) {
                        actionError = if (korean) "브라우저를 열 수 없습니다. URL을 복사해 직접 여세요." else "Could not open a browser. Copy the URL and open it manually."
                    }
                }
            },
        ) { Text(if (korean) "브라우저 열기" else "Open browser", color = OmpColors.Accent) }
        TextButton(
            enabled = safeUrl != null,
            onClick = {
                actionError = null
                safeUrl?.let {
                    try {
                        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                        clipboard.setPrimaryClip(ClipData.newPlainText("OAuth URL", it))
                        copied = true
                    } catch (_: Exception) {
                        actionError = if (korean) "URL을 복사할 수 없습니다." else "Could not copy the URL."
                    }
                }
            },
        ) { Text(if (korean) "URL 복사" else "Copy URL", color = OmpColors.Accent) }
    }
    if (safeUrl == null) ModelErrorText(if (korean) "유효한 HTTP(S) 로그인 URL이 아닙니다." else "This is not a valid HTTP(S) login URL.")
    actionError?.let { ModelErrorText(it) }
    if (copied) ModelStatusText(if (korean) "URL 복사됨" else "URL copied")
}

private data class AuthProviderRow(val id: String, val name: String, val loggedIn: Boolean)

// ---------------------------------------------------------------------------
// Building blocks (file-private; mirror SettingsSheet styling).
// ---------------------------------------------------------------------------

@Composable
private fun ModelSectionHeader(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.SemiBold,
        color = OmpColors.Text,
        modifier = Modifier.padding(top = 8.dp),
    )
}

@Composable
private fun ModelCard(disclosure: String? = null, content: @Composable () -> Unit) {
    var expanded by remember { mutableStateOf(disclosure == null) }
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (disclosure != null) {
            TextButton(onClick = { expanded = !expanded },
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .border(1.dp, OmpColors.Border, RoundedCornerShape(8.dp))) {
                Text(disclosure, modifier = Modifier.weight(1f), color = OmpColors.Text)
                Icon(if (expanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                    contentDescription = if (expanded) "Collapse" else "Expand",
                    tint = OmpColors.TextMuted, modifier = Modifier.size(20.dp))
            }
        }
        if (expanded) content()
    }
}

@Composable
private fun ModelRow(label: String, value: String) {
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted)
        Text(value, style = MaterialTheme.typography.bodyMedium, color = OmpColors.Text)
    }
}

@Composable
private fun ModelToggleRow(
    label: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    enabled: Boolean = true,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clip(RoundedCornerShape(8.dp))
            .toggleable(value = checked, enabled = enabled, role = Role.Switch, onValueChange = onCheckedChange)
            .padding(horizontal = 4.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            fontSize = 14.sp,
            color = OmpColors.Text,
            modifier = Modifier.weight(1f),
        )
        Switch(
            checked = checked,
            enabled = enabled,
            onCheckedChange = null,
            colors = SwitchDefaults.colors(
                checkedThumbColor = Color.White,
                checkedTrackColor = OmpColors.AccentStrong,
                uncheckedThumbColor = OmpColors.TextMuted,
                uncheckedTrackColor = OmpColors.BgSelected,
                uncheckedBorderColor = OmpColors.Border,
            ),
        )
    }
}

@Composable
private fun ModelCheckRow(
    label: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    enabled: Boolean = true,
) {
    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
            .toggleable(value = checked, enabled = enabled, role = Role.Checkbox, onValueChange = onCheckedChange)
            .padding(horizontal = 4.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(checked = checked, enabled = enabled, onCheckedChange = null)
        Text(label, style = MaterialTheme.typography.bodyMedium, color = OmpColors.Text,
            modifier = Modifier.weight(1f))
    }
}

@Composable
private fun ModelSelect(
    label: String,
    options: List<String>,
    selected: String?,
    onSelect: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted)
        androidx.compose.foundation.layout.Box(Modifier.weight(1.35f), contentAlignment = Alignment.CenterEnd) {
            TextButton(
                onClick = { expanded = true }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                shape = RoundedCornerShape(8.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 8.dp, vertical = 4.dp),
            ) {
                Text(selected.orEmpty(), modifier = Modifier.weight(1f), color = OmpColors.Text,
                    maxLines = 2, overflow = TextOverflow.Ellipsis)
                Icon(Icons.Default.KeyboardArrowDown, contentDescription = "Choose $label",
                    tint = OmpColors.TextMuted, modifier = Modifier.size(20.dp))
            }
            androidx.compose.material3.DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false },
                modifier = Modifier.widthIn(max = 320.dp).heightIn(max = 360.dp)) {
                (listOfNotNull(selected) + options).distinct().forEach { option ->
                    androidx.compose.material3.DropdownMenuItem(
                        text = { Text(option, color = if (option == selected) OmpColors.Accent else OmpColors.Text) },
                        onClick = { onSelect(option); expanded = false },
                    )
                }
            }
        }
    }
}

@Composable
private fun ModelTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    secret: Boolean = false,
) {
    ModelInlineField(value, onValueChange, placeholder, Modifier.fillMaxWidth(), secret)
}

@Composable
private fun ModelInlineField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    secret: Boolean = false,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(placeholder, style = MaterialTheme.typography.bodySmall) },
        singleLine = true,
        visualTransformation = if (secret) androidx.compose.ui.text.input.PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        textStyle = MaterialTheme.typography.bodyMedium.copy(color = OmpColors.Text),
        shape = RoundedCornerShape(8.dp),
        modifier = modifier.heightIn(min = 48.dp),
    )
}

@Composable
private fun ModelActionLink(
    label: String,
    onClick: () -> Unit,
    danger: Boolean = false,
    primary: Boolean = false,
    enabled: Boolean = true,
) {
    if (primary) {
        androidx.compose.material3.Button(onClick = onClick, enabled = enabled, shape = RoundedCornerShape(8.dp),
            modifier = Modifier.heightIn(min = 48.dp)) {
            Text(label, style = MaterialTheme.typography.labelLarge)
        }
        return
    }
    TextButton(onClick = onClick, enabled = enabled, shape = RoundedCornerShape(8.dp),
        modifier = Modifier.heightIn(min = 48.dp)) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelLarge,
            color = if (danger) OmpColors.StatusError else OmpColors.Accent,
        )
    }
}

@Composable
private fun ModelErrorText(text: String) {
    Text(
        text = text,
        fontSize = 13.sp,
        color = OmpColors.StatusError,
        modifier = Modifier.padding(vertical = 2.dp),
    )
}

@Composable
private fun ModelStatusText(text: String) {
    Text(
        text = text,
        fontSize = 13.sp,
        color = OmpColors.TextMuted,
        modifier = Modifier.padding(vertical = 2.dp),
    )
}
