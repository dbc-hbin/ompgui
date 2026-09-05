package com.dbchbin.ompgui.remote.ui

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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.graphics.SolidColor
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
@Composable
fun ModelSettingsPanel(requester: RelayRequester, cwd: String) {
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
        ModelCatalogSection(
            korean = korean,
            catalog = catalog,
            loading = catalogLoading,
            error = catalogError,
            onRefresh = ::refreshCatalog,
        )
        ModelRolesSection(korean = korean, requester = requester, catalog = catalog)
        ModelRegistrySection(korean = korean, requester = requester, catalog = catalog)
        ModelProvidersSection(korean = korean, requester = requester, catalog = catalog)
        ModelFallbackSection(korean = korean, requester = requester, catalog = catalog)
        ModelAuthSection(korean = korean, requester = requester)
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
private fun ModelCatalogSection(
    korean: Boolean,
    catalog: ModelCatalogState,
    loading: Boolean,
    error: String?,
    onRefresh: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
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
        ModelTextField(
            value = query,
            onValueChange = { query = it },
            placeholder = if (korean) "모델 검색 (provider/id/name)" else "Search models (provider/id/name)",
        )
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
            Column(modifier = Modifier.fillMaxWidth()) {
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
    var pickerFor by remember { mutableStateOf<String?>(null) }
    var pickerQuery by remember { mutableStateOf("") }

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
    ModelCard {
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
                        Text(
                            text = role,
                            fontSize = 13.sp,
                            color = OmpColors.TextMuted,
                            modifier = Modifier.width(76.dp),
                            maxLines = 1,
                        )
                        ModelInlineField(
                            value = raw,
                            onValueChange = { next -> roles = roles + (role to next) },
                            placeholder = "provider/model[:effort]",
                            modifier = Modifier.weight(1f),
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = if (pickerFor == role) "▲" else "▼",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = OmpColors.Accent,
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .clickable {
                                    pickerFor = if (pickerFor == role) null else role
                                    pickerQuery = ""
                                }
                                .padding(horizontal = 8.dp, vertical = 6.dp),
                        )
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
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    if (pickerFor == role) {
                        ModelInlineField(
                            value = pickerQuery,
                            onValueChange = { pickerQuery = it },
                            placeholder = if (korean) "모델 검색" else "Search models",
                            modifier = Modifier.fillMaxWidth(),
                        )
                        val q = pickerQuery.trim().lowercase()
                        val options = catalog.models
                            .filter { q.isEmpty() || it.selector.lowercase().contains(q) || it.name.lowercase().contains(q) }
                            .take(8)
                        options.forEach { option ->
                            Text(
                                text = "${option.name} (${option.selector})",
                                fontSize = 13.sp,
                                color = OmpColors.Text,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier
                                    .fillMaxWidth()
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
                        if (raw.isNotBlank()) {
                            Text(
                                text = if (korean) "비우기 (override 없음)" else "Clear (no override)",
                                fontSize = 12.sp,
                                color = OmpColors.StatusError,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .clickable {
                                        roles = roles + (role to "")
                                        pickerFor = null
                                    }
                                    .padding(horizontal = 4.dp, vertical = 6.dp),
                            )
                        }
                    }
                }
            }
        }
        error?.let { ModelErrorText(text = it) }
        savedNote?.let { ModelStatusText(text = it) }
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            ModelActionLink(
                label = if (pending) {
                    if (korean) "처리 중…" else "Working…"
                } else {
                    if (korean) "역할 저장" else "Save roles"
                },
                onClick = { if (!pending) save() },
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
    var query by remember { mutableStateOf("") }
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
    ModelCard {
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
            ModelTextField(
                value = query,
                onValueChange = { query = it },
                placeholder = if (korean) "모델 검색" else "Search models",
            )
            val q = query.trim().lowercase()
            val visible = allSelectors
                .filter { q.isEmpty() || it.lowercase().contains(q) }
                .take(40)
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
                    Text(
                        text = "↑",
                        color = OmpColors.Accent,
                        modifier = Modifier.clickable {
                            val next = orderedProviders.toMutableList()
                            val tmp = next[index - 1]
                            next[index - 1] = next[index]
                            next[index] = tmp
                            providerOrder = next
                            save(JSONObject().put("modelProviderOrder", JSONArray(next)))
                        }.padding(horizontal = 8.dp, vertical = 4.dp),
                    )
                }
                if (index < orderedProviders.lastIndex) {
                    Text(
                        text = "↓",
                        color = OmpColors.Accent,
                        modifier = Modifier.clickable {
                            val next = orderedProviders.toMutableList()
                            val tmp = next[index + 1]
                            next[index + 1] = next[index]
                            next[index] = tmp
                            providerOrder = next
                            save(JSONObject().put("modelProviderOrder", JSONArray(next)))
                        }.padding(horizontal = 8.dp, vertical = 4.dp),
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

private data class HeaderRow(val name: String, val value: String)

private data class ModelDraft(
    val originalId: String?,
    val id: String,
    val name: String,
    val api: String,
    val baseUrl: String,
    val reasoning: Boolean,
    val contextWindow: String,
    val maxTokens: String,
)

private data class ProviderDraft(
    val originalName: String,
    val name: String,
    val baseUrl: String,
    val api: String,
    val auth: String,
    val apiKeyInput: String,
    val apiKeyTouched: Boolean,
    val clearKey: Boolean,
    val apiKeyConfigured: Boolean,
    val headersConfigured: Boolean,
    val headerRows: List<HeaderRow>,
    val headersTouched: Boolean,
    val clearHeaders: Boolean,
    val models: List<ModelDraft>,
)

private fun providerDraftFromJson(name: String, obj: JSONObject): ProviderDraft {
    val models = mutableListOf<ModelDraft>()
    val rawModels = obj.optJSONArray("models")
    if (rawModels != null) {
        for (i in 0 until rawModels.length()) {
            val m = rawModels.optJSONObject(i) ?: continue
            models.add(
                ModelDraft(
                    originalId = m.optString("originalId").ifBlank { m.optString("id").ifBlank { null } },
                    id = m.optString("id"),
                    name = m.optString("name"),
                    api = m.optString("api"),
                    baseUrl = m.optString("baseUrl"),
                    reasoning = m.optBoolean("reasoning", false),
                    contextWindow = if (m.has("contextWindow")) m.optInt("contextWindow").toString() else "",
                    maxTokens = if (m.has("maxTokens")) m.optInt("maxTokens").toString() else "",
                ),
            )
        }
    }
    return ProviderDraft(
        originalName = obj.optString("originalName").ifBlank { name },
        name = name,
        baseUrl = obj.optString("baseUrl"),
        api = obj.optString("api", "openai-completions"),
        auth = obj.optString("auth"),
        apiKeyInput = "",
        apiKeyTouched = false,
        clearKey = false,
        apiKeyConfigured = obj.optBoolean("apiKeyConfigured", false),
        headersConfigured = obj.optBoolean("headersConfigured", false),
        headerRows = emptyList(),
        headersTouched = false,
        clearHeaders = false,
        models = models,
    )
}

private fun ProviderDraft.toUpdateJson(): JSONObject {
    val out = JSONObject()
    out.put("originalName", originalName)
    if (baseUrl.isNotBlank()) out.put("baseUrl", baseUrl.trim())
    if (api.isNotBlank()) out.put("api", api)
    if (auth.isNotBlank()) out.put("auth", auth)
    if (clearKey) {
        out.put("apiKey", JSONObject.NULL)
    } else if (apiKeyTouched && apiKeyInput.isNotBlank()) {
        out.put("apiKey", apiKeyInput)
    }
    if (clearHeaders) {
        out.put("headers", JSONObject.NULL)
    } else if (headersTouched) {
        val headers = JSONObject()
        for (row in headerRows) {
            if (row.name.isNotBlank()) headers.put(row.name, row.value)
        }
        out.put("headers", headers)
    }
    val modelArray = JSONArray()
    for (model in models) {
        val m = JSONObject()
        m.put("id", model.id)
        if (model.originalId != null && model.originalId != model.id) m.put("originalId", model.originalId)
        if (model.name.isNotBlank()) m.put("name", model.name)
        if (model.api.isNotBlank()) m.put("api", model.api)
        if (model.baseUrl.isNotBlank()) m.put("baseUrl", model.baseUrl)
        if (model.reasoning) m.put("reasoning", true)
        model.contextWindow.toIntOrNull()?.let { if (it > 0) m.put("contextWindow", it) }
        model.maxTokens.toIntOrNull()?.let { if (it > 0) m.put("maxTokens", it) }
        modelArray.put(m)
    }
    out.put("models", modelArray)
    return out
}

@Composable
private fun ModelProvidersSection(
    korean: Boolean,
    requester: RelayRequester,
    @Suppress("UNUSED_PARAMETER") catalog: ModelCatalogState,
) {
    val scope = rememberCoroutineScope()
    var providers by remember { mutableStateOf<Map<String, ProviderDraft>>(emptyMap()) }
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
                val config = JSONObject().put(
                    "providers",
                    JSONObject().apply {
                        for ((name, draft) in drafts) put(name, draft.toUpdateJson())
                    },
                )
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
                    JSONObject().put(target.name.ifBlank { target.originalName }, target.toUpdateJson()),
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
                            .clip(RoundedCornerShape(6.dp))
                            .clickable { selected = if (selected == name) null else name }
                            .padding(vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(text = name, fontSize = 14.sp, color = OmpColors.Text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(
                                text = listOfNotNull(
                                    draft.baseUrl.ifBlank { null },
                                    if (draft.apiKeyConfigured) "key set" else "no key",
                                    if (draft.headersConfigured) "headers set" else null,
                                    "${draft.models.size} models",
                                ).joinToString(" · "),
                                fontSize = 12.sp,
                                color = OmpColors.TextMuted,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        Text(
                            text = if (selected == name) "▲" else "▼",
                            color = OmpColors.Accent,
                            modifier = Modifier.padding(horizontal = 8.dp),
                        )
                    }
                    if (selected == name) {
                        ProviderEditor(
                            korean = korean,
                            draft = draft,
                            pending = pending,
                            validating = validating,
                            onChange = { next -> providers = providers + (name to next) },
                            onRename = { renamed ->
                                val trimmed = renamed.trim()
                                if (trimmed.isNotBlank() && trimmed != name) {
                                    providers = providers - name + (trimmed to draft.copy(name = trimmed))
                                    selected = trimmed
                                }
                            },
                            onValidate = ::validateCurrent,
                            onSave = { saveDrafts(providers, "partial") },
                            onDelete = { pendingDelete = name },
                            onTestModel = { model ->
                                scope.launch {
                                    pending = true
                                    error = null
                                    note = null
                                    try {
                                        val providerObj = draft.toUpdateJson()
                                        providerObj.remove("originalName")
                                        val modelObj = JSONObject()
                                            .put("id", model.id.ifBlank { model.originalId.orEmpty() })
                                            .apply {
                                                if (model.api.isNotBlank()) put("api", model.api)
                                            }
                                        val args = JSONObject()
                                            .put("providerName", draft.name.ifBlank { draft.originalName })
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
                                originalName = trimmed,
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
                    color = OmpColors.TextMuted,
                    fontSize = 13.sp,
                )
            },
            confirmButton = {
                Text(
                    if (korean) "삭제" else "Delete",
                    color = OmpColors.StatusError,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .clickable {
                            if (doomed != null) saveDrafts(providers - name, "full")
                            pendingDelete = null
                        }
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                )
            },
            dismissButton = {
                Text(
                    if (korean) "취소" else "Cancel",
                    color = OmpColors.TextMuted,
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .clickable { pendingDelete = null }
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                )
            },
        )
    }
}

@Composable
private fun ProviderEditor(
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
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            ModelInlineField(
                value = rename,
                onValueChange = { rename = it },
                placeholder = if (korean) "제공자 이름" else "Provider name",
                modifier = Modifier.weight(1f),
            )
            if (rename.trim().isNotBlank() && rename.trim() != draft.name) {
                Spacer(modifier = Modifier.width(8.dp))
                ModelActionLink(label = if (korean) "이름 변경" else "Rename", onClick = { onRename(rename) })
            }
        }
        ModelTextField(
            value = draft.baseUrl,
            onValueChange = { onChange(draft.copy(baseUrl = it)) },
            placeholder = "https://api.example.com/v1",
        )
        ModelChips(
            label = "api",
            options = modelApiOptions,
            selected = draft.api.ifBlank { "openai-completions" },
            onSelect = { onChange(draft.copy(api = it)) },
        )
        ModelChips(
            label = "auth",
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
        Text(text = "apiKey · $keyState", fontSize = 13.sp, color = OmpColors.TextMuted)
        ModelTextField(
            value = draft.apiKeyInput,
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
        Text(text = "headers · $headersState", fontSize = 13.sp, color = OmpColors.TextMuted)
        draft.headerRows.forEachIndexed { index, row ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                ModelInlineField(
                    value = row.name,
                    onValueChange = { next ->
                        val rows = draft.headerRows.toMutableList()
                        rows[index] = row.copy(name = next)
                        onChange(draft.copy(headerRows = rows, headersTouched = true, clearHeaders = false))
                    },
                    placeholder = "X-Custom",
                    modifier = Modifier.weight(1f),
                )
                Spacer(modifier = Modifier.width(8.dp))
                ModelInlineField(
                    value = row.value,
                    onValueChange = { next ->
                        val rows = draft.headerRows.toMutableList()
                        rows[index] = row.copy(value = next)
                        onChange(draft.copy(headerRows = rows, headersTouched = true, clearHeaders = false))
                    },
                    placeholder = "value",
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = "✕",
                    color = OmpColors.StatusError,
                    modifier = Modifier.clickable {
                        onChange(draft.copy(headerRows = draft.headerRows.filterIndexed { i, _ -> i != index }, headersTouched = true, clearHeaders = false))
                    }.padding(8.dp),
                )
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
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
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            ModelActionLink(
                label = if (pending) {
                    if (korean) "저장 중…" else "Saving…"
                } else {
                    if (korean) "제공자 저장" else "Save providers"
                },
                onClick = { if (!pending) onSave() },
            )
            ModelActionLink(
                label = if (validating) {
                    if (korean) "검사 중…" else "Validating…"
                } else {
                    if (korean) "유효성 검사" else "Validate"
                },
                onClick = { if (!validating && !pending) onValidate() },
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
private fun ModelDraftEditor(
    korean: Boolean,
    model: ModelDraft,
    onChange: (ModelDraft) -> Unit,
    onDelete: () -> Unit,
    onTest: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp)
            .border(1.dp, OmpColors.Border, RoundedCornerShape(8.dp))
            .padding(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            ModelInlineField(
                value = model.id,
                onValueChange = { onChange(model.copy(id = it)) },
                placeholder = "model-id",
                modifier = Modifier.weight(1f),
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = if (korean) "삭제" else "Remove",
                fontSize = 12.sp,
                color = OmpColors.StatusError,
                modifier = Modifier.clickable(onClick = onDelete).padding(6.dp),
            )
        }
        ModelInlineField(
            value = model.name,
            onValueChange = { onChange(model.copy(name = it)) },
            placeholder = if (korean) "표시 이름 (선택)" else "Display name (optional)",
            modifier = Modifier.fillMaxWidth(),
        )
        ModelChips(
            label = "api",
            options = listOf("inherit") + modelApiOptions,
            selected = model.api.ifBlank { "inherit" },
            onSelect = { onChange(model.copy(api = if (it == "inherit") "" else it)) },
        )
        ModelToggleRow(
            label = if (korean) "Reasoning" else "Reasoning",
            checked = model.reasoning,
            onCheckedChange = { onChange(model.copy(reasoning = it)) },
        )
        Row {
            ModelInlineField(
                value = model.contextWindow,
                onValueChange = { next -> onChange(model.copy(contextWindow = next.filter { it.isDigit() })) },
                placeholder = "ctx",
                modifier = Modifier.weight(1f),
            )
            Spacer(modifier = Modifier.width(8.dp))
            ModelInlineField(
                value = model.maxTokens,
                onValueChange = { next -> onChange(model.copy(maxTokens = next.filter { it.isDigit() })) },
                placeholder = "max",
                modifier = Modifier.weight(1f),
            )
            Spacer(modifier = Modifier.width(8.dp))
            ModelActionLink(label = if (korean) "연결 테스트" else "Test", onClick = onTest)
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
    var candidateQuery by remember { mutableStateOf("") }
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
    val cq = candidateQuery.trim().lowercase()
    val options = catalog.models
        .filter { (cq.isEmpty() || it.selector.lowercase().contains(cq) || it.name.lowercase().contains(cq)) && it.selector !in chain }
        .take(8)

    ModelSectionHeader(title = if (korean) "폴백 체인" else "Fallback chains")
    ModelCard {
        Text(
            text = "retry · fallbackChains / maxRetries / modelFallback / revertPolicy",
            fontSize = 12.sp,
            color = OmpColors.TextMuted,
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        ModelChips(
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
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (index > 0) {
                        Text(
                            text = "↑",
                            color = OmpColors.Accent,
                            modifier = Modifier.clickable {
                                val next = chain.toMutableList()
                                val tmp = next[index - 1]
                                next[index - 1] = next[index]
                                next[index] = tmp
                                saveChains(chains + (role to next))
                            }.padding(horizontal = 6.dp, vertical = 4.dp),
                        )
                    }
                    if (index < chain.lastIndex) {
                        Text(
                            text = "↓",
                            color = OmpColors.Accent,
                            modifier = Modifier.clickable {
                                val next = chain.toMutableList()
                                val tmp = next[index + 1]
                                next[index + 1] = next[index]
                                next[index] = tmp
                                saveChains(chains + (role to next))
                            }.padding(horizontal = 6.dp, vertical = 4.dp),
                        )
                    }
                    Text(
                        text = "✕",
                        color = OmpColors.StatusError,
                        modifier = Modifier.clickable {
                            saveChains(chains + (role to chain.filterIndexed { i, _ -> i != index }))
                        }.padding(horizontal = 6.dp, vertical = 4.dp),
                    )
                }
            }
        }
        ModelInlineField(
            value = candidateQuery,
            onValueChange = {
                candidateQuery = it
                candidate = ""
            },
            placeholder = if (korean) "추가할 모델 검색" else "Search model to add",
            modifier = Modifier.fillMaxWidth(),
        )
        if (candidateQuery.trim().isNotEmpty() || candidate.isNotEmpty()) {
            options.forEach { option ->
                Text(
                    text = "${option.name} (${option.selector})",
                    fontSize = 13.sp,
                    color = if (candidate == option.selector) OmpColors.Accent else OmpColors.Text,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier
                        .fillMaxWidth()
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
        ModelChips(
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
        ModelChips(
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
        if (!pending && providers.isEmpty() && error == null) {
            ModelStatusText(text = if (korean) "제공자가 없습니다" else "No providers")
        }
        providers.forEachIndexed { index, provider ->
            if (index > 0) HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
            Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
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
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
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
                    Text(
                        text = if (expanded == provider.id) "▲" else "▼",
                        color = OmpColors.Accent,
                        modifier = Modifier.padding(horizontal = 8.dp),
                    )
                }
                if (expanded == provider.id) {
                    val login = logins[provider.id]
                    val busy = provider.id in loginBusy
                    if (login == null) {
                        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
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
                                    Text(
                                        text = login.url,
                                        fontSize = 12.sp,
                                        color = OmpColors.Accent,
                                        modifier = Modifier.padding(vertical = 4.dp),
                                    )
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
                                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
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
                        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
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

private data class AuthProviderRow(val id: String, val name: String, val loggedIn: Boolean)

// ---------------------------------------------------------------------------
// Building blocks (file-private; mirror SettingsSheet styling).
// ---------------------------------------------------------------------------

@Composable
private fun ModelSectionHeader(title: String) {
    Text(
        text = title,
        fontSize = 12.sp,
        color = OmpColors.TextDim,
        modifier = Modifier.padding(top = 8.dp, bottom = 4.dp),
    )
}

@Composable
private fun ModelCard(content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .border(1.dp, OmpColors.Border, shape)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        content()
    }
}

@Composable
private fun ModelRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            fontSize = 13.sp,
            color = OmpColors.TextMuted,
            modifier = Modifier.weight(1f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(modifier = Modifier.width(12.dp))
        Text(
            text = value,
            fontSize = 13.sp,
            color = OmpColors.Text,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
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
            .heightIn(min = 44.dp)
            .clip(RoundedCornerShape(8.dp))
            .clickable(enabled = enabled, onClick = { onCheckedChange(!checked) })
            .padding(horizontal = 4.dp, vertical = 8.dp),
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
            onCheckedChange = onCheckedChange,
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
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(6.dp))
            .clickable(enabled = enabled, onClick = { onCheckedChange(!checked) })
            .padding(horizontal = 4.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = if (checked) "☑" else "☐",
            fontSize = 15.sp,
            color = if (checked) OmpColors.Accent else OmpColors.TextMuted,
            modifier = Modifier.padding(end = 10.dp),
        )
        Text(
            text = label,
            fontSize = 13.sp,
            color = OmpColors.Text,
            modifier = Modifier.weight(1f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun ModelChips(
    label: String,
    options: List<String>,
    selected: String?,
    onSelect: (String) -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(text = label, fontSize = 13.sp, color = OmpColors.TextMuted)
        Spacer(modifier = Modifier.height(6.dp))
        LazyRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(options, key = { it }) { option ->
                val isSelected = option == selected
                Text(
                    text = option,
                    fontSize = 13.sp,
                    fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                    color = if (isSelected) OmpColors.Text else OmpColors.TextMuted,
                    maxLines = 1,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .border(
                            1.dp,
                            if (isSelected) OmpColors.Accent else OmpColors.Border,
                            RoundedCornerShape(8.dp),
                        )
                        .clickable(onClick = { onSelect(option) })
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                )
            }
        }
    }
}

@Composable
private fun ModelTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
) {
    androidx.compose.foundation.layout.Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .border(1.dp, OmpColors.Border, RoundedCornerShape(8.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        androidx.compose.foundation.text.BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = androidx.compose.ui.text.TextStyle(fontSize = 14.sp, color = OmpColors.Text),
            cursorBrush = SolidColor(OmpColors.Accent),
            modifier = Modifier.fillMaxWidth(),
            decorationBox = { inner ->
                if (value.isEmpty()) Text(placeholder, color = OmpColors.TextDim, fontSize = 14.sp)
                inner()
            },
        )
    }
}

@Composable
private fun ModelInlineField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
) {
    androidx.compose.foundation.layout.Box(
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .border(1.dp, OmpColors.Border, RoundedCornerShape(8.dp))
            .padding(horizontal = 10.dp, vertical = 8.dp),
    ) {
        androidx.compose.foundation.text.BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = androidx.compose.ui.text.TextStyle(fontSize = 13.sp, color = OmpColors.Text),
            cursorBrush = SolidColor(OmpColors.Accent),
            modifier = Modifier.fillMaxWidth(),
            decorationBox = { inner ->
                if (value.isEmpty()) Text(placeholder, color = OmpColors.TextDim, fontSize = 13.sp)
                inner()
            },
        )
    }
}

@Composable
private fun ModelActionLink(
    label: String,
    onClick: () -> Unit,
    danger: Boolean = false,
) {
    Text(
        text = label,
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
        color = if (danger) OmpColors.StatusError else OmpColors.Accent,
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp),
    )
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
