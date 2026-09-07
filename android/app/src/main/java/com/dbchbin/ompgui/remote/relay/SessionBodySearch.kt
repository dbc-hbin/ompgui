package com.dbchbin.ompgui.remote.relay

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

internal data class BodySearchMatch(
    val sessionId: String,
    val sessionName: String,
    val cwd: String,
    val entryId: String,
    val timestamp: String,
    val role: String,
    val snippet: String,
)

internal data class BodySearchPage(
    val matches: List<BodySearchMatch>,
    val nextCursor: String?,
)

internal data class BodySearchMessage(
    val entryId: String,
    val timestamp: String,
    val role: String,
    val content: String,
)

internal data class BodySearchContext(
    val sessionId: String,
    val sessionName: String,
    val cwd: String,
    val entryId: String,
    val leafId: String,
    val matchIndex: Int,
    val messages: List<BodySearchMessage>,
    val hasMoreBefore: Boolean,
    val hasMoreAfter: Boolean,
)

internal suspend fun searchSessionBodies(
    requester: RelayRequester,
    query: String,
    projectRoot: String?,
    from: String?,
    to: String?,
    cursor: String?,
): BodySearchPage {
    require(query.isNotBlank()) { "Search query must not be blank" }
    require(query.length <= 500) { "Search query must not exceed 500 characters" }
    val args = JSONObject().put("query", query).put("limit", 50)
    if (projectRoot != null) args.put("projectRoot", projectRoot)
    if (from != null) args.put("from", from)
    if (to != null) args.put("to", to)
    if (cursor != null) args.put("cursor", cursor)

    val response = requester.request("sessions", "search", args)
    val rawMatches = response.bodySearchField<JSONArray>("matches")
    if (rawMatches.length() > 50) throw JSONException("Search response exceeds 50 matches")
    val matches = List(rawMatches.length()) { index ->
        val match = rawMatches.get(index) as? JSONObject
            ?: throw JSONException("Search matches[$index] must be an object")
        BodySearchMatch(
            sessionId = match.bodySearchField("sessionId"),
            sessionName = match.bodySearchField("sessionName"),
            cwd = match.bodySearchField("cwd"),
            entryId = match.bodySearchField("entryId"),
            timestamp = match.bodySearchField("timestamp"),
            role = match.bodySearchField("role"),
            snippet = match.bodySearchField("snippet"),
        )
    }
    return BodySearchPage(
        matches = matches,
        nextCursor = if (response.has("nextCursor")) response.bodySearchField<String>("nextCursor") else null,
    )
}

internal suspend fun loadSessionSearchContext(
    requester: RelayRequester,
    sessionId: String,
    entryId: String,
): BodySearchContext {
    val response = requester.request(
        "sessions",
        "searchContext",
        JSONObject().put("id", sessionId).put("entryId", entryId),
    )
    val responseSessionId = response.bodySearchField<String>("sessionId")
    val responseEntryId = response.bodySearchField<String>("entryId")
    if (responseSessionId != sessionId || responseEntryId != entryId) {
        throw JSONException("Search context does not match the requested session and entry")
    }
    val rawIndex = response.get("matchIndex")
    val matchIndex = when (rawIndex) {
        is Int -> rawIndex
        is Long -> {
            if (rawIndex < 0 || rawIndex > Int.MAX_VALUE) {
                throw JSONException("Search context matchIndex is out of range")
            }
            rawIndex.toInt()
        }
        else -> throw JSONException("Search context matchIndex must be an integer")
    }
    val rawMessages = response.bodySearchField<JSONArray>("messages")
    if (matchIndex !in 0 until rawMessages.length()) {
        throw JSONException("Search context matchIndex is out of range")
    }
    val messages = List(rawMessages.length()) { index ->
        val message = rawMessages.get(index) as? JSONObject
            ?: throw JSONException("Search context messages[$index] must be an object")
        BodySearchMessage(
            entryId = message.bodySearchField("entryId"),
            timestamp = message.bodySearchField("timestamp"),
            role = message.bodySearchField("role"),
            content = message.bodySearchField("content"),
        )
    }
    if (messages[matchIndex].entryId != entryId) {
        throw JSONException("Search context matchIndex does not point to the requested entry")
    }
    return BodySearchContext(
        sessionId = responseSessionId,
        sessionName = response.bodySearchField("sessionName"),
        cwd = response.bodySearchField("cwd"),
        entryId = responseEntryId,
        leafId = response.bodySearchField("leafId"),
        matchIndex = matchIndex,
        messages = messages,
        hasMoreBefore = response.bodySearchField("hasMoreBefore"),
        hasMoreAfter = response.bodySearchField("hasMoreAfter"),
    )
}

private inline fun <reified T> JSONObject.bodySearchField(name: String): T {
    val value = get(name)
    return value as? T ?: throw JSONException("Search response field '$name' must be ${T::class.simpleName}")
}
