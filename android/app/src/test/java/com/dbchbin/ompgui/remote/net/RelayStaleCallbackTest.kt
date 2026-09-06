package com.dbchbin.ompgui.remote.net

import com.dbchbin.ompgui.remote.relay.ServerFrame
import org.junit.Assert.*
import org.junit.Test

class RelayStaleCallbackTest {
    private class Transport(val callback: RelayTransportListener) : RelayTransport {
        val sent = mutableListOf<String>()
        var closed = false
        override fun connect(url: String) = Unit
        override fun send(text: String): Boolean {
            if (closed) return false
            sent.add(text)
            return true
        }
        override fun close() { closed = true }
    }

    @Test fun helloErrorListenerCanReplacePairingWithSavedTokenConnection() {
        val transports = mutableListOf<Transport>()
        val scheduled = mutableListOf<Runnable>()
        val frames = mutableListOf<ServerFrame>()
        val connection = RelayConnection(
            transportFactory = { Transport(it).also(transports::add) },
            schedule = { _, task -> scheduled.add(task) },
        )
        connection.setListener(object : RelayConnection.Listener {
            override fun onState(state: ConnectionState) = Unit
            override fun onFrame(frame: ServerFrame) {
                frames.add(frame)
                if (frame is ServerFrame.HelloErr) {
                    connection.connectToken("wss://example.com/relay", "d_abcdefghijklmnop", "b".repeat(43), null)
                }
            }
            override fun onProtocolError(message: String) = Unit
        })
        connection.connectPairing("wss://example.com/relay", "a".repeat(43), null, null)
        val pairing = transports.single()
        pairing.callback.onOpen()
        pairing.callback.onText("""{"op":"hello_err","code":"unauthorized","message":"Pairing expired"}""")
        val replacement = transports.last()
        assertNotSame(pairing, replacement)
        assertFalse(replacement.closed)
        assertEquals(ConnectionState.Connecting, connection.state)
        assertTrue(scheduled.isEmpty())
        pairing.callback.onClosed()
        replacement.callback.onOpen()
        assertEquals("b".repeat(43), org.json.JSONObject(replacement.sent.single()).getString("token"))
        replacement.callback.onText("""{"op":"hello_ok","protocol":1,"serverId":"s","deviceId":"d_abcdefghijklmnop"}""")
        assertEquals(ConnectionState.Connected, connection.state)
        assertTrue(frames.last() is ServerFrame.HelloOk)
        replacement.callback.onClosed()
        assertEquals(1, scheduled.size)
        scheduled.single().run()
        val reconnected = transports.last()
        reconnected.callback.onOpen()
        assertEquals("b".repeat(43), org.json.JSONObject(reconnected.sent.single()).getString("token"))
    }

    @Test fun closedTransportCannotDeliverDuringReconnectWaitOrAfterReplacement() {
        val transports = mutableListOf<Transport>()
        val scheduled = mutableListOf<Runnable>()
        val frames = mutableListOf<ServerFrame>()
        val connection = RelayConnection(
            transportFactory = { Transport(it).also(transports::add) },
            schedule = { _, task -> scheduled.add(task) },
        )
        connection.setListener(object : RelayConnection.Listener {
            override fun onState(state: ConnectionState) = Unit
            override fun onFrame(frame: ServerFrame) { frames.add(frame) }
            override fun onProtocolError(message: String) = Unit
        })
        connection.connectToken("wss://example.com/relay", "d_abcdefghijklmnop", "a".repeat(43), null)
        val old = transports.single()
        old.callback.onOpen()
        old.callback.onText("""{"op":"hello_ok","protocol":1,"serverId":"s","deviceId":"d_abcdefghijklmnop"}""")
        frames.clear()
        old.callback.onClosed()
        old.callback.onText("""{"op":"result","req":1,"success":true,"data":{}}""")
        old.callback.onOpen()
        old.callback.onFailure("late duplicate")
        assertTrue(frames.isEmpty())
        assertEquals(1, scheduled.size)
        assertEquals(1, old.sent.size)
        scheduled.single().run()
        old.callback.onText("""{"op":"error","code":"late","message":"late"}""")
        assertTrue(frames.isEmpty())
        assertEquals(2, transports.size)
        transports.last().callback.onOpen()
        assertEquals(1, transports.last().sent.size)
    }

    @Test fun queuedFramesAreInvalidatedAtCloseCallbackBeforeMainDispatch() {
        val queue = mutableListOf<Runnable>()
        lateinit var transport: Transport
        val frames = mutableListOf<ServerFrame>()
        val connection = RelayConnection(
            transportFactory = { Transport(it).also { value -> transport = value } },
            mainHandler = { queue.add(it) },
            schedule = { _, _ -> },
        )
        connection.setListener(object : RelayConnection.Listener {
            override fun onState(state: ConnectionState) = Unit
            override fun onFrame(frame: ServerFrame) { frames.add(frame) }
            override fun onProtocolError(message: String) = Unit
        })
        connection.connectPairing("wss://example.com/relay", "a".repeat(43), null, null)
        transport.callback.onText("""{"op":"hello_ok","protocol":1,"serverId":"s","deviceId":"d_phone"}""")
        transport.callback.onClosed()
        queue.toList().forEach { it.run() }
        assertTrue(frames.isEmpty())
        assertEquals(ConnectionState.Failed, connection.state)
    }
}
