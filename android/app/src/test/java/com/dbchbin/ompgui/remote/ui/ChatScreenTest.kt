package com.dbchbin.ompgui.remote.ui

import com.dbchbin.ompgui.remote.relay.DisplayMessage
import org.junit.Assert.assertEquals
import org.junit.Test

class ChatScreenTest {
    @Test
    fun turnKeyUsesStableEntryIdentityAcrossPrepend() {
        val turn = listOf(
            DisplayMessage(role = "assistant", text = "working", entryId = "entry-41"),
            DisplayMessage(role = "assistant", text = "done", entryId = "entry-42"),
        )

        assertEquals("entry:entry-42", transcriptTurnKey(turn))
        assertEquals("entry:entry-42", transcriptTurnKey((listOf(
            DisplayMessage(role = "user", text = "earlier", entryId = "entry-1"),
        ) + turn).takeLast(turn.size)))
    }

    @Test
    fun loadedPageBoundaryKeepsConsecutiveAssistantTurnsSeparate() {
        val messages = listOf(
            DisplayMessage(role = "assistant", text = "earlier 1", entryId = "entry-1"),
            DisplayMessage(role = "assistant", text = "earlier 2", entryId = "entry-2"),
            DisplayMessage(role = "assistant", text = "visible 1", entryId = "entry-3"),
            DisplayMessage(role = "assistant", text = "visible 2", entryId = "entry-4"),
        )

        val turns = groupTranscriptMessages(messages, emptySet(), setOf("entry-3"))

        assertEquals(listOf(listOf("entry-1", "entry-2"), listOf("entry-3", "entry-4")),
            turns.map { turn -> turn.map(DisplayMessage::entryId) })
        assertEquals("entry:entry-4", transcriptTurnKey(turns.last()))
    }
}
