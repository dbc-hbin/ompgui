package com.dbchbin.ompgui.remote.ui

import org.json.JSONArray
import org.json.JSONObject

internal data class NativeSettingText(val en: String, val ko: String) {
    fun localized(korean: Boolean): String = if (korean && ko.isNotBlank()) ko else en
}

internal data class NativeSettingDefinition(
    val path: String,
    val category: String,
    val group: String,
    val label: NativeSettingText,
    val description: NativeSettingText,
    val kind: String,
    val defaultValue: Any?,
    val choices: List<String>,
    val min: Double?,
    val max: Double?,
    val step: Double?,
    val integer: Boolean,
    val items: String?,
    val recordValues: String?,
    val secret: Boolean,
    val admin: Boolean,
    val confirmation: Boolean,
    val scope: String,
)

internal data class NativeSettingIssue(val path: String, val message: String)

internal data class NativeSettingsSnapshot(
    val path: String,
    val scope: String,
    val cwd: String?,
    val settings: JSONObject,
    val effectiveSettings: JSONObject,
    val catalog: List<NativeSettingDefinition>,
    val secretStatus: Map<String, Boolean>,
    val issues: List<NativeSettingIssue>,
)

internal fun parseNativeSettingsSnapshot(json: JSONObject): NativeSettingsSnapshot {
    val scope = json.optString("scope", "global")
    require(scope == "global" || scope == "project") { "Invalid settings scope" }
    val path = json.optString("path").takeIf { it.isNotBlank() }
        ?: throw IllegalArgumentException("Settings response is missing its host path")
    val settings = json.optJSONObject("settings")
        ?: throw IllegalArgumentException("Settings response is missing persisted overrides")
    val effective = json.optJSONObject("effectiveSettings")
        ?: throw IllegalArgumentException("Settings response is missing effective settings")
    val catalogJson = json.optJSONArray("catalog")
        ?: throw IllegalArgumentException("Settings response is missing the settings catalog")
    val catalog = buildList {
        for (index in 0 until catalogJson.length()) {
            val item = catalogJson.optJSONObject(index) ?: continue
            val settingPath = item.optString("path").takeIf { it.isNotBlank() } ?: continue
            val category = item.optString("category")
            val kind = item.optString("kind")
            val settingScope = item.optString("scope")
            if (category !in setOf("models", "intelligence", "agents", "tools", "safety", "system") ||
                kind !in setOf("boolean", "number", "string", "enum", "array", "object") ||
                settingScope !in setOf("global", "both")) continue
            val label = item.optJSONObject("label") ?: JSONObject()
            val description = item.optJSONObject("description") ?: JSONObject()
            val choicesJson = item.optJSONArray("choices")
            val choices = buildList {
                if (choicesJson != null) for (choiceIndex in 0 until choicesJson.length()) {
                    choicesJson.optString(choiceIndex).takeIf { it.isNotBlank() }?.let(::add)
                }
            }
            add(
                NativeSettingDefinition(
                    path = settingPath,
                    category = category,
                    group = item.optString("group").ifBlank { settingPath.substringBefore('.') },
                    label = NativeSettingText(label.optString("en").ifBlank { settingPath }, label.optString("ko")),
                    description = NativeSettingText(description.optString("en"), description.optString("ko")),
                    kind = kind,
                    defaultValue = item.opt("defaultValue")?.takeUnless { it == JSONObject.NULL },
                    choices = choices,
                    min = item.opt("min")?.let(::jsonNumber),
                    max = item.opt("max")?.let(::jsonNumber),
                    step = item.opt("step")?.let(::jsonNumber),
                    integer = item.optBoolean("integer"),
                    items = item.optString("items").takeIf { it in setOf("string", "number", "object") },
                    recordValues = item.optString("recordValues").takeIf { it.isNotBlank() },
                    secret = item.optBoolean("secret"),
                    admin = item.optBoolean("admin"),
                    confirmation = item.optBoolean("confirmation"),
                    scope = settingScope,
                ),
            )
        }
    }
    require(catalog.isNotEmpty()) { "Settings catalog is empty or unsupported" }
    val secretJson = json.optJSONObject("secretStatus") ?: JSONObject()
    val secretStatus = buildMap {
        for (key in secretJson.keys()) put(key, secretJson.optBoolean(key))
    }
    val issuesJson = json.optJSONArray("issues") ?: JSONArray()
    val issues = buildList {
        for (index in 0 until issuesJson.length()) {
            val issue = issuesJson.optJSONObject(index) ?: continue
            val issuePath = issue.optString("path").takeIf { it.isNotBlank() } ?: continue
            val message = issue.optString("message").takeIf { it.isNotBlank() } ?: continue
            add(NativeSettingIssue(issuePath, message))
        }
    }
    return NativeSettingsSnapshot(path, scope, json.optString("cwd").takeIf { it.isNotBlank() }, settings, effective, catalog, secretStatus, issues)
}

