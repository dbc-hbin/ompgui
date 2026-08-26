package com.dbchbin.ompgui.remote

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.charset.StandardCharsets

class SnapshotSanitizerTest {
    @Test
    fun keepsLatestFiftyTextMessagesAndDropsUnknownFields() {
        val input = StringBuilder("{\"version\":1,\"origin\":\"https://example.com/path\",\"updatedAt\":\"now\",\"credentials\":\"secret\",\"session\":{\"id\":\"session-1\",\"toolPayload\":{\"secret\":true},\"messages\":[")
        repeat(60) { index ->
            if (index > 0) input.append(',')
            val role = if (index % 2 == 0) "user" else "assistant"
            input.append("{\"role\":\"").append(role)
                .append("\",\"text\":\"message-").append(index)
                .append("\",\"image\":\"blob\"}")
        }
        input.append("]}}")

        val safe = SnapshotSanitizer.sanitize(input.toString(), "https://example.com")
        assertNotNull(safe)
        requireNotNull(safe)
        assertTrue(safe.toByteArray(StandardCharsets.UTF_8).size <= SnapshotSanitizer.MAX_SNAPSHOT_BYTES)
        assertFalse(safe.contains("credentials"))
        assertFalse(safe.contains("toolPayload"))
        assertFalse(safe.contains("image"))

        val messages = JSONObject(safe).getJSONObject("session").getJSONArray("messages")
        assertTrue(messages.length() <= SnapshotSanitizer.MAX_MESSAGES)
        assertEquals("message-10", messages.getJSONObject(0).getString("text"))
        assertEquals("message-59", messages.getJSONObject(messages.length() - 1).getString("text"))
    }

    @Test
    fun rejectsOversizedRawSnapshot() {
        val huge = StringBuilder("{\"version\":1,\"origin\":\"https://example.com\",\"updatedAt\":\"now\",\"session\":{\"id\":\"id\",\"messages\":[],\"extra\":\"")
        while (huge.length <= SnapshotSanitizer.MAX_SNAPSHOT_BYTES) huge.append('x')
        huge.append("\"}}")
        assertNull(SnapshotSanitizer.sanitize(huge.toString(), "https://example.com"))
    }
}
