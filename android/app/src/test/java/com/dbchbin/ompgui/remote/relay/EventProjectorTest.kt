package com.dbchbin.ompgui.remote.relay

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EventProjectorTest {
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
    fun mergeSnapshotKeepsOptimisticUserWhilePromptInFlight() {
        val current = listOf(DisplayMessage(role = "user", text = "hello"))
        val snapshot = listOf(DisplayMessage(role = "assistant", text = "old"))
        val merged = EventProjector.mergeSnapshotMessages(current, snapshot, promptInFlight = true)
        assertEquals(2, merged.size)
        assertEquals("hello", merged.last().text)
    }

    @Test
    fun mergeSnapshotReplacesWhenPromptNotInFlight() {
        val current = listOf(DisplayMessage(role = "user", text = "hello"))
        val snapshot = listOf(DisplayMessage(role = "user", text = "from server"))
        val merged = EventProjector.mergeSnapshotMessages(current, snapshot, promptInFlight = false)
        assertEquals(1, merged.size)
        assertEquals("from server", merged[0].text)
    }
}
