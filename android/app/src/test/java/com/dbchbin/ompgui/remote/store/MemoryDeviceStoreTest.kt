package com.dbchbin.ompgui.remote.store

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MemoryDeviceStoreTest {
    @Test
    fun savesLoadsAndClears() {
        val store = MemoryDeviceStore()
        assertNull(store.load())
        val device = PairedDevice(
            relayUrl = "wss://mac.example.ts.net/relay",
            serverId = "s_1",
            deviceId = "d_abcdefghijklmnopqr",
            token = "b".repeat(43),
        )
        assertTrue(store.save(device))
        assertEquals(device, store.load())
        store.clear()
        assertNull(store.load())
    }
}
