package com.dbchbin.ompgui.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ShellBackPolicyTest {
    private val local = "https://localhost"
    private val remote = "https://remote.example"

    @Test
    fun webUiConsumesBeforeHistoryOrExit() {
        assertEquals(
            ShellBackPolicy.Action.ConsumedByWebUi,
            ShellBackPolicy.decide(
                webUiConsumed = true,
                currentUrl = "$remote/?ompguiRemote=1",
                previousUrl = "$local/",
                configuredOrigin = remote,
                localOrigin = local,
            ),
        )
    }

    @Test
    fun inOriginHistoryGoesBackWithoutConfirm() {
        assertEquals(
            ShellBackPolicy.Action.WebHistoryBack,
            ShellBackPolicy.decide(
                webUiConsumed = false,
                currentUrl = "$remote/session/abc?ompguiRemote=1",
                previousUrl = "$remote/?ompguiRemote=1",
                configuredOrigin = remote,
                localOrigin = local,
            ),
        )
    }

    @Test
    fun leavingRemoteForBootstrapIsShellBoundary() {
        assertEquals(
            ShellBackPolicy.Action.ConfirmExit,
            ShellBackPolicy.decide(
                webUiConsumed = false,
                currentUrl = "$remote/?ompguiRemote=1",
                previousUrl = "$local/",
                configuredOrigin = remote,
                localOrigin = local,
            ),
        )
        assertFalse(
            ShellBackPolicy.staysOnSameSurface(
                "$remote/?ompguiRemote=1",
                "$local/",
                remote,
                local,
            ),
        )
    }

    @Test
    fun emptyHistoryConfirmsExit() {
        assertEquals(
            ShellBackPolicy.Action.ConfirmExit,
            ShellBackPolicy.decide(
                webUiConsumed = false,
                currentUrl = "$local/",
                previousUrl = null,
                configuredOrigin = remote,
                localOrigin = local,
            ),
        )
    }

    @Test
    fun localBootstrapHistoryStaysOnSurface() {
        assertTrue(
            ShellBackPolicy.staysOnSameSurface(
                "$local/?offline=1",
                "$local/",
                remote,
                local,
            ),
        )
    }

    @Test
    fun jsTrueParsesEvaluateJavascriptPayloads() {
        assertTrue(ShellBackPolicy.isJsTrue("true"))
        assertTrue(ShellBackPolicy.isJsTrue("\"true\""))
        assertFalse(ShellBackPolicy.isJsTrue("false"))
        assertFalse(ShellBackPolicy.isJsTrue(null))
    }
}
