package com.dbchbin.ompgui.remote.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RelayClientBranchTest {
    @Test
    fun requestedLeafWinsUntilServerSnapshotConfirmsIt() {
        assertEquals("requested", resolvedBranchLeafId("requested", "persisted"))
        assertEquals("persisted", resolvedBranchLeafId(null, "persisted"))
        assertNull(resolvedBranchLeafId(null, null))
    }
}
