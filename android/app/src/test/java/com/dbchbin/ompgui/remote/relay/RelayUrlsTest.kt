package com.dbchbin.ompgui.remote.relay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RelayUrlsTest {
    @Test
    fun normalizesFunnelAndLoopbackRelayUrls() {
        assertEquals("wss://mac.tailnet.ts.net/relay", normalizeRelayUrl("mac.tailnet.ts.net"))
        assertEquals("wss://mac.tailnet.ts.net/relay", normalizeRelayUrl("https://mac.tailnet.ts.net/relay"))
        assertEquals("ws://127.0.0.1:30177/relay", normalizeRelayUrl("http://127.0.0.1:30177"))
        assertNull(normalizeRelayUrl("ws://example.com/relay"))
        assertNull(normalizeRelayUrl("wss://user:pass@host/relay"))
        assertNull(normalizeRelayUrl("wss://host/other"))
    }

    @Test
    fun treatsLoopbackHostsAsLocal() {
        assertTrue(isLoopbackHost("127.0.0.1"))
        assertTrue(isLoopbackHost("localhost"))
        assertTrue(isLoopbackHost("::1"))
        assertFalse(isLoopbackHost("example.ts.net"))
    }
}
