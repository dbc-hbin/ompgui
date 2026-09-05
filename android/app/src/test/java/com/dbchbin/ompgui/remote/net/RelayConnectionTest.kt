package com.dbchbin.ompgui.remote.net

import com.dbchbin.ompgui.remote.relay.ClientFrame
import com.dbchbin.ompgui.remote.relay.ServerFrame
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RelayConnectionTest {
    @Test
    fun pairingHelloIsSentOnOpenBeforeOtherOps() {
        val fake = FakeTransport()
        val frames = mutableListOf<ServerFrame>()
        val states = mutableListOf<ConnectionState>()
        val conn = RelayConnection(transportFactory = { listener ->
            fake.listener = listener
            fake
        })
        conn.setListener(object : RelayConnection.Listener {
            override fun onState(state: ConnectionState) {
                states.add(state)
            }
            override fun onFrame(frame: ServerFrame) {
                frames.add(frame)
            }
            override fun onProtocolError(message: String) = Unit
        })

        conn.connectPairing(
            url = "wss://mac.example.ts.net/relay",
            secret = "c".repeat(43),
            label = "Pixel",
            password = null,
        )
        fake.listener?.onOpen()
        assertEquals(1, fake.sent.size)
        val hello = JSONObject(fake.sent[0])
        assertEquals("hello", hello.getString("op"))
        assertEquals("c".repeat(43), hello.getString("pairingSecret"))

        assertEquals(false, conn.send(ClientFrame.SessionsList))

        fake.listener?.onText(
            """{"op":"hello_ok","protocol":1,"serverId":"s_1","deviceId":"d_phone","token":"${"t".repeat(43)}"}""",
        )
        assertEquals(ConnectionState.Connected, conn.state)
        assertTrue(conn.send(ClientFrame.SessionsList))
        assertEquals("sessions.list", JSONObject(fake.sent.last()).getString("op"))
        assertTrue(frames.first() is ServerFrame.HelloOk)
    }

    @Test
    fun tokenDropSchedulesReconnect() {
        val fake = FakeTransport()
        val scheduled = mutableListOf<Runnable>()
        val conn = RelayConnection(
            transportFactory = { listener ->
                fake.listener = listener
                fake
            },
            schedule = { _, runnable -> scheduled.add(runnable) },
        )
        conn.connectToken(
            url = "wss://mac.example.ts.net/relay",
            deviceId = "d_abcdefghijklmnopqr",
            token = "b".repeat(43),
            label = "Pixel",
        )
        fake.listener?.onOpen()
        fake.listener?.onText(
            """{"op":"hello_ok","protocol":1,"serverId":"s_1","deviceId":"d_abcdefghijklmnopqr"}""",
        )
        fake.listener?.onClosed()
        assertEquals(1, scheduled.size)
        fake.sent.clear()
        scheduled.removeAt(0).run()
        fake.listener?.onOpen()
        assertEquals("hello", JSONObject(fake.sent[0]).getString("op"))
        assertEquals("d_abcdefghijklmnopqr", JSONObject(fake.sent[0]).getString("deviceId"))
    }
}

private class FakeTransport : RelayTransport {
    var listener: RelayTransportListener? = null
    val sent = mutableListOf<String>()

    override fun connect(url: String) = Unit

    override fun send(text: String): Boolean {
        sent.add(text)
        return true
    }

    override fun close() = Unit
}
