package com.dbchbin.ompgui.remote.relay

import org.json.JSONObject

class RelayRequestException(
    val code: String,
    message: String,
    val details: JSONObject? = null,
) : Exception(message)

fun interface RelayRequester {
    suspend fun request(domain: String, action: String, args: JSONObject): JSONObject
}
