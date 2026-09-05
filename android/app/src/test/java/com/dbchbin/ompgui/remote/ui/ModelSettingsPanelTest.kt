package com.dbchbin.ompgui.remote.ui

import com.dbchbin.ompgui.remote.relay.RelayRequestException
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelSettingsPanelTest {
    @Test
    fun sanitizesRolesLikeDesktopPutFilter() {
        val cleaned = sanitizeRolesForSave(
            mapOf(
                "default" to "openai/gpt-5",
                "smol" to "  ",
                "slow" to null,
                "  " to "anthropic/claude",
                "vision" to "anthropic/claude:high",
            ),
        )
        assertEquals(
            mapOf("default" to "openai/gpt-5", "vision" to "anthropic/claude:high"),
            cleaned,
        )
    }

    @Test
    fun parsesCatalogSkippingMalformedRows() {
        val data = JSONObject()
            .put(
                "models",
                JSONArray()
                    .put(JSONObject().put("provider", "openai").put("id", "gpt").put("name", "GPT"))
                    .put(JSONObject().put("provider", "").put("id", "bad"))
                    .put(JSONObject().put("provider", "anthropic").put("id", "claude")),
            )
            .put("defaultModel", JSONObject().put("provider", "openai").put("modelId", "gpt"))
            .put(
                "connectedProviders",
                JSONArray().put(JSONObject().put("id", "openai").put("name", "OpenAI").put("disabled", false)),
            )
        val catalog = parseModelCatalog(data)
        assertEquals(2, catalog.models.size)
        assertEquals("openai/gpt", catalog.defaultModel)
        assertEquals("gpt", catalog.models[0].id)
        // Missing names fall back to the id, mirroring desktop /api/models.
        assertEquals("claude", catalog.models[1].name)
        assertEquals(1, catalog.connectedProviders.size)
        assertFalse(catalog.unavailable)
    }

    @Test
    fun parsesRolesSkippingBlankSelectors() {
        val data = JSONObject().put(
            "roles",
            JSONObject().put("default", "openai/gpt-5").put("smol", "  ").put("slow", ""),
        )
        assertEquals(mapOf("default" to "openai/gpt-5"), parseRoleMap(data))
        assertTrue(parseRoleMap(JSONObject()).isEmpty())
    }

    @Test
    fun redactionGuardRejectsRawSecrets() {
        assertTrue(providerRedactionHolds(JSONObject().put("apiKeyConfigured", true)))
        assertFalse(providerRedactionHolds(JSONObject().put("apiKey", "sk-secret")))
        assertFalse(providerRedactionHolds(JSONObject().put("headers", JSONObject().put("X-K", "v"))))
    }

    @Test
    fun requestErrorNoteSurfacesWireCodes() {
        val coded = RelayRequestException("login_device_mismatch", "Login belongs to another device")
        assertEquals("login_device_mismatch: Login belongs to another device", modelRequestErrorNote(coded, "auth.login.poll"))
        val bare = RelayRequestException("", "")
        assertEquals("auth.login.poll failed", modelRequestErrorNote(bare, "auth.login.poll"))
        assertEquals("boom", modelRequestErrorNote(IllegalStateException("boom"), "catalog.get"))
        assertEquals("catalog.get failed", modelRequestErrorNote(IllegalStateException(), "catalog.get"))
    }
}
