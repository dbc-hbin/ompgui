package com.dbchbin.ompgui.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OriginValidatorTest {
    @Test
    fun normalizesSecureOriginAndDropsPath() {
        assertEquals("https://example.com", OriginValidator.normalize("  HTTPS://Example.com:443/path?q=1#fragment "))
        assertEquals("https://example.com:8443", OriginValidator.normalize("example.com:8443/app"))
    }

    @Test
    fun allowsOnlyLoopbackHttpDevelopmentOrigins() {
        assertEquals("http://localhost:30178", OriginValidator.normalize("http://localhost:30178/app"))
        assertEquals("http://127.0.0.1:8080", OriginValidator.normalize("http://127.0.0.1:8080"))
        assertEquals("http://[::1]:8080", OriginValidator.normalize("http://[::1]:8080"))
        assertNull(OriginValidator.normalize("http://example.com"))
    }

    @Test
    fun rejectsUnsafeSchemesAndCredentials() {
        assertNull(OriginValidator.normalize("file:///data/local"))
        assertNull(OriginValidator.normalize("javascript:alert(1)"))
        assertNull(OriginValidator.normalize("https://user:password@example.com"))
        assertNull(OriginValidator.normalize("https://example.com:"))
    }
}
