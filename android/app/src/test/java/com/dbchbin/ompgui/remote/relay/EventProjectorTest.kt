package com.dbchbin.ompgui.remote.relay

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EventProjectorTest {
    @Test
    fun boundedToolEndWaitsForFetchableMessageAndCannotOverwriteItLate() {
        val end = JSONObject("""{"type":"tool_execution_end","toolCallId":"read-1","toolName":"read","result":{"contentPending":true,"truncated":true,"content":[{"type":"text","text":"preview"},{"type":"image","deferred":true}],"deferredImages":{"count":1}}}""")
        val pending = EventProjector.applyMessages(emptyList(), end)
        assertTrue(pending.single().streaming)
        assertNull(pending.single().entryId)
        assertTrue(pending.single().truncated)
        val final = JSONObject("""{"type":"message_end","message":{"role":"toolResult","entryId":"saved-result","toolCallId":"read-1","toolName":"read","text":"complete output","content":[{"type":"text","text":"complete output"},{"type":"image","deferred":true}],"deferredImages":{"entryId":"saved-result","count":1}}}""")
        val complete = EventProjector.applyMessages(pending, final)
        assertEquals(1, complete.size)
        assertFalse(complete.single().streaming)
        assertFalse(complete.single().truncated)
        assertEquals("saved-result", complete.single().entryId)
        assertEquals("complete output", complete.single().text)
        assertSame(complete, EventProjector.applyMessages(complete, end))
    }

    @Test
    fun pendingSelectBeforeSnapshotSurvivesWithoutAcceptingOrdinaryMessages() {
        val select = JSONObject(
            """{"type":"extension_ui_request","method":"select","id":"ask-1","title":"Choose","options":["First","Second"]}""",
        )
        val pending = JSONObject("""{"type":"extension_ui_pending","ids":["ask-1"]}""")
        assertTrue(EventProjector.acceptsSessionEvent("session", "session", true, false, select))
        assertTrue(EventProjector.acceptsSessionEvent("session", "session", true, false, pending))
        val dialogs = EventProjector.applyExtensionDialogs(emptyList(), select)
        val reconciled = EventProjector.applyExtensionDialogs(dialogs, pending)
        assertEquals(listOf("ask-1"), reconciled.map { it.id })
        assertSame(dialogs.single(), reconciled.single())

        val message = JSONObject("""{"type":"message_end","message":{"role":"assistant","text":"old answer"}}""")
        assertFalse(EventProjector.acceptsSessionEvent("session", "session", true, false, message))
        assertTrue(EventProjector.acceptsSessionEvent("session", "session", false, false, message))
        for (event in listOf(select, pending)) {
            assertFalse(EventProjector.acceptsSessionEvent("other", "session", true, false, event))
            assertFalse(EventProjector.acceptsSessionEvent("session", "session", true, true, event))
            assertFalse(EventProjector.acceptsSessionEvent("other", "session", false, false, event))
            assertFalse(EventProjector.acceptsSessionEvent("session", "session", false, true, event))
        }
    }

    @Test
    fun pendingIdsRemoveStaleDialogsWithoutReplacingActiveDialog() {
        val stale = EventProjector.ChatExtensionRequest.Select("stale", "Old", listOf("Old choice"))
        val active = EventProjector.ChatExtensionRequest.Select("active", "Current", listOf("Current choice"))
        val reconciled = EventProjector.applyExtensionDialogs(
            listOf(stale, active),
            JSONObject("""{"type":"extension_ui_pending","ids":["active","not-yet-replayed"]}"""),
        )
        assertEquals(listOf("active"), reconciled.map { it.id })
        assertSame(active, reconciled.single())
        assertEquals(
            emptyList<EventProjector.ChatExtensionRequest>(),
            EventProjector.applyExtensionDialogs(reconciled, JSONObject("""{"type":"extension_ui_pending","ids":[]}""")),
        )
    }

    @Test
    fun replayReplacesMatchingDialogInPlaceWithoutClearingOtherDialogs() {
        val first = EventProjector.ChatExtensionRequest.Input("first", "First", null)
        val old = EventProjector.ChatExtensionRequest.Select("ask", "Old", listOf("Old choice"))
        val last = EventProjector.ChatExtensionRequest.Input("last", "Last", null)
        val replayed = EventProjector.applyExtensionDialogs(
            listOf(first, old, last),
            JSONObject("""{"type":"extension_ui_request","method":"select","id":"ask","title":"Updated","options":["New choice"]}"""),
        )
        assertEquals(listOf("first", "ask", "last"), replayed.map { it.id })
        assertSame(first, replayed.first())
        assertSame(last, replayed.last())
        val updated = replayed[1] as EventProjector.ChatExtensionRequest.Select
        assertEquals("Updated", updated.title)
        assertEquals(listOf("New choice"), updated.options)
        val afterUnrelatedEvent = EventProjector.applyExtensionDialogs(replayed, JSONObject("""{"type":"agent_start"}"""))
        assertEquals(replayed, afterUnrelatedEvent)
    }

    @Test
    fun nativeSelectPreservesExactLabelsAndAlignedDescriptionsInResponse() {
        val labels = listOf("\u2713  Keep current  (recommended)", "  Switch  ", "Other")
        val request = JSONObject()
            .put("type", "extension_ui_request")
            .put("method", "select")
            .put("id", "native-ask-42")
            .put("title", "Choose a strategy")
            .put("options", JSONArray(labels))
            .put("optionDetails", JSONArray().put(JSONObject().put("description", "Keep existing behavior")).put(JSONObject.NULL).put(JSONObject().put("description", "Write a custom answer")))
        val parsed = EventProjector.parseExtensionDialog(request) as EventProjector.ChatExtensionRequest.Select
        assertEquals(labels, parsed.options)
        assertEquals(listOf("Keep existing behavior", null, "Write a custom answer"), parsed.optionDescriptions)
        val response = ChatRequests.extensionResponse(parsed.id, JSONObject().put("value", parsed.options.first()))
        assertEquals("extension_ui_response", response.getString("type"))
        assertEquals("native-ask-42", response.getString("id"))
        assertEquals(labels.first(), response.getString("value"))
    }

    @Test
    fun malformedObjectOptionRejectsSelectInsteadOfStringifyingOrDroppingIt() {
        val request = JSONObject(
            """{"type":"extension_ui_request","method":"select","id":"ask","title":"Choose","options":["Valid",{"label":"Not a native string option"}]}""",
        )
        assertNull(EventProjector.parseExtensionDialog(request))
        val active = EventProjector.ChatExtensionRequest.Input("existing", "Answer", null)
        val remaining = EventProjector.applyExtensionDialogs(listOf(active), request)
        assertEquals(listOf("existing"), remaining.map { it.id })
        assertSame(active, remaining.single())
    }

    @Test
    fun cancelTargetsPreviousSelectBeforeEditorWithExactPrefillArrives() {
        val select = EventProjector.ChatExtensionRequest.Select("select", "Choose", listOf("Other"))
        val unrelated = EventProjector.ChatExtensionRequest.Input("unrelated", "Answer", null)
        val cancelled = EventProjector.applyExtensionDialogs(
            listOf(select, unrelated),
            JSONObject("""{"type":"extension_ui_request","method":"cancel","id":"cancel-command","targetId":"select"}"""),
        )
        assertEquals(listOf("unrelated"), cancelled.map { it.id })
        assertSame(unrelated, cancelled.single())
        val prefill = "  Existing answer\nSecond line  \n"
        val edited = EventProjector.applyExtensionDialogs(
            cancelled,
            JSONObject().put("type", "extension_ui_request").put("method", "editor")
                .put("id", "editor").put("title", "Custom answer").put("prefill", prefill),
        )
        assertEquals(listOf("unrelated", "editor"), edited.map { it.id })
        assertSame(unrelated, edited.first())
        assertEquals(prefill, (edited.last() as EventProjector.ChatExtensionRequest.Editor).prefill)
    }

    @Test
    fun finalMessageWithoutStreamingUpdatesStillAppearsAfterUser() {
        val current = listOf(DisplayMessage(role = "user", text = "question"))
        val event = JSONObject().put("type", "message_end").put(
            "message", JSONObject().put("role", "assistant").put("text", "answer"),
        )
        val result = EventProjector.applyMessages(current, event)
        assertEquals(listOf("question", "answer"), result.map { it.text })
        assertFalse(result.last().streaming)
    }

    @Test
    fun streamedLongResponseRemainsAvailableAfterFinalEvent() {
        val text = "x".repeat(8_000) + " final paragraph"
        val message = JSONObject().put("role", "assistant").put("text", text)
        val streaming = EventProjector.applyMessages(emptyList(), JSONObject().put("type", "message_update").put("message", message))
        val completed = EventProjector.applyMessages(streaming, JSONObject().put("type", "message_end").put("message", message))
        assertEquals(text, completed.single().text)
        assertFalse(completed.single().streaming)
    }

    @Test
    fun replacesStreamingAssistantThenFreezesOnEnd() {
        val start = JSONObject(
            """{"type":"message_update","message":{"role":"assistant","content":[{"type":"text","text":"Hel"}]}}""",
        )
        val next = JSONObject(
            """{"type":"message_update","message":{"role":"assistant","text":"Hello"}}""",
        )
        val end = JSONObject(
            """{"type":"message_end","message":{"role":"assistant","text":"Hello!"}}""",
        )
        val afterStart = EventProjector.applyMessages(emptyList(), start)
        assertEquals(1, afterStart.size)
        assertTrue(afterStart[0].streaming)
        assertEquals("Hel", afterStart[0].text)

        val afterNext = EventProjector.applyMessages(afterStart, next)
        assertEquals(1, afterNext.size)
        assertEquals("Hello", afterNext[0].text)
        assertTrue(afterNext[0].streaming)

        val frozen = EventProjector.applyMessages(afterNext, end)
        assertEquals("Hello!", frozen[0].text)
        assertFalse(frozen[0].streaming)
    }

    @Test
    fun nativeToolProgressAndCompletionSurviveStableAssistantFinalReplacement() {
        val assistant = JSONObject(
            """{"role":"assistant","id":"assistant-1","content":[{"type":"text","text":"Inspecting"},{"type":"toolCall","id":"call-1","name":"read","arguments":{"path":"image.png"}}]}""",
        )
        val started = EventProjector.applyMessages(
            emptyList(), JSONObject().put("type", "message_start").put("message", assistant),
        )
        val executing = EventProjector.applyMessages(
            started, JSONObject("""{"type":"tool_execution_start","toolCallId":"call-1","toolName":"read","args":{"path":"image.png"}}"""),
        )
        assertEquals(listOf("assistant", "toolResult"), executing.map { it.role })
        val partial = EventProjector.applyMessages(
            executing, JSONObject("""{"type":"tool_execution_update","toolCallId":"call-1","toolName":"read","partialResult":{"content":[{"type":"text","text":"Reading image"}]}}"""),
        )
        assertEquals("Reading image", partial.single { it.role == "toolResult" }.text)
        assertTrue(partial.single { it.role == "toolResult" }.streaming)
        val finalAssistant = JSONObject(assistant.toString()).put(
            "content", JSONArray(assistant.getJSONArray("content").toString()).put(JSONObject().put("type", "text").put("text", " complete")),
        )
        val assistantEnded = EventProjector.applyMessages(
            partial, JSONObject().put("type", "message_end").put("message", finalAssistant),
        )
        assertEquals("Reading image", assistantEnded.single { it.role == "toolResult" }.text)
        val completed = EventProjector.applyMessages(
            assistantEnded, JSONObject("""{"type":"tool_execution_end","entryId":"result-1","toolCallId":"call-1","toolName":"read","isError":true,"result":{"content":[{"type":"image","mimeType":"image/png","data":"aW1hZ2U="}],"details":{"reason":"decode failed"}}}"""),
        )
        val replayed = EventProjector.applyMessages(
            completed, JSONObject().put("type", "message_end").put("message", finalAssistant),
        )
        assertEquals(listOf("assistant-1", "result-1"), replayed.map { it.entryId })
        val final = replayed.single { it.role == "assistant" }
        assertEquals("Inspecting complete", final.text)
        assertFalse(final.streaming)
        assertEquals(1, (0 until final.content!!.length()).count { final.content.getJSONObject(it).optString("type") == "toolCall" })
        val result = replayed.single { it.role == "toolResult" }
        assertEquals("call-1", result.toolCallId)
        assertEquals("", result.text)
        assertTrue(result.isError)
        assertFalse(result.streaming)
        assertEquals("aW1hZ2U=", result.content!!.getJSONObject(0).getString("data"))
        assertEquals("decode failed", result.details!!.getString("reason"))
    }

    @Test
    fun toolStartBeforeAssistantReconcilesSynthesizedCallAndSnapshotResult() {
        val started = EventProjector.applyMessages(
            emptyList(), JSONObject("""{"type":"tool_execution_start","toolCallId":"call-2","toolName":"bash","args":{"command":"pwd"}}"""),
        )
        val call = started.single { it.role == "assistant" }.content!!.getJSONObject(0)
        assertEquals("call-2", call.getString("toolCallId"))
        assertEquals("pwd", call.getJSONObject("input").getString("command"))
        val completed = EventProjector.applyMessages(
            started, JSONObject("""{"type":"tool_execution_end","toolCallId":"call-2","toolName":"bash","result":{"content":[{"type":"text","text":"/project"}]}}"""),
        )
        val assistant = JSONObject("""{"role":"assistant","entryId":"assistant-2","content":[{"type":"toolCall","toolCallId":"call-2","toolName":"bash","input":{"command":"pwd"}}]}""")
        val reconciled = EventProjector.applyMessages(completed, JSONObject().put("type", "message_end").put("message", assistant))
        assertEquals(2, reconciled.size)
        assertEquals("assistant-2", reconciled.single { it.role == "assistant" }.entryId)
        assertEquals("/project", reconciled.single { it.role == "toolResult" }.text)
        val result = JSONObject("""{"role":"toolResult","entryId":"result-2","toolCallId":"call-2","toolName":"bash","content":[{"type":"text","text":"/project"}]}""")
        val ended = EventProjector.applyMessages(reconciled, JSONObject().put("type", "message_end").put("message", result))
        val snapshot = parseServerFrame(
            JSONObject().put("op", "session.snapshot").put("id", "session").put("messages", JSONArray().put(assistant).put(result)).toString(),
        ) as ServerFrame.Snapshot
        assertEquals(2, ended.size)
        for (restored in snapshot.messages) {
            val live = ended.single { it.entryId == restored.entryId }
            assertEquals(restored.role, live.role)
            assertEquals(restored.text, live.text)
            assertEquals(restored.toolCallId, live.toolCallId)
            assertEquals(restored.content.toString(), live.content.toString())
            assertFalse(live.streaming)
        }
    }

    @Test
    fun emptyToolEndRetainsImageErrorAndExplicitPreviewMetadata() {
        val partial = EventProjector.applyMessages(
            emptyList(),
            JSONObject("""{"type":"tool_execution_update","entryId":"image-result","toolCallId":"image-call","toolName":"read","isError":true,"partialResult":{"content":[{"type":"image","mimeType":"image/png","data":"aW1hZ2U="}],"details":{"reason":"partial decode"},"deferredImages":{"count":2},"truncated":true}}"""),
        )
        assertTrue(partial.single().streaming)
        val completed = EventProjector.applyMessages(
            partial, JSONObject("""{"type":"tool_execution_end","toolCallId":"image-call"}"""),
        ).single()
        assertFalse(completed.streaming)
        assertEquals("image-result", completed.entryId)
        assertEquals("image-call", completed.toolCallId)
        assertEquals("read", completed.toolName)
        assertEquals("", completed.text)
        assertTrue(completed.isError)
        assertTrue(completed.truncated)
        assertEquals(2, completed.deferredImages!!.getInt("count"))
        assertEquals("partial decode", completed.details!!.getString("reason"))
        val image = completed.content!!.getJSONObject(0)
        assertEquals("image", image.getString("type"))
        assertEquals("image/png", image.getString("mimeType"))
        assertEquals("aW1hZ2U=", image.getString("data"))
    }

    @Test
    fun runningFlagFollowsAgentLifecycle() {
        assertTrue(EventProjector.applyRunning(false, JSONObject("""{"type":"agent_start"}""")))
        assertTrue(EventProjector.applyRunning(true, JSONObject("""{"type":"agent_end","isTerminal":false}""")))
        assertFalse(EventProjector.applyRunning(true, JSONObject("""{"type":"agent_end"}""")))
        assertFalse(EventProjector.applyRunning(true, JSONObject("""{"type":"session_closed"}""")))
    }

    @Test
    fun terminalStopFiresOnlyWhenRunning() {
        assertTrue(
            EventProjector.isTerminalStop(true, JSONObject("""{"type":"agent_end"}""")),
        )
        assertTrue(
            EventProjector.isTerminalStop(true, JSONObject("""{"type":"session_closed"}""")),
        )
        // Non-terminal agent_end (streaming chunk done) is not a stop.
        assertFalse(
            EventProjector.isTerminalStop(true, JSONObject("""{"type":"agent_end","isTerminal":false}""")),
        )
        // Duplicate/late terminal events when nothing runs must not notify.
        assertFalse(
            EventProjector.isTerminalStop(false, JSONObject("""{"type":"agent_end"}""")),
        )
        assertFalse(
            EventProjector.isTerminalStop(false, JSONObject("""{"type":"session_closed"}""")),
        )
        assertFalse(
            EventProjector.isTerminalStop(true, JSONObject("""{"type":"agent_start"}""")),
        )
    }

    @Test
    fun userPromptAppearsOnlyOnDeliveryAndIdenticalSuccessivePromptsRemainDistinct() {
        val message = JSONObject().put("role", "user").put("text", "again")
        val start = JSONObject().put("type", "message_start").put("message", message)
        val end = JSONObject().put("type", "message_end").put("message", message)
        val started = EventProjector.applyMessages(emptyList(), start)
        assertEquals(emptyList<DisplayMessage>(), started)
        val delivered = EventProjector.applyMessages(started, end)
        assertEquals(listOf("again"), delivered.map { it.text })
        val second = EventProjector.applyMessages(EventProjector.applyMessages(delivered, start), end)
        assertEquals(listOf("again", "again"), second.map { it.text })
    }
}
