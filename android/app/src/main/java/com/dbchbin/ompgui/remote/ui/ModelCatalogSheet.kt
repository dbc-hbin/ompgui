package com.dbchbin.ompgui.remote.ui

import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.background
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.RadioButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.HorizontalDivider
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.dbchbin.ompgui.remote.relay.RelayRequester
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject

internal fun catalogModelDraft(entry: JSONObject): ModelDraft {
    require(entry.getString("id").isNotBlank())
    val model = JSONObject().put("id", entry.getString("id"))
    for (key in listOf("name", "reasoning", "input", "contextWindow", "maxTokens")) {
        if (entry.has(key) && !entry.isNull(key)) model.put(key, entry.get(key))
    }
    val cost = entry.optJSONObject("cost")
    if (cost != null && listOf("input", "output").all { key ->
        val value = cost.opt(key)
        value is Number && value.toDouble().isFinite() && value.toDouble() >= 0
    }) {
        val complete = JSONObject()
        for (key in listOf("input", "output", "cacheRead", "cacheWrite")) {
            val value = if (cost.has(key)) cost.getDouble(key) else 0.0
            require(value.isFinite() && value >= 0)
            complete.put(key, value)
        }
        model.put("cost", complete)
    }
    return providerDraftFromJson("catalog", JSONObject().put("models", JSONArray().put(model)))
        .models.single().copy(originalId = null)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ModelCatalogSheet(requester: RelayRequester, draft: ProviderDraft, onAdd: (ProviderDraft) -> Unit, onDismiss: () -> Unit) {
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var retry by remember { mutableStateOf(0) }
    var selected by remember { mutableStateOf<JSONObject?>(null) }
    var useBaseUrl by remember { mutableStateOf(false) }
    val listState = androidx.compose.foundation.lazy.rememberLazyListState()
    LaunchedEffect(query, retry, draft.name, draft.baseUrl) {
        results = emptyList()
        loading = true
        error = null
        try {
            delay(300)
            val response = requester.request("models", "catalog.search", JSONObject()
                .put("query", query).put("provider", draft.name).put("baseUrl", draft.baseUrl).put("limit", 30))
            val array = response.getJSONArray("models")
            results = (0 until minOf(array.length(), 30)).map { array.getJSONObject(it) }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            error = modelRequestErrorNote(failure, "catalog.search")
        } finally {
            loading = false
        }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = OmpColors.Bg,
        sheetState = androidx.compose.material3.rememberModalBottomSheetState(skipPartiallyExpanded = true),
        dragHandle = { OmpSheetDragHandle() }) {
        OmpDialogSystemBars()
        Column(Modifier.fillMaxWidth().fillMaxHeight(0.9f)) {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Add from models.dev", style = MaterialTheme.typography.titleMedium, color = OmpColors.Text)
                    Text(draft.name, style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                IconButton(onClick = onDismiss, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Default.Close, contentDescription = "Close", tint = OmpColors.TextMuted,
                        modifier = Modifier.size(20.dp))
                }
            }
            ModelSearchField(query, { if (it.length <= 120) query = it },
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
            HorizontalDivider(color = OmpColors.Border)
            LazyColumn(Modifier.weight(1f), state = listState, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)) {
                item {
                    if (loading) Text("Searching models.dev…", color = OmpColors.TextMuted)
                    error?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall, color = OmpColors.StatusError)
                        TextButton(onClick = { retry++ }) { Text("Retry") }
                    }
                    if (!loading && error == null && results.isEmpty()) Text(if (java.util.Locale.getDefault().language == "ko") "검색 결과가 없습니다" else "No matching models", color = OmpColors.TextMuted)
                }
                items(results) { entry ->
                    val duplicate = draft.models.any { it.id.trim() == entry.optString("id") }
                    val checked = selected?.let { it.optString("id") == entry.optString("id") && it.optString("providerId") == entry.optString("providerId") } == true
                    HorizontalDivider(color = OmpColors.Border)
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp)
                        .background(if (checked) OmpColors.BgSelected else OmpColors.Bg, RoundedCornerShape(8.dp))
                        .selectable(selected = checked, enabled = !duplicate, role = Role.RadioButton,
                            onClick = { selected = entry; useBaseUrl = false })
                        .padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(entry.optString("id"),
                                style = MaterialTheme.typography.bodyMedium, color = OmpColors.Text)
                            Text(listOf(entry.optString("providerName"), entry.optString("name"))
                                .filter { it.isNotBlank() && it != entry.optString("id") }.distinct().joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted)
                            if (entry.optBoolean("reasoning")) Text("Reasoning",
                                style = MaterialTheme.typography.labelSmall, color = OmpColors.TextMuted)
                            Text("Context: ${entry.opt("contextWindow") ?: "unknown"} · Input: ${entry.optJSONArray("input") ?: "unknown"}",
                                style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted)
                            val cost = entry.optJSONObject("cost")
                            Text("USD / million: input ${cost?.opt("input") ?: "unknown"}, output ${cost?.opt("output") ?: "unknown"}",
                                style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted)
                            if (duplicate) Text("Already added", style = MaterialTheme.typography.labelMedium, color = OmpColors.TextMuted)
                        }
                        RadioButton(selected = checked, enabled = !duplicate, onClick = null)
                    }
                }
            }
            HorizontalDivider(color = OmpColors.Border)
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)) {
                val entry = selected
                val url = entry?.optString("providerBaseUrl").orEmpty()
                Column(Modifier.fillMaxWidth().heightIn(max = 96.dp).verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(entry?.optString("id") ?: "Select a model to add",
                        style = MaterialTheme.typography.bodyMedium, color = OmpColors.Text,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (url.isNotBlank()) {
                        Text("Catalog provider URL: $url", style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted)
                    }
                }
                if (url.isNotBlank()) {
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp)
                        .toggleable(useBaseUrl, role = Role.Checkbox, onValueChange = { useBaseUrl = it }),
                        verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(useBaseUrl, onCheckedChange = null)
                        Text("Replace current provider URL", modifier = Modifier.weight(1f),
                            style = MaterialTheme.typography.bodyMedium, color = OmpColors.Text)
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    Button(modifier = Modifier.heightIn(min = 48.dp), enabled = entry != null,
                        shape = RoundedCornerShape(8.dp), onClick = {
                            if (entry != null) {
                                try {
                                    val model = catalogModelDraft(entry)
                                    require(draft.models.none { it.id.trim() == model.id }) { "Model ID already exists" }
                                    onAdd(draft.copy(models = draft.models + model, baseUrl = if (useBaseUrl) url else draft.baseUrl))
                                } catch (failure: Exception) { error = failure.message ?: "Invalid catalog model" }
                            }
                        }) { Text("Add selected model") }
                }
            }
        }
    }
}
