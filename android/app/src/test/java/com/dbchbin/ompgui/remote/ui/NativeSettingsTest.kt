package com.dbchbin.ompgui.remote.ui

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeSettingsTest {
    @Test
    fun parsesServerCatalogAndKeepsSecretPresenceOnly() {
        val response = JSONObject()
            .put("path", "/tmp/home/.omp/settings.yml")
            .put("scope", "project")
            .put("cwd", "/tmp/project")
            .put("settings", JSONObject().put("retry", JSONObject().put("maxRetries", 4)))
            .put("effectiveSettings", JSONObject().put("retry", JSONObject().put("maxRetries", 4)))
            .put("secretStatus", JSONObject().put("auth.broker.token", true))
            .put("issues", JSONArray().put(JSONObject().put("path", "retry.maxRetries").put("message", "Stored value was omitted")))
            .put("catalog", JSONArray()
                .put(definition("retry.maxRetries", "number").put("integer", true).put("min", 0).put("max", 20))
                .put(definition("auth.broker.token", "string").put("secret", true).put("admin", true).put("scope", "global")))

        val snapshot = parseNativeSettingsSnapshot(response)

        assertEquals("project", snapshot.scope)
        assertEquals(4, nestedSetting(snapshot.settings, "retry.maxRetries"))
        assertTrue(snapshot.secretStatus.getValue("auth.broker.token"))
        assertNull(nestedSetting(snapshot.settings, "auth.broker.token"))
        assertTrue(snapshot.catalog.last().secret)
        assertTrue(snapshot.catalog.last().admin)
        assertEquals("global", snapshot.catalog.last().scope)
        assertEquals("retry.maxRetries", snapshot.issues.single().path)
        assertEquals("Stored value was omitted", snapshot.issues.single().message)
    }

    @Test
    fun ignoresMalformedCatalogRowsButRejectsMissingCatalog() {
        val valid = definition("memory.backend", "enum").put("choices", JSONArray(listOf("off", "mnemopi")))
        val response = JSONObject()
            .put("path", "/tmp/settings.yml")
            .put("scope", "global")
            .put("settings", JSONObject())
            .put("effectiveSettings", JSONObject())
            .put("catalog", JSONArray().put(JSONObject().put("path", "bad")).put(valid))

        val snapshot = parseNativeSettingsSnapshot(response)
        assertEquals(listOf("memory.backend"), snapshot.catalog.map { it.path })
        assertEquals(listOf("off", "mnemopi"), snapshot.catalog.single().choices)

        response.remove("catalog")
        assertTrue(runCatching { parseNativeSettingsSnapshot(response) }.isFailure)
    }

    @Test
    fun relatesPersistedIssuesToCatalogParentsAndChildrenOnly() {
        val issues = listOf(
            NativeSettingIssue("modelRoles.reviewer", "Invalid role"),
            NativeSettingIssue("providers", "Invalid provider map"),
        )

        assertEquals("modelRoles.reviewer", settingIssueForPath(issues, "modelRoles")?.path)
        assertEquals("providers", settingIssueForPath(issues, "providers.openai")?.path)
        assertNull(settingIssueForPath(issues, "retry.maxRetries"))
    }

    @Test
    fun createsMinimalNestedPatchWithoutSiblingSettings() {
        val patch = nestedSettingsPatch("retry.maxRetries", 7)
        assertEquals(7, patch.getJSONObject("retry").getInt("maxRetries"))
        assertEquals(1, patch.length())
        assertEquals(1, patch.getJSONObject("retry").length())
        assertFalse(patch.has("settings"))
    }

    @Test
    fun validatesNumericBoundsAndArrayItemTypes() {
        val number = parsedDefinition(definition("retry.maxRetries", "number").put("integer", true).put("min", 0).put("max", 20))
        assertEquals(12L, parseSettingDraft(number, "12"))
        assertTrue(runCatching { parseSettingDraft(number, "12.5") }.isFailure)
        assertTrue(runCatching { parseSettingDraft(number, "21") }.isFailure)

        val array = parsedDefinition(definition("task.disabledAgents", "array").put("items", "string"))
        assertEquals(2, (parseSettingDraft(array, "[\"one\",\"two\"]") as JSONArray).length())
        assertTrue(runCatching { parseSettingDraft(array, "[1]") }.isFailure)
    }

    private fun parsedDefinition(value: JSONObject): NativeSettingDefinition {
        val response = JSONObject()
            .put("path", "/tmp/settings.yml")
            .put("scope", "global")
            .put("settings", JSONObject())
            .put("effectiveSettings", JSONObject())
            .put("catalog", JSONArray().put(value))
        return parseNativeSettingsSnapshot(response).catalog.single()
    }

    private fun definition(path: String, kind: String) = JSONObject()
        .put("path", path)
        .put("category", if (path.startsWith("retry") || path.startsWith("memory")) "intelligence" else if (path.startsWith("task")) "agents" else "system")
        .put("group", path.substringBefore('.'))
        .put("label", JSONObject().put("en", path).put("ko", path))
        .put("description", JSONObject().put("en", "Description").put("ko", "설명"))
        .put("kind", kind)
        .put("scope", "both")
}
