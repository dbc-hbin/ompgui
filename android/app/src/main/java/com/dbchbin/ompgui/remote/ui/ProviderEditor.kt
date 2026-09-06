package com.dbchbin.ompgui.remote.ui

import org.json.JSONArray
import org.json.JSONObject

internal data class HeaderRow(val name: String, val value: String)

internal data class ModelDraft(
    val originalId: String?,
    val id: String,
    val name: String,
    val api: String,
    val baseUrl: String,
    val reasoning: Boolean,
    val contextWindow: String,
    val maxTokens: String,
    val advanced: Map<String, String> = emptyMap(),
    val redacted: JSONObject = JSONObject(),
)

internal data class ProviderDraft(
    val originalName: String?,
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
    val advanced: Map<String, String> = emptyMap(),
    val redacted: JSONObject = JSONObject(),
)

internal fun providerDraftFromJson(name: String, obj: JSONObject): ProviderDraft {
    require(providerRedactionHolds(obj)) { "Provider response contains protected fields" }
    val models = mutableListOf<ModelDraft>()
    val rawModels = obj.optJSONArray("models")
    if (rawModels != null) {
        for (i in 0 until rawModels.length()) {
            val m = rawModels.optJSONObject(i) ?: continue
            require(!m.has("headers")) { "Model response contains protected fields" }
            models.add(
                ModelDraft(
                    redacted = JSONObject(m.toString()),
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
        redacted = JSONObject(obj.toString()),
        originalName = obj.optString("originalName").ifBlank { name },
        name = name,
        baseUrl = obj.optString("baseUrl"),
        api = obj.optString("api"),
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

internal fun ProviderDraft.toUpdateJson(): JSONObject {
    require(name.isNotBlank()) { "Provider name is required" }
    require(models.map { it.id.trim() }.distinct().size == models.size) { "Model IDs must be unique" }
    val out = applyAdvancedDraft(redacted, advanced, provider = true)
    out.remove("apiKey")
    out.remove("headers")
    out.remove("apiKeyConfigured")
    out.remove("headersConfigured")
    out.remove("originalName")
    originalName?.let { out.put("originalName", it) }
    for ((key, value) in listOf("baseUrl" to baseUrl.trim(), "api" to api, "auth" to auth)) {
        if (value.isBlank()) out.remove(key) else out.put(key, value)
    }
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
            if (row.name.isNotBlank() && row.value.isNotBlank()) headers.put(row.name, row.value)
        }
        if (headers.length() > 0) out.put("headers", headers)
    }
    val modelArray = JSONArray()
    for (model in models) {
        require(model.id.isNotBlank()) { "Model ID is required" }
        val m = applyAdvancedDraft(model.redacted, model.advanced, provider = false)
        m.remove("headers")
        m.remove("originalId")
        m.put("id", model.id)
        if (model.originalId != null) m.put("originalId", model.originalId)
        for ((key, value) in listOf("name" to model.name, "api" to model.api, "baseUrl" to model.baseUrl)) {
            if (value.isBlank()) m.remove(key) else m.put(key, value)
        }
        if (model.reasoning || m.has("reasoning")) m.put("reasoning", model.reasoning)
        for ((key, value) in listOf("contextWindow" to model.contextWindow, "maxTokens" to model.maxTokens)) {
            if (value.isBlank()) m.remove(key) else {
                val number = value.toIntOrNull()
                require(number != null && number > 0) { "$key must be a positive integer" }
                m.put(key, number)
            }
        }
        modelArray.put(m)
    }
    if (models.isNotEmpty() || redacted.has("models")) out.put("models", modelArray)
    return out
}

/** Preserve full config fields while excluding transport-only response metadata. */
internal fun providerConfigUpdate(redactedConfig: JSONObject, drafts: Map<String, ProviderDraft>): JSONObject {
    val config = JSONObject(redactedConfig.toString())
    for (key in listOf("path", "exists", "parseError", "code")) config.remove(key)
    config.put("providers", JSONObject().apply {
        for ((name, draft) in drafts) put(name, draft.toUpdateJson())
    })
    return config
}

internal val providerFields = setOf("originalName", "baseUrl", "api", "auth", "apiKey", "headers", "apiKeyConfigured", "headersConfigured", "models", "compat", "modelOverrides")
internal val modelFields = setOf("originalId", "id", "name", "baseUrl", "api", "reasoning", "contextWindow", "maxTokens", "input", "cost", "thinking", "compat", "apiKey", "apiKeyConfigured", "headers", "headersConfigured")

internal fun advancedDraftValue(baseline: JSONObject, edits: Map<String, String>, key: String, provider: Boolean): String {
    edits[key]?.let { return it }
    if (key == "extensions") {
        val extra = JSONObject(baseline.toString())
        for (field in if (provider) providerFields else modelFields) extra.remove(field)
        return if (extra.length() == 0) "" else extra.toString(2)
    }
    val parts = key.split('.')
    val value = if (parts.size == 2) baseline.optJSONObject(parts[0])?.opt(parts[1]) else baseline.opt(key)
    return when (value) {
        null, JSONObject.NULL -> ""
        is JSONArray -> (0 until value.length()).joinToString(", ") { value.getString(it) }
        is JSONObject -> value.toString(2)
        else -> value.toString()
    }
}

internal fun applyAdvancedDraft(baseline: JSONObject, edits: Map<String, String>, provider: Boolean): JSONObject {
    val out = JSONObject(baseline.toString())
    for ((key, raw) in edits) {
        val text = raw.trim()
        val parts = key.split('.')
        val value: Any? = when {
            text.isEmpty() -> null
            key == "extensions" || key in setOf("compat", "modelOverrides", "thinking.effortMap") -> {
                requireStrictDraftJson(text)
                val tokener = org.json.JSONTokener(text)
                val obj = tokener.nextValue()
                require(obj is JSONObject && tokener.nextClean() == '\u0000') { "$key must be a JSON object" }
                if (key == "extensions") require(obj.keys().asSequence().none { it in (if (provider) providerFields else modelFields) }) { "Extensions cannot replace standard or protected fields" }
                if (key == "thinking.effortMap") require(obj.keys().asSequence().all { obj.get(it) is String }) { "Effort map values must be strings" }
                obj
            }
            key.startsWith("cost.") -> {
                val number = text.toDoubleOrNull()
                require(number != null && number.isFinite() && number >= 0) { "$key must be a finite non-negative number" }
                number
            }
            key == "input" || key == "thinking.efforts" -> {
                val values = text.split(',').map { it.trim() }
                require(values.all { it.isNotEmpty() } && values.distinct().size == values.size) { "$key needs distinct comma-separated values" }
                if (key == "input") require(values.all { it == "text" || it == "image" }) { "Input supports text and image" }
                JSONArray(values)
            }
            else -> text
        }
        if (key == "extensions") {
            for (field in out.keys().asSequence().toList()) if (field !in (if (provider) providerFields else modelFields)) out.remove(field)
            if (value is JSONObject) for (field in value.keys()) out.put(field, value.get(field))
        } else if (parts.size == 2) {
            val nested = out.optJSONObject(parts[0]) ?: JSONObject()
            if (value == null) nested.remove(parts[1]) else nested.put(parts[1], value)
            if (nested.length() == 0) out.remove(parts[0]) else out.put(parts[0], nested)
        } else if (value == null) out.remove(key) else out.put(key, value)
    }
    if (edits.keys.any { it.startsWith("cost.") } && out.has("cost")) {
        val cost = out.getJSONObject("cost")
        require(listOf("input", "output", "cacheRead", "cacheWrite").all { cost.has(it) }) { "Cost requires input, output, cacheRead and cacheWrite (or clear all four)" }
    }
    return out
}

// org.json accepts non-JSON conveniences (single quotes, bare keys, trailing commas).
// Validate the grammar first so malformed edits remain drafts on Android and JVM alike.
internal fun requireStrictDraftJson(text: String) {
    val tokens = Regex("\\\"(?:[^\\\"\\\\\\x00-\\x1f]|\\\\(?:[\\\"\\\\/bfnrt]|u[0-9a-fA-F]{4}))*\\\"|-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null|[{}\\[\\]:,]")
    var position = 0
    fun next(): String {
        while (position < text.length && text[position] in " \t\r\n") position++
        val match = tokens.find(text, position)
        require(match != null && match.range.first == position) { "Invalid JSON syntax" }
        position = match.range.last + 1
        return match.value
    }
    fun value(first: String, depth: Int) {
        require(depth <= 64) { "JSON nesting is too deep" }
        when (first) {
            "{" -> {
                var key = next()
                if (key == "}") return
                val names = mutableSetOf<String>()
                while (true) {
                    require(key.startsWith('"')) { "JSON object keys must be quoted" }
                    val decoded = org.json.JSONTokener(key).nextValue().toString()
                    require(names.add(decoded)) { "Duplicate JSON key" }
                    require(next() == ":") { "Invalid JSON object" }
                    value(next(), depth + 1)
                    val separator = next()
                    if (separator == "}") return
                    require(separator == ",") { "Invalid JSON object" }
                    key = next()
                }
            }
            "[" -> {
                var item = next()
                if (item == "]") return
                while (true) {
                    value(item, depth + 1)
                    val separator = next()
                    if (separator == "]") return
                    require(separator == ",") { "Invalid JSON array" }
                    item = next()
                }
            }
            else -> require(first !in setOf("}", "]", ":", ",")) { "Invalid JSON value" }
        }
    }
    value(next(), 0)
    require(text.substring(position).all { it in " \t\r\n" }) { "Unexpected content after JSON" }
}

internal fun safeModelAuthUrl(value: String): String? {
    val uri = try { java.net.URI(value) } catch (_: java.net.URISyntaxException) { return null }
    if (!uri.scheme.equals("http", ignoreCase = true) && !uri.scheme.equals("https", ignoreCase = true)) return null
    return value.takeIf { !uri.host.isNullOrBlank() && uri.rawUserInfo == null }
}
