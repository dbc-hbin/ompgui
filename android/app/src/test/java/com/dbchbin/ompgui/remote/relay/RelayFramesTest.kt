package com.dbchbin.ompgui.remote.relay

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RelayFramesTest {
    @Test
    fun encodesPairingHelloWithoutNullFields() {
        val encoded = ClientFrame.Hello(
            pairingSecret = "c".repeat(43),
            label = "Pixel",
        ).encode()
        val json = JSONObject(encoded)
        assertEquals("hello", json.getString("op"))
        assertEquals(1, json.getInt("protocol"))
        assertEquals("c".repeat(43), json.getString("pairingSecret"))
        assertEquals("Pixel", json.getString("label"))
        assertFalse(json.has("deviceId"))
        assertFalse(json.has("images"))
    }

    @Test
    fun encodesDeviceHello() {
        val encoded = ClientFrame.Hello(
            deviceId = "d_abcdefghijklmnopqr",
            token = "b".repeat(43),
        ).encode()
        val json = JSONObject(encoded)
        assertEquals("d_abcdefghijklmnopqr", json.getString("deviceId"))
        assertEquals("b".repeat(43), json.getString("token"))
        assertFalse(json.has("pairingSecret"))
    }

    @Test
    fun encodesPromptWithoutImages() {
        val encoded = ClientFrame.Cmd(req = 7, type = "prompt", message = "hi").encode()
        val json = JSONObject(encoded)
        assertEquals("cmd", json.getString("op"))
        assertEquals("prompt", json.getString("type"))
        assertEquals("hi", json.getString("message"))
        assertFalse(json.has("images"))
    }

    @Test
    fun parsesHelloOkSessionsAndSnapshot() {
        val hello = parseServerFrame(
            """{"op":"hello_ok","protocol":1,"serverId":"s_1","deviceId":"d_phone","token":"new-token-value-0123456789abcdefghijk"}""",
        ) as ServerFrame.HelloOk
        assertEquals("s_1", hello.serverId)
        assertEquals("d_phone", hello.deviceId)
        assertEquals("new-token-value-0123456789abcdefghijk", hello.token)

        val sessions = parseServerFrame(
            """{"op":"sessions","sessions":[{"id":"sess-1","cwd":"/tmp","firstMessage":"hi"}],"runningIds":["sess-1"]}""",
        ) as ServerFrame.Sessions
        assertEquals("sess-1", sessions.sessions[0].id)
        assertEquals(listOf("sess-1"), sessions.runningIds)

        val snapshot = parseServerFrame(
            """{"op":"session.snapshot","id":"sess-1","title":"Demo","messages":[{"role":"user","text":"hi"},{"role":"tool","text":"nope"}],"agent":{"running":false,"ready":true}}""",
        ) as ServerFrame.Snapshot
        assertEquals("Demo", snapshot.title)
        assertEquals(1, snapshot.messages.size)
        assertEquals("user", snapshot.messages[0].role)
        assertTrue(snapshot.agent.ready)
    }

    @Test
    fun rejectsUnknownOpsAndOversize() {
        assertNull(parseServerFrame("""{"op":"explode"}"""))
        assertNull(parseServerFrame("{"))
        assertNotNull(parseServerFrame("""{"op":"error","code":"x","message":"y"}"""))
    }

    @Test
    fun encodesModelsListWithoutFields() {
        val json = JSONObject(ClientFrame.ModelsList.encode())
        assertEquals("models.list", json.getString("op"))
        assertEquals(1, json.length())
    }

    @Test
    fun parsesModelsListSkippingBadEntries() {
        val frame = parseServerFrame(
            """{"op":"models","models":[{"provider":"openai","id":"gpt-5","name":"GPT-5"},{"provider":"anthropic","id":"sonnet"},{"provider":"","id":"x"},{"id":"y"}]}""",
        ) as ServerFrame.Models
        assertEquals(2, frame.models.size)
        assertEquals("GPT-5", frame.models[0].name)
        // name falls back to id when the Mac omits it
        assertEquals("sonnet", frame.models[1].name)
    }

    @Test
    fun parsesSnapshotModelFromAgentState() {
        val frame = parseServerFrame(
            """{"op":"session.snapshot","id":"sess-1","messages":[],"agent":{"running":false,"ready":true,"state":{"model":{"provider":"openai","id":"gpt-5","name":"GPT-5"}}}}""",
        ) as ServerFrame.Snapshot
        assertEquals("openai", frame.agent.model?.provider)
        assertEquals("gpt-5", frame.agent.model?.id)
        assertEquals("GPT-5", frame.agent.model?.displayName())

        val bare = parseServerFrame(
            """{"op":"session.snapshot","id":"sess-1","messages":[],"agent":{"running":false,"ready":true}}""",
        ) as ServerFrame.Snapshot
        assertNull(bare.agent.model)
    }

    @Test
    fun parsesCmdOkDataModel() {
        val getState = parseServerFrame(
            """{"op":"cmd_ok","req":3,"data":{"model":{"provider":"openai","id":"gpt-5"},"thinkingLevel":"off"}}""",
        ) as ServerFrame.CmdOk
        assertEquals("gpt-5", getState.model()?.id)

        val setModel = parseServerFrame(
            """{"op":"cmd_ok","req":4,"data":{"provider":"anthropic","id":"sonnet"}}""",
        ) as ServerFrame.CmdOk
        assertEquals("anthropic", setModel.model()?.provider)

        val empty = parseServerFrame("""{"op":"cmd_ok","req":5}""") as ServerFrame.CmdOk
        assertNull(empty.model())
    }

    @Test
    fun parseModelRefAcceptsModelIdKey() {
        val ref = parseModelRef(JSONObject("""{"provider":"openai","modelId":"gpt-5"}"""))
        assertEquals("gpt-5", ref?.id)
        assertNull(parseModelRef(JSONObject("""{"running":true}""")))
    }
}
