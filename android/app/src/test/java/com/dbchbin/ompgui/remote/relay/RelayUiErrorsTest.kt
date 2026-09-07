package com.dbchbin.ompgui.remote.relay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RelayUiErrorsTest {
    @Test
    fun staleGenerationIsIgnoredWhileSameGenerationSurfaces() {
        assertTrue(RelayUiErrors.isCurrentGeneration(3, 3))
        assertFalse(RelayUiErrors.isCurrentGeneration(3, 4))
    }

    @Test
    fun reconnectClearsOnlyConnectionClassBanners() {
        assertTrue(RelayUiErrors.shouldClearOnConnected(RelayUiErrorKind.Connection, null))
        assertTrue(RelayUiErrors.shouldClearOnConnected(RelayUiErrorKind.Request, "disconnected"))
        assertTrue(RelayUiErrors.shouldClearOnConnected(RelayUiErrorKind.Request, "send_failed"))
        assertFalse(RelayUiErrors.shouldClearOnConnected(RelayUiErrorKind.Request, "access_denied"))
        assertFalse(RelayUiErrors.shouldClearOnConnected(RelayUiErrorKind.Request, "request_failed"))
        assertFalse(RelayUiErrors.shouldClearOnConnected(RelayUiErrorKind.Session, "disconnected"))
        assertFalse(RelayUiErrors.shouldClearOnConnected(RelayUiErrorKind.Command, null))
        assertEquals(
            setOf(RelayUiErrorKind.Request, RelayUiErrorKind.Command),
            RelayUiErrors.clearKindsOnLeaveChat(),
        )
    }
}
