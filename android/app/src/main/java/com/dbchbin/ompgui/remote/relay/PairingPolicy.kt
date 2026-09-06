package com.dbchbin.ompgui.remote.relay

/**
 * Decides how pairing intents and hello_err codes interact with an already
 * saved device. Android may redeliver the original `ompgui://pair` intent
 * after process death; a consumed pairing secret then fails and must not
 * wipe the token that was already stored.
 */
object PairingPolicy {
    fun shouldIgnoreStalePairing(alreadyPaired: Boolean): Boolean = alreadyPaired

    fun shouldClearCredentials(
        code: String,
        hasSavedDevice: Boolean,
        pairingAttempt: Boolean,
    ): Boolean {
        return when (code) {
            "password_required", "device_limit" -> false
            "unauthorized", "pairing_expired" -> !(pairingAttempt && hasSavedDevice)
            else -> false
        }
    }

    fun shouldReconnectWithSavedDevice(
        code: String,
        hasSavedDevice: Boolean,
        pairingAttempt: Boolean,
    ): Boolean {
        if (!hasSavedDevice || !pairingAttempt) return false
        return code == "unauthorized" || code == "pairing_expired" || code == "device_limit"
    }

    fun shouldStopReconnect(code: String): Boolean =
        code == "unauthorized" ||
            code == "pairing_expired" ||
            code == "password_required" ||
            code == "device_limit"
}
