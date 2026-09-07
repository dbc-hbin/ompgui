package com.dbchbin.ompgui.remote.relay

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

class ChatRequestsTest {
    @Test fun messageActionsUseEveryPageAndOnlyVisibleTextBlocks() = runBlocking {
        val first = "a".repeat(200_000)
        val second = "Last block Ω"
        val message = JSONObject().put("content", JSONArray()
            .put(JSONObject().put("type", "text").put("text", first))
            .put(JSONObject().put("type", "thinking").put("thinking", "private reasoning"))
            .put(JSONObject().put("type", "image").put("data", "YWJj").put("mimeType", "image/png"))
            .put(JSONObject().put("type", "text").put("text", second)))
        val encoded = message.toString()
        val requester = RelayRequester { _, _, args ->
            val offset = args.getInt("offset")
            val end = minOf(offset + args.getInt("limit"), encoded.length)
            JSONObject().put("encoding", "json").put("text", encoded.substring(offset, end))
                .put("hasMore", end < encoded.length).put("nextOffset", end)
        }
        val complete = ChatRequests.fullEntry(requester, "session", "entry", "leaf")
        assertEquals("$first\n\n$second", ChatRequests.messageText(complete))
        assertEquals("YWJj", complete.getJSONArray("content").getJSONObject(2).getString("data"))
    }

    @Test fun brokenPagingFailsInsteadOfCopyingPartialMessage() = runBlocking {
        val requester = RelayRequester { _, _, _ ->
            JSONObject().put("encoding", "json").put("text", "{\"content\":")
                .put("hasMore", true).put("nextOffset", 0)
        }
        try {
            ChatRequests.fullEntry(requester, "session", "entry")
            fail("Incomplete content must not become an editable or copied message")
        } catch (_: IllegalStateException) { }
    }

    @Test fun stringContentRemainsCompleteForComposerPrefill() {
        val text = "  original input\n".repeat(15_000)
        assertEquals(text, ChatRequests.messageText(JSONObject().put("content", text)))
    }
}
