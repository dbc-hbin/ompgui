package com.dbchbin.ompgui.remote

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteReplicaBridgeTest {
    @Test
    fun localReadAccessRequiresLocalTopLevelOrigin() {
        assertTrue(RemoteReplicaBridge.isTopLevelAtOrigin("https://localhost", "https://localhost/?offline=1"))
        assertFalse(RemoteReplicaBridge.isTopLevelAtOrigin("https://localhost", "https://remote.example/?ompguiRemote=1"))
        assertFalse(RemoteReplicaBridge.isTopLevelAtOrigin("https://localhost", "https://localhost.evil/"))
    }

    @Test
    fun snapshotWriteAccessRequiresConfiguredTopLevelOrigin() {
        assertTrue(RemoteReplicaBridge.isTopLevelAtOrigin("https://remote.example", "https://remote.example/session?ompguiRemote=1"))
        assertFalse(RemoteReplicaBridge.isTopLevelAtOrigin("https://remote.example", "https://third-party.example/frame"))
        assertFalse(RemoteReplicaBridge.isTopLevelAtOrigin("https://remote.example", "https://remote.example.evil/"))
    }
}
