package com.dbchbin.ompgui.remote.store

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

data class PairedDevice(
    val relayUrl: String,
    val serverId: String,
    val deviceId: String,
    val token: String,
)

interface DeviceStore {
    fun isAvailable(): Boolean = true
    fun load(): PairedDevice?
    fun save(device: PairedDevice): Boolean
    fun clear()
}

class MemoryDeviceStore : DeviceStore {
    private var device: PairedDevice? = null

    override fun load(): PairedDevice? = device

    override fun save(device: PairedDevice): Boolean {
        this.device = device
        return true
    }

    override fun clear() {
        device = null
    }
}

class EncryptedDeviceStore(context: Context) : DeviceStore {
    private val prefs = try {
        val masterKey = MasterKey.Builder(context.applicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context.applicationContext,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    } catch (_: Exception) {
        null
    }

    override fun isAvailable(): Boolean = prefs != null

    override fun load(): PairedDevice? {
        val stored = prefs ?: return null
        val relayUrl = stored.getString(KEY_RELAY_URL, null)?.trim().orEmpty()
        val serverId = stored.getString(KEY_SERVER_ID, null)?.trim().orEmpty()
        val deviceId = stored.getString(KEY_DEVICE_ID, null)?.trim().orEmpty()
        val token = stored.getString(KEY_TOKEN, null)?.trim().orEmpty()
        if (relayUrl.isEmpty() || serverId.isEmpty() || deviceId.isEmpty() || token.isEmpty()) return null
        return PairedDevice(
            relayUrl = relayUrl,
            serverId = serverId,
            deviceId = deviceId,
            token = token,
        )
    }

    override fun save(device: PairedDevice): Boolean {
        val stored = prefs ?: return false
        return try {
            stored.edit()
                .putString(KEY_RELAY_URL, device.relayUrl)
                .putString(KEY_SERVER_ID, device.serverId)
                .putString(KEY_DEVICE_ID, device.deviceId)
                .putString(KEY_TOKEN, device.token)
                .commit()
        } catch (_: Exception) {
            false
        }
    }

    override fun clear() {
        prefs?.edit()?.clear()?.apply()
    }

    companion object {
        private const val PREFS_NAME = "ompgui_relay_device"
        private const val KEY_RELAY_URL = "relayUrl"
        private const val KEY_SERVER_ID = "serverId"
        private const val KEY_DEVICE_ID = "deviceId"
        private const val KEY_TOKEN = "token"
    }
}
