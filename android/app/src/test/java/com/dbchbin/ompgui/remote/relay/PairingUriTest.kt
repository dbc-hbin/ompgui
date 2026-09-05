package com.dbchbin.ompgui.remote.relay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

class PairingUriTest {
    @Test
    fun parsesFragmentPairingUri() {
        val url = URLEncoder.encode("wss://mac.example.ts.net/relay", StandardCharsets.UTF_8.name())
        val uri = "ompgui://pair#v=1&url=$url&sid=s_abcDEF1234567890&secret=sekritvalue_0123456789abcdefghijk"
        val parsed = parsePairingUri(uri)
        assertEquals(
            PairingOffer(
                url = "wss://mac.example.ts.net/relay",
                serverId = "s_abcDEF1234567890",
                secret = "sekritvalue_0123456789abcdefghijk",
            ),
            parsed,
        )
    }

    @Test
    fun rejectsForeignSchemesAndQuerySecrets() {
        assertNull(
            parsePairingUri(
                "https://pair#v=1&url=wss://mac.example.ts.net/relay&sid=s_abcDEF1234567890&secret=sekritvalue_0123456789abcdefghijk",
            ),
        )
        assertNull(
            parsePairingUri(
                "ompgui://pair?v=1&url=wss://mac.example.ts.net/relay&sid=s_abcDEF1234567890&secret=sekritvalue_0123456789abcdefghijk",
            ),
        )
    }

    @Test
    fun scannerAcceptsValidPairCodeWithWhitespace() {
        // QR payloads may carry stray whitespace; the scanner gates on this parse.
        val url = URLEncoder.encode("wss://mac.example.ts.net/relay", StandardCharsets.UTF_8.name())
        val uri = "  ompgui://pair#v=1&url=$url&sid=s_abc&secret=topsecret123  "
        val parsed = parsePairingUri(uri)
        assertEquals(
            PairingOffer(
                url = "wss://mac.example.ts.net/relay",
                serverId = "s_abc",
                secret = "topsecret123",
            ),
            parsed,
        )
    }

    @Test
    fun scannerRejectsNonPairingQrPayloads() {
        assertNull(parsePairingUri("https://example.com/not-a-pairing-code"))
        assertNull(parsePairingUri("ompgui://pair#v=1&url=&sid=&secret="))
        assertNull(
            parsePairingUri(
                "ompgui://pair#v=1&url=wss://mac.example.ts.net/relay&sid=bad sid&secret=topsecret123",
            ),
        )
    }
}
