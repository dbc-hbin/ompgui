package com.dbchbin.ompgui.remote.relay

/**
 * Ownership helpers for the global session/chat banner ([RemoteUiState.error]).
 *
 * Surfaces decide ownership — not failure codes alone. Stale generations never
 * paint. Reconnect clears only connection-class banners, not unrelated Request
 * failures that still have a consumer.
 */
enum class RelayUiErrorKind {
    Pairing,
    Connection,
    Request,
    Command,
    Session,
    Protocol,
}

object RelayUiErrors {
    /** Disconnect / epoch invalidation codes that reconnect may drop. */
    private val CONNECTION_CLASS_CODES = setOf(
        "disconnected",
        "session_changed",
        "request_cancelled",
        "send_failed",
    )

    /** Stale epoch results must never paint; same-generation failures may. */
    fun isCurrentGeneration(requestGeneration: Long, currentGeneration: Long): Boolean =
        requestGeneration == currentGeneration

    fun isConnectionClassCode(code: String?): Boolean =
        code != null && code in CONNECTION_CLASS_CODES

    /**
     * Reconnect drops Connection banners and Request banners that were only
     * connection-class. Real domain Request failures stay until their owner
     * succeeds or the user leaves the surface.
     */
    fun shouldClearOnConnected(kind: RelayUiErrorKind?, code: String?): Boolean = when (kind) {
        RelayUiErrorKind.Connection -> true
        RelayUiErrorKind.Request -> isConnectionClassCode(code)
        else -> false
    }

    fun shouldSurfaceCommandFailure(command: String): Boolean =
        command != "get_state" && command != "get_subagents"

    fun clearKindsOnHealthySnapshot(): Set<RelayUiErrorKind> = setOf(
        RelayUiErrorKind.Request,
        RelayUiErrorKind.Session,
    )

    fun clearKindsOnLeaveChat(): Set<RelayUiErrorKind> = setOf(
        RelayUiErrorKind.Request,
        RelayUiErrorKind.Command,
    )
}
