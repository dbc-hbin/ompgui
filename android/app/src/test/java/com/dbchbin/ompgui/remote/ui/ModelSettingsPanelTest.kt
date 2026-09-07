package com.dbchbin.ompgui.remote.ui

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelSettingsPanelTest {
    @Test
    fun connectivityReasonsStayDistinctAndNeverEchoUnknownCodes() {
        val text: (Int) -> String = { id ->
            when (id) {
                com.dbchbin.ompgui.remote.R.string.model_connectivity_unsupported -> "Unsupported provider/API"
                com.dbchbin.ompgui.remote.R.string.model_connectivity_credential_method -> "Unsupported credential method"
                com.dbchbin.ompgui.remote.R.string.model_connectivity_auth_required -> "Credentials required"
                com.dbchbin.ompgui.remote.R.string.model_connectivity_timeout -> "Timed out"
                com.dbchbin.ompgui.remote.R.string.model_connectivity_model_mismatch -> "Wrong model"
                com.dbchbin.ompgui.remote.R.string.model_connectivity_provider_failed -> "Provider failure"
                com.dbchbin.ompgui.remote.R.string.model_connectivity_confirmation_required -> "Confirm request"
                com.dbchbin.ompgui.remote.R.string.model_connectivity_config_invalid -> "Correct configuration"
                else -> error("Unexpected reason")
            }
        }
        assertEquals("Unsupported provider/API", modelConnectivityErrorNote("connectivity_unsupported", text))
        assertEquals("Unsupported credential method", modelConnectivityErrorNote("connectivity_credential_method_unsupported", text))
        assertEquals("Credentials required", modelConnectivityErrorNote("connectivity_auth_required", text))
        assertEquals("Timed out", modelConnectivityErrorNote("connectivity_timeout", text))
        assertEquals("Wrong model", modelConnectivityErrorNote("connectivity_model_mismatch", text))
        assertEquals("Provider failure", modelConnectivityErrorNote("connectivity_failed", text))
        assertEquals("Confirm request", modelConnectivityErrorNote("connectivity_confirmation_required", text))
        for (code in listOf("models_config_invalid", "provider_name_required", "provider_required", "model_required", "model_id_required")) {
            assertEquals("Correct configuration", modelConnectivityErrorNote(code, text))
        }
        for (code in listOf(null, "", "private-api-key", "{\"code\":\"connectivity_timeout\"}")) {
            assertEquals("Provider failure", modelConnectivityErrorNote(code, text))
        }
        assertEquals(null, modelConnectivityErrorNote("connectivity_cancelled", text))
        assertEquals(null, modelConnectivityErrorNote("request_cancelled", text))
    }

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
    fun creationOmitsIdentityButRenamesKeepExistingIdentities() {
        val existing = providerDraftFromJson("A", JSONObject("""{"models":[{"id":"old"}]}"""))
        val created = existing.copy(originalName = null, name = "new", models = emptyList()).toUpdateJson()
        assertFalse(created.has("originalName"))
        val renamed = existing.copy(name = "renamed", models = listOf(existing.models.single().copy(id = "new-id")))
        val update = providerConfigUpdate(JSONObject(), mapOf(renamed.name to renamed)).getJSONObject("providers")
        assertFalse(update.has("A"))
        assertEquals("A", update.getJSONObject("renamed").getString("originalName"))
        val model = update.getJSONObject("renamed").getJSONArray("models").getJSONObject(0)
        assertEquals("old", model.getString("originalId"))
        assertEquals("new-id", model.getString("id"))
    }

    @Test
    fun deletionSnapshotPreservesAdvancedFieldsAndOmitsProtectedValues() {
        val response = JSONObject("""{
            "path":"/models.yml", "exists":true, "extension":{"enabled":true},
            "providers":{
                "A":{"originalName":"A","apiKeyConfigured":true,"headersConfigured":true,
                    "modelOverrides":{"builtin":{"contextWindow":99}},"compat":{"feature":true},
                    "futureProvider":{"nested":[1,2]},
                    "models":[{"id":"m","originalId":"m","reasoning":false,
                        "input":["text","image"],"cost":{"input":0.2},"compat":{"stream":false},
                        "thinking":{"mode":"effort","efforts":["high"]},"futureModel":{"keep":true}}]},
                "B":{"models":[{"id":"delete"}]}
            }
        }""")
        val original = response.getJSONObject("providers").getJSONObject("A")
        val draft = providerDraftFromJson("A", original).copy(baseUrl = "https://example.com")
        val snapshot = providerConfigUpdate(response, mapOf("A" to draft))
        assertTrue(snapshot.getJSONObject("extension").getBoolean("enabled"))
        assertFalse(snapshot.has("path"))
        val providers = snapshot.getJSONObject("providers")
        assertFalse(providers.has("B"))
        val survivor = providers.getJSONObject("A")
        assertEquals("https://example.com", survivor.getString("baseUrl"))
        for (key in listOf("modelOverrides", "compat", "futureProvider")) {
            assertEquals(original.get(key).toString(), survivor.get(key).toString())
        }
        val model = survivor.getJSONArray("models").getJSONObject(0)
        val originalModel = original.getJSONArray("models").getJSONObject(0)
        for (key in listOf("input", "cost", "compat", "thinking", "futureModel", "reasoning")) {
            assertEquals(originalModel.get(key).toString(), model.get(key).toString())
        }
        for (key in listOf("apiKey", "headers", "apiKeyConfigured", "headersConfigured")) assertFalse(survivor.has(key))
        assertFalse(model.has("headers"))
        assertFalse(original.has("baseUrl"))
    }

    @Test
    fun untouchedAndBlankSecretsStayOmittedAndExplicitClearsStayNull() {
        val draft = providerDraftFromJson("A", JSONObject("""{"apiKeyConfigured":true,"headersConfigured":true}"""))
        val blank = draft.copy(apiKeyTouched = true, apiKeyInput = "", headersTouched = true, headerRows = listOf(HeaderRow("X-Key", ""))).toUpdateJson()
        assertFalse(blank.has("apiKey"))
        assertFalse(blank.has("headers"))
        val cleared = draft.copy(clearKey = true, clearHeaders = true).toUpdateJson()
        assertTrue(cleared.has("apiKey") && cleared.isNull("apiKey"))
        assertTrue(cleared.has("headers") && cleared.isNull("headers"))
        val replaced = draft.copy(apiKeyTouched = true, apiKeyInput = "new-key", headersTouched = true, headerRows = listOf(HeaderRow("X-Key", "new-value"))).toUpdateJson()
        assertEquals("new-key", replaced.getString("apiKey"))
        assertEquals("new-value", replaced.getJSONObject("headers").getString("X-Key"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsUnredactedModelHeadersBeforeCreatingDraft() {
        providerDraftFromJson("A", JSONObject("""{"models":[{"id":"m","headers":{"Authorization":"secret"}}]}"""))
    }

    @Test
    fun advancedEditsRoundTripWithoutLosingNestedExtensions() {
        val provider = providerDraftFromJson("P", JSONObject("""{"future":{"keep":true},"models":[{"id":"m","thinking":{"future":7},"cost":{"input":1,"output":2,"cacheRead":0,"cacheWrite":0}}]}"""))
        val edited = provider.copy(advanced = mapOf("compat" to "{\"stream\":true}", "modelOverrides" to "{\"builtin\":{\"contextWindow\":42}}"), models = listOf(provider.models.single().copy(advanced = mapOf(
            "input" to "text, image", "cost.output" to "3.5", "thinking.mode" to "effort",
            "thinking.efforts" to "low, high", "thinking.defaultLevel" to "high", "thinking.effortMap" to "{\"high\":\"max\"}",
        ))))
        val saved = edited.toUpdateJson()
        val reopened = providerDraftFromJson("P", saved).toUpdateJson()
        assertEquals(saved.toString(), reopened.toString())
        assertEquals(7, saved.getJSONArray("models").getJSONObject(0).getJSONObject("thinking").getInt("future"))
        assertTrue(saved.getJSONObject("future").getBoolean("keep"))
        val cleared = edited.copy(advanced = mapOf("compat" to ""), models = listOf(provider.models.single().copy(advanced = mapOf("cost.input" to "", "cost.output" to "", "cost.cacheRead" to "", "cost.cacheWrite" to "")))).toUpdateJson()
        assertFalse(cleared.has("compat"))
        assertFalse(cleared.getJSONArray("models").getJSONObject(0).has("cost"))
    }

    @Test
    fun malformedAdvancedDraftsNeverProduceUpdates() {
        val draft = providerDraftFromJson("P", JSONObject("""{"models":[{"id":"m"}]}"""))
        for (text in listOf("{", "[]", "{'a':1}", "{a:1}", "{\"a\":1,}", "{\"a\":1} trailing", "{\"a\":1,\"a\":2}")) {
            assertTrue(runCatching { draft.copy(advanced = mapOf("compat" to text)).toUpdateJson() }.isFailure)
        }
        for (number in listOf("-1", "NaN", "Infinity", "1e999", "oops")) {
            assertTrue(runCatching { draft.copy(models = listOf(draft.models.single().copy(advanced = mapOf("cost.input" to number)))).toUpdateJson() }.isFailure)
        }
        assertTrue(runCatching { draft.copy(models = listOf(draft.models.single().copy(contextWindow = "1.5"))).toUpdateJson() }.isFailure)
        assertTrue(runCatching { draft.copy(advanced = mapOf("extensions" to "{\"apiKey\":\"secret\"}")).toUpdateJson() }.isFailure)
        assertTrue(runCatching { draft.copy(models = draft.models + draft.models).toUpdateJson() }.isFailure)
        assertFalse(draft.redacted.has("compat"))
    }

    @Test
    fun catalogOnlyCreatesCompleteKnownPricingAndNewIdentity() {
        val entry = JSONObject("""{"id":"m","name":"Model","reasoning":true,"input":["text","image"],"contextWindow":1000,"maxTokens":500,"cost":{"input":1,"output":2}}""")
        val model = catalogModelDraft(entry)
        assertEquals(null, model.originalId)
        assertEquals(0.0, model.redacted.getJSONObject("cost").getDouble("cacheWrite"), 0.0)
        assertEquals(2, model.redacted.getJSONArray("input").length())
        entry.getJSONObject("cost").remove("output")
        assertFalse(catalogModelDraft(entry).redacted.has("cost"))
    }

    @Test
    fun authNavigationOnlyAcceptsAbsoluteHttpUrlsWithoutCredentials() {
        assertEquals("https://example.com/login?code=a%20b", safeModelAuthUrl("https://example.com/login?code=a%20b"))
        assertEquals("http://localhost:8080/auth", safeModelAuthUrl("http://localhost:8080/auth"))
        for (url in listOf("javascript:alert(1)", "intent://login", "file:///tmp/auth", "https:///login", "https://user:secret@example.com", "//example.com", "https://example.com/\n")) {
            assertEquals(null, safeModelAuthUrl(url))
        }
    }
}