internal fun settingIssueForPath(issues: List<NativeSettingIssue>, path: String): NativeSettingIssue? =
    issues.firstOrNull { issue ->
        issue.path == path || issue.path.startsWith("$path.") || path.startsWith("${issue.path}.")
    }

private fun jsonNumber(value: Any): Double? = when (value) {
    is Number -> value.toDouble()
    is String -> value.toDoubleOrNull()
    else -> null
}

internal fun nestedSetting(root: JSONObject, path: String): Any? {
    var node: Any = root
    for (segment in path.split('.')) {
        if (node !is JSONObject || !node.has(segment)) return null
        node = node.opt(segment) ?: return null
        if (node == JSONObject.NULL) return null
    }
    return node
}

internal fun nestedSettingsPatch(path: String, value: Any): JSONObject {
    val root = JSONObject()
    var node = root
    val segments = path.split('.')
    require(segments.isNotEmpty() && segments.none { it.isBlank() }) { "Invalid setting path" }
    for (segment in segments.dropLast(1)) {
        val child = JSONObject()
        node.put(segment, child)
        node = child
    }
    node.put(segments.last(), value)
    return root
}

internal fun parseSettingDraft(definition: NativeSettingDefinition, draft: String): Any {
    return when (definition.kind) {
        "number" -> {
            val value = draft.trim().toDoubleOrNull() ?: throw IllegalArgumentException("Enter a number")
            if (definition.integer && value % 1.0 != 0.0) throw IllegalArgumentException("Enter a whole number")
            definition.min?.let { require(value >= it) { "Minimum: ${formatJsonNumber(it)}" } }
            definition.max?.let { require(value <= it) { "Maximum: ${formatJsonNumber(it)}" } }
            definition.step?.takeIf { it > 0.0 }?.let { step ->
                val units = (value - (definition.min ?: 0.0)) / step
                require(kotlin.math.abs(units - kotlin.math.round(units)) < 1e-9) { "Use increments of ${formatJsonNumber(step)}" }
            }
            if (definition.integer) value.toLong() else value
        }
        "array" -> JSONArray(draft).also { array ->
            for (index in 0 until array.length()) when (definition.items) {
                "number" -> require(array.opt(index) is Number) { "Every item must be a number" }
                "object" -> require(array.opt(index) is JSONObject) { "Every item must be an object" }
                else -> {
                    require(array.opt(index) is String) { "Every item must be text" }
                    if (definition.choices.isNotEmpty()) require(array.getString(index) in definition.choices) { "Unsupported item: ${array.getString(index)}" }
                }
            }
        }
        "object" -> JSONObject(draft).also { objectValue ->
            when (definition.path) {
                "providers.maxInFlightRequests" -> for (key in objectValue.keys()) require(objectValue.opt(key) is Number) { "$key must be a number" }
                "modelTags" -> for (key in objectValue.keys()) {
                    val tag = objectValue.optJSONObject(key) ?: throw IllegalArgumentException("$key must be an object")
                    require(tag.opt("name") is String && tag.optString("name").isNotBlank()) { "$key.name is required" }
                    if (tag.has("color")) require(tag.opt("color") is String) { "$key.color must be text" }
                    if (tag.has("hidden")) require(tag.opt("hidden") is Boolean) { "$key.hidden must be true or false" }
                }
                "images.urls.options" -> for (key in objectValue.keys()) require(objectValue.opt(key) is JSONObject) { "$key must be an object" }
            }
            for (key in objectValue.keys()) {
                val entry = objectValue.opt(key)
                when (definition.recordValues) {
                    "string" -> require(entry is String) { "$key must be text" }
                    "boolean-string" -> require(entry is Boolean || entry is String) { "$key must be true, false, or text" }
                    "string-array" -> {
                        require(entry is JSONArray) { "$key must be an array" }
                        for (index in 0 until entry.length()) require(entry.opt(index) is String) { "$key must contain only text" }
                    }
                    "string-or-string-array" -> {
                        require(entry is String || entry is JSONArray) { "$key must be text or a text array" }
                        if (entry is JSONArray) for (index in 0 until entry.length()) require(entry.opt(index) is String) { "$key must contain only text" }
                    }
                    "approval" -> require(entry is String && entry in setOf("allow", "prompt", "deny")) { "$key must be allow, prompt, or deny" }
                }
            }
        }
        else -> draft
    }
}

internal fun formatSettingValue(value: Any?): String = when (value) {
    null, JSONObject.NULL -> ""
    is JSONObject -> value.toString(2)
    is JSONArray -> value.toString(2)
    is Double -> formatJsonNumber(value)
    else -> value.toString()
}

private fun formatJsonNumber(value: Double): String = if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()
