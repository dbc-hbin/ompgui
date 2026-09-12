package com.dbchbin.ompgui.remote.relay

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
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

    @Test fun liveHistoryPagesAreBoundedOnlineAndVisibleOnlyBeforeOffset() {
        val range = ChatRequests.previousLivePage(73)!!
        assertEquals(23, range.first)
        assertEquals(50, range.count())
        val args = ChatRequests.liveHistoryArgs("session", "leaf", range.first, range.count())
        assertTrue(args.getBoolean("online"))
        assertEquals(50, args.getInt("limit"))
        assertEquals(50, ChatRequests.historyArgs("session").getInt("limit"))
        try {
            ChatRequests.historyArgs("session", limit = 51)
            fail("History requests must remain bounded to 50 entries")
        } catch (_: IllegalArgumentException) { }
        assertTrue(ChatRequests.shouldShowLiveHistoryLoader(1))
        assertFalse(ChatRequests.shouldShowLiveHistoryLoader(0))
    }

    @Test fun earlierMessagesUseEntryIdsForDeduplicationAndRejectStaleOwnership() {
        val page = ChatRequests.parseHistoryPage(JSONObject()
            .put("messages", JSONArray()
                .put(JSONObject().put("role", "user").put("text", "first"))
                .put(JSONObject().put("role", "assistant").put("text", "duplicate")))
            .put("entryIds", JSONArray().put("entry-1").put("entry-2"))
            .put("offset", 0))
        val current = listOf(DisplayMessage(role = "assistant", text = "current", entryId = "entry-2"))
        assertEquals(
            listOf("entry-1", "entry-2"),
            ChatRequests.prependEarlierMessages(current, ChatRequests.liveHistoryMessages(page)).map { it.entryId },
        )
        assertTrue(ChatRequests.isCurrentLiveHistoryRequest(4, 4, "session", "session", "leaf", "leaf", "leaf"))
        assertFalse(ChatRequests.isCurrentLiveHistoryRequest(4, 5, "session", "session", "leaf", "leaf", "leaf"))
        assertFalse(ChatRequests.isCurrentLiveHistoryRequest(4, 4, "session", "other", "leaf", "leaf", "leaf"))
        assertFalse(ChatRequests.isCurrentLiveHistoryRequest(4, 4, "session", "session", "leaf", "other", "leaf"))
        assertFalse(ChatRequests.isCurrentLiveHistoryRequest(4, 4, "session", "session", "leaf", "leaf", "other"))
    }
}
