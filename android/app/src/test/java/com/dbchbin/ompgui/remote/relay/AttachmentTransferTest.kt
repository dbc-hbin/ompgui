package com.dbchbin.ompgui.remote.relay

import java.io.ByteArrayInputStream
import java.io.InputStream
import java.util.Base64
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AttachmentTransferTest {
    @Test fun tenMiBImageStreamsIntactWithBoundedReadsAndChunks() = runBlocking {
        val size = AttachmentTransfer.MAX_IMAGE_BYTES
        var readOffset = 0
        var received = 0
        var closed = false
        var completed = false
        val source = AttachmentSource("image/png", size.toLong()) {
            object : InputStream() {
                override fun read(): Int = if (readOffset == size) -1 else (readOffset++ % 251)
                override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                    assertTrue(length <= 65536)
                    val count = minOf(length, size - readOffset)
                    if (count == 0) return -1
                    repeat(count) { buffer[offset + it] = (readOffset++ % 251).toByte() }
                    return count
                }
                override fun close() { closed = true }
            }
        }
        val id = AttachmentTransfer.stage(source, { action, args ->
            when (action) {
                "attachments.begin" -> JSONObject().put("attachmentId", "image-1").put("maxChunkBytes", 65536)
                "attachments.chunk" -> {
                    assertEquals(received.toLong(), args.getLong("offset"))
                    val bytes = Base64.getDecoder().decode(args.getString("data"))
                    assertTrue(bytes.size <= 65536)
                    for (byte in bytes) assertEquals((received++ % 251).toByte(), byte)
                    JSONObject().put("nextOffset", received)
                }
                "attachments.complete" -> {
                    assertEquals(size, received)
                    completed = true
                    JSONObject().put("attachmentId", "image-1")
                }
                else -> error("Unexpected request")
            }
        }, {}, {})
        assertEquals("image-1", id)
        assertTrue(completed)
        assertTrue(closed)
    }

    @Test fun oversizedSourceIsRejectedBeforeOpeningOrStaging() = runBlocking {
        try {
            AttachmentTransfer.stage(AttachmentSource("image/png", AttachmentTransfer.MAX_IMAGE_BYTES + 1L) {
                error("Oversized source must not be opened")
            }, { _, _ -> error("Oversized source must not be staged") }, {}, {})
            fail("Expected image limit rejection")
        } catch (_: IllegalArgumentException) { }
    }

    @Test fun changedSessionDoesNotCompleteUploadedSource() = runBlocking {
        var current = true
        var completed = false
        var registered: String? = null
        try {
            AttachmentTransfer.stage(AttachmentSource("image/png", 1) { ByteArrayInputStream(byteArrayOf(42)) }, { action, _ ->
                when (action) {
                    "attachments.begin" -> JSONObject().put("attachmentId", "staged").put("maxChunkBytes", 65536)
                    "attachments.chunk" -> { current = false; JSONObject().put("nextOffset", 1) }
                    else -> { completed = true; JSONObject().put("attachmentId", "staged") }
                }
            }, { check(current) { "Session changed" } }, { registered = it })
            fail("Expected same-session rejection")
        } catch (_: IllegalStateException) { }
        assertFalse(completed)
        assertEquals("staged", registered) // Caller can abort even on rejection.
    }

    @Test fun growingSourceIsNotSilentlyClippedOrCompleted() = runBlocking {
        try {
            AttachmentTransfer.stage(AttachmentSource("image/png", 1) { ByteArrayInputStream(byteArrayOf(1, 2)) }, { action, _ ->
                when (action) {
                    "attachments.begin" -> JSONObject().put("attachmentId", "staged").put("maxChunkBytes", 65536)
                    "attachments.chunk" -> JSONObject().put("nextOffset", 1)
                    else -> error("Changed-size image must not complete")
                }
            }, {}, {})
            fail("Expected changed-size rejection")
        } catch (_: IllegalArgumentException) { }
    }

    @Test fun tenUnicodeTextAttachmentsRemainIntactInPromptFrame() {
        val text = "한".repeat(AttachmentTransfer.MAX_TEXT_BYTES / 3) + "x"
        assertEquals(AttachmentTransfer.MAX_TEXT_BYTES, text.toByteArray(Charsets.UTF_8).size)
        val composed = List(10) { "--- file: $it ---\n$text\n--- end file ---" }.joinToString("\n\n")
        val encoded = ClientFrame.Cmd(1, "prompt", message = composed).encode()
        assertEquals(composed, JSONObject(encoded).getString("message"))
        try {
            ClientFrame.Cmd(2, "prompt", message = "x".repeat(RelayProtocol.MAX_PROMPT_CHARS + 1)).encode()
            fail("Oversized prompt must fail rather than clip")
        } catch (_: IllegalArgumentException) { }
    }
}
