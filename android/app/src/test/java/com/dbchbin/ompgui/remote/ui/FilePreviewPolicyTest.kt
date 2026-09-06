package com.dbchbin.ompgui.remote.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FilePreviewPolicyTest {
    @Test
    fun changedRevisionRefreshesOnlyAfterDraftIsClean() {
        assertFalse(shouldRefreshFile("old", "new", dirty = true))
        assertTrue(shouldRefreshFile("old", "new", dirty = false))
    }

    @Test
    fun unchangedRevisionDoesNotTriggerAnotherDownload() {
        assertFalse(shouldRefreshFile("same", "same", dirty = false))
    }

    @Test
    fun initialLoadCannotBeReplacedByPolling() {
        assertFalse(shouldRefreshFile("", "server", dirty = false))
    }
}
