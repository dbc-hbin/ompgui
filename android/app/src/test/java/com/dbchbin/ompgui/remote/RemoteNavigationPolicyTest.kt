package com.dbchbin.ompgui.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteNavigationPolicyTest {
    private val local = "https://localhost"
    private val remote = "https://remote.example"

    @Test
    fun permitsLocalBootstrapAndConfiguredOriginOnly() {
        assertTrue(
            RemoteNavigationPolicy.isPermittedDocument(
                local,
                remote,
                "$local/?offline=1",
            ),
        )
        assertTrue(
            RemoteNavigationPolicy.isPermittedDocument(
                local,
                remote,
                "$remote/?ompguiRemote=1",
            ),
        )
        assertFalse(
            RemoteNavigationPolicy.isPermittedDocument(
                local,
                remote,
                "about:blank",
            ),
        )
        assertFalse(
            RemoteNavigationPolicy.isPermittedDocument(
                local,
                remote,
                "https://www.google.com/search?q=hello",
            ),
        )
    }

    @Test
    fun disallowedPageLeavesRestoreNotOffline() {
        assertEquals(
            RemoteNavigationPolicy.LoadFailureAction.RestorePrevious,
            RemoteNavigationPolicy.onDisallowedDocumentStarted(),
        )
    }

    @Test
    fun entryPathFailureShowsOffline() {
        assertEquals(
            RemoteNavigationPolicy.LoadFailureAction.ShowOffline,
            RemoteNavigationPolicy.onMainFrameFailure(remote, "$remote/?ompguiRemote=1"),
        )
        assertEquals(
            RemoteNavigationPolicy.LoadFailureAction.ShowOffline,
            RemoteNavigationPolicy.onMainFrameFailure(remote, "$remote/"),
        )
    }

    @Test
    fun straySameOriginPathFailureRestoresPrevious() {
        assertEquals(
            RemoteNavigationPolicy.LoadFailureAction.RestorePrevious,
            RemoteNavigationPolicy.onMainFrameFailure(remote, "$remote/hello"),
        )
        assertEquals(
            RemoteNavigationPolicy.LoadFailureAction.RestorePrevious,
            RemoteNavigationPolicy.onMainFrameFailure(remote, "$remote/login"),
        )
    }

    @Test
    fun offOriginFailureRestoresPrevious() {
        assertEquals(
            RemoteNavigationPolicy.LoadFailureAction.RestorePrevious,
            RemoteNavigationPolicy.onMainFrameFailure(remote, "about:blank"),
        )
    }
}
