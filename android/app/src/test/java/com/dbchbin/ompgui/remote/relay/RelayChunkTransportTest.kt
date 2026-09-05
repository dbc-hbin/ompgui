package com.dbchbin.ompgui.remote.relay

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.Base64

class RelayChunkTransportTest {
    private fun chunk(id: String, index: Int, count: Int, bytes: ByteArray): String =
        JSONObject().put("op", "chunk").put("transfer", id).put("index", index)
            .put("count", count).put("data", Base64.getEncoder().encodeToString(bytes)).toString()

    private fun rejected(block: () -> Unit) {
        try {
            block()
            fail("Expected malformed transfer rejection")
        } catch (_: IllegalArgumentException) {
            // The transport rejects rather than delivering corrupt data.
        }
    }

    @Test fun exactWireBoundaryAndUnicodeSnapshotRoundTrip() {
        val prefix = "{\"op\":\"error\",\"code\":\"x\",\"message\":\""
        val suffix = "\"}"
        val atLimit = prefix + "a".repeat(RelayProtocol.MAX_FRAME_BYTES - prefix.length - suffix.length) + suffix
        val wires = mutableListOf<String>()
        assertTrue(sendRelayFrames(atLimit) { wires.add(it); true })
        assertEquals(listOf(atLimit), wires)
        wires.clear()
        val text = "한🙂".repeat(60_000)
        val snapshot = JSONObject().put("op", "session.snapshot").put("id", "session-1")
            .put("messages", org.json.JSONArray().put(JSONObject().put("role", "assistant").put("text", text)))
            .put("agent", JSONObject().put("running", false).put("ready", true)).toString()
        assertTrue(sendRelayFrames(snapshot) { wires.add(it); true })
        assertTrue(wires.size > 1)
        val assembler = RelayFrameAssembler()
        var result: ServerFrame? = null
        wires.forEachIndexed { index, wire ->
            val json = JSONObject(wire)
            assertEquals("chunk", json.getString("op"))
            assertEquals(index, json.getInt("index"))
            assertEquals(wires.size, json.getInt("count"))
            assertTrue(Base64.getDecoder().decode(json.getString("data")).size <= RelayProtocol.MAX_CHUNK_BYTES)
            assertTrue(wire.toByteArray().size <= RelayProtocol.MAX_FRAME_BYTES)
            result = assembler.receive(wire)
            if (index != wires.lastIndex) assertNull(result)
        }
        assertEquals(text, (result as ServerFrame.Snapshot).messages.single().text)
    }

    @Test fun rejectsOrderingCountDriftAndNoncanonicalBase64() {
        val first = chunk("a", 0, 2, byteArrayOf(123))
        val assembler = RelayFrameAssembler()
        assertNull(assembler.receive(first))
        rejected { assembler.receive(first) }
        assertNull(assembler.receive(first))
        rejected { assembler.receive(chunk("a", 1, 3, byteArrayOf(125))) }
        rejected { assembler.receive(chunk("unknown", 1, 2, byteArrayOf(125))) }
        for (data in listOf("e30", "e30=\n", "e31=", "____")) {
            rejected { assembler.receive(JSONObject(chunk("a", 0, 1, byteArrayOf(123))).put("data", data).toString()) }
        }
        rejected { assembler.receive(chunk("a", 0, 343, byteArrayOf(123))) }
        rejected { assembler.receive(chunk("a", 0, 1, ByteArray(RelayProtocol.MAX_CHUNK_BYTES + 1))) }
    }

    @Test fun fixedDeadlineDoesNotSlideAndClearDiscardsPartials() {
        var time = 0L
        val assembler = RelayFrameAssembler { time }
        assertNull(assembler.receive(chunk("a", 0, 3, byteArrayOf(123))))
        time = 29_999
        assertNull(assembler.receive(chunk("a", 1, 3, byteArrayOf(32))))
        time = 30_000
        rejected { assembler.receive(chunk("a", 2, 3, byteArrayOf(125))) }
        assertNull(assembler.receive(chunk("b", 0, 2, byteArrayOf(123))))
        assembler.clear()
        rejected { assembler.receive(chunk("b", 1, 2, byteArrayOf(125))) }
    }

    @Test fun rejectsNestedChunksInvalidUtf8AndTransferLimit() {
        val assembler = RelayFrameAssembler()
        rejected { assembler.receive(chunk("a", 0, 1, chunk("b", 0, 1, byteArrayOf(123)).toByteArray())) }
        rejected { assembler.receive(chunk("a", 0, 1, byteArrayOf(0xc3.toByte(), 0x28))) }
        repeat(4) { assertNull(assembler.receive(chunk("t$it", 0, 2, byteArrayOf(123)))) }
        rejected { assembler.receive(chunk("fifth", 0, 2, byteArrayOf(123))) }
    }

    @Test fun globalBufferCannotExceedLogicalLimitAcrossTransfers() {
        val assembler = RelayFrameAssembler()
        val full = ByteArray(RelayProtocol.MAX_CHUNK_BYTES) { 32 }
        repeat(341) { index -> assertNull(assembler.receive(chunk("large", index, 342, full))) }
        assertNull(assembler.receive(chunk("other", 0, 2, ByteArray(16 * 1024) { 32 })))
        rejected { assembler.receive(chunk("third", 0, 2, byteArrayOf(32))) }
        rejected { sendRelayFrames("x".repeat(RelayProtocol.MAX_LOGICAL_BYTES + 1)) { fail("Must not send oversized logical frame"); true } }
    }

    @Test fun resultEnvelopeRejectsCoercionsAndContradictoryBranches() {
        val request = JSONObject(ClientFrame.Request(7, "files", "list", JSONObject()).encode())
        assertEquals("request", request.getString("op"))
        assertEquals(7, request.getInt("req"))
        assertTrue(parseServerFrame("""{"op":"result","req":7,"success":true,"data":{}}""") is ServerFrame.Result)
        assertTrue(parseServerFrame("""{"op":"result","req":7,"success":false,"error":{"code":"conflict","message":"changed"}}""") is ServerFrame.Result)
        for (raw in listOf(
            """{"op":"result","req":"7","success":true,"data":{}}""",
            """{"op":"result","req":7.5,"success":true,"data":{}}""",
            """{"op":"result","req":0,"success":true,"data":{}}""",
            """{"op":"result","req":7,"success":"true","data":{}}""",
            """{"op":"result","req":7,"success":true,"data":{},"error":null}""",
            """{"op":"result","req":7,"success":false,"error":{"code":3,"message":"bad"}}""",
        )) assertNull(parseServerFrame(raw))
    }
}
