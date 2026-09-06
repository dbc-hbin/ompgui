package com.dbchbin.ompgui.remote.relay

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingPolicyTest {
    @Test
    fun ignoresPairingUriOnceAlreadyPaired() {
        assertTrue(PairingPolicy.shouldIgnoreStalePairing(alreadyPaired = true))
        assertFalse(PairingPolicy.shouldIgnoreStalePairing(alreadyPaired = false))
    }

    @Test
    fun stalePairingFailureKeepsSavedDevice() {
        assertFalse(
            PairingPolicy.shouldClearCredentials(
                code = "pairing_expired",
                hasSavedDevice = true,
                pairingAttempt = true,
            ),
        )
        assertFalse(
            PairingPolicy.shouldClearCredentials(
                code = "unauthorized",
                hasSavedDevice = true,
                pairingAttempt = true,
            ),
        )
        assertTrue(
            PairingPolicy.shouldReconnectWithSavedDevice(
                code = "pairing_expired",
                hasSavedDevice = true,
                pairingAttempt = true,
            ),
        )
    }

    @Test
    fun tokenUnauthorizedStillClearsDevice() {
        assertTrue(
            PairingPolicy.shouldClearCredentials(
                code = "unauthorized",
                hasSavedDevice = true,
                pairingAttempt = false,
            ),
        )
        assertFalse(
            PairingPolicy.shouldReconnectWithSavedDevice(
                code = "unauthorized",
                hasSavedDevice = true,
                pairingAttempt = false,
            ),
        )
    }

    @Test
    fun firstPairExpiryClearsNothingUsefulAndDoesNotReconnect() {
        assertTrue(
            PairingPolicy.shouldClearCredentials(
                code = "pairing_expired",
                hasSavedDevice = false,
                pairingAttempt = true,
            ),
        )
        assertFalse(
            PairingPolicy.shouldReconnectWithSavedDevice(
                code = "pairing_expired",
                hasSavedDevice = false,
                pairingAttempt = true,
            ),
        )
    }

    @Test
    fun deviceLimitNeverClearsCredentials() {
        assertFalse(
            PairingPolicy.shouldClearCredentials(
                code = "device_limit",
                hasSavedDevice = true,
                pairingAttempt = true,
            ),
        )
        assertTrue(PairingPolicy.shouldStopReconnect("device_limit"))
        assertTrue(
            PairingPolicy.shouldReconnectWithSavedDevice(
                code = "device_limit",
                hasSavedDevice = true,
                pairingAttempt = true,
            ),
        )
    }
}
