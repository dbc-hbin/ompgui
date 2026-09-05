package com.dbchbin.ompgui.remote.net

import com.dbchbin.ompgui.remote.relay.ClientFrame
import com.dbchbin.ompgui.remote.relay.PairingPolicy
import com.dbchbin.ompgui.remote.relay.ServerFrame
import com.dbchbin.ompgui.remote.relay.encode
import com.dbchbin.ompgui.remote.relay.RelayFrameAssembler
import com.dbchbin.ompgui.remote.relay.sendRelayFrames
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

enum class ConnectionState { Idle, Connecting, Connected, Failed }

interface RelayTransport {
    fun connect(url: String)
    fun send(text: String): Boolean
    fun close()
}

interface RelayTransportListener {
    fun onOpen()
    fun onText(text: String)
    fun onClosed()
    fun onFailure(message: String)
}

class OkHttpRelayTransport(
    private val listener: RelayTransportListener,
    private val client: OkHttpClient = defaultClient(),
) : RelayTransport {
    private var socket: WebSocket? = null

    override fun connect(url: String) {
        close()
        val request = Request.Builder().url(url).build()
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                listener.onOpen()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                listener.onText(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, reason)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                listener.onClosed()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                listener.onFailure(t.message ?: "Connection failed")
            }
        })
    }

    override fun send(text: String): Boolean = socket?.send(text) == true

    override fun close() {
        try {
            socket?.close(1000, "")
        } catch (_: Exception) {
            // ignore
        }
        socket = null
    }

    companion object {
        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .pingInterval(20, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }
}

class RelayConnection(
    private val transportFactory: (RelayTransportListener) -> RelayTransport,
    private val mainHandler: (Runnable) -> Unit = { it.run() },
    private val schedule: (delayMs: Long, Runnable) -> Unit = { _, runnable -> runnable.run() },
    nowMs: () -> Long = { System.nanoTime() / 1_000_000 },
) {
    private val assembler = RelayFrameAssembler(nowMs)
    enum class Mode { Pairing, Token }

    interface Listener {
        fun onState(state: ConnectionState)
        fun onFrame(frame: ServerFrame)
        fun onProtocolError(message: String)
    }

    @Volatile
    var state: ConnectionState = ConnectionState.Idle
        private set

    private val closed = AtomicBoolean(false)
    private var listener: Listener? = null
    private var transport: RelayTransport? = null
    private var pendingHello: ClientFrame.Hello? = null
    private var mode: Mode = Mode.Pairing
    private var reconnectUrl: String? = null
    private var reconnectHello: ClientFrame.Hello? = null
    private var backoffMs = INITIAL_BACKOFF_MS
    private var reconnectGeneration = 0

    fun setListener(listener: Listener?) {
        this.listener = listener
    }

    @Synchronized
    fun connectPairing(url: String, secret: String, label: String?, password: String?) {
        closed.set(false)
        mode = Mode.Pairing
        reconnectUrl = null
        reconnectHello = null
        backoffMs = INITIAL_BACKOFF_MS
        pendingHello = ClientFrame.Hello(
            pairingSecret = secret,
            password = password,
            label = label,
        )
        start(url)
    }

    @Synchronized
    fun connectToken(url: String, deviceId: String, token: String, label: String?) {
        closed.set(false)
        mode = Mode.Token
        val hello = ClientFrame.Hello(deviceId = deviceId, token = token, label = label)
        reconnectUrl = url
        reconnectHello = hello
        backoffMs = INITIAL_BACKOFF_MS
        pendingHello = hello
        start(url)
    }

    fun promoteToToken(url: String, deviceId: String, token: String, label: String?) {
        mode = Mode.Token
        reconnectUrl = url
        reconnectHello = ClientFrame.Hello(deviceId = deviceId, token = token, label = label)
        backoffMs = INITIAL_BACKOFF_MS
    }

    @Synchronized
    fun send(frame: ClientFrame): Boolean {
        if (closed.get()) return false
        val connectingHello = frame is ClientFrame.Hello && state == ConnectionState.Connecting
        if (state != ConnectionState.Connected && !connectingHello) return false
        val current = transport ?: return false
        return try {
            val sent = sendRelayFrames(frame.encode(), current::send)
            if (!sent) handleDrop("Could not send relay frame")
            sent
        } catch (_: Exception) {
            false
        }
    }

    @Synchronized
    fun close() {
        if (!closed.compareAndSet(false, true)) {
            transport?.close()
            return
        }
        reconnectGeneration += 1
        assembler.clear()
        reconnectUrl = null
        reconnectHello = null
        pendingHello = null
        transport?.close()
        transport = null
        emitState(ConnectionState.Idle)
    }

    private fun start(url: String) {
        reconnectGeneration += 1
        assembler.clear()
        transport?.close()
        emitState(ConnectionState.Connecting)
        val generation = reconnectGeneration
        var currentTransport: RelayTransport? = null
        val active = AtomicBoolean(true)
        val current = transportFactory(object : RelayTransportListener {
            override fun onOpen() = dispatch {
                if (!active.get() || transport !== currentTransport || reconnectGeneration != generation) return@dispatch
                handleOpen()
            }
            override fun onText(text: String) = dispatch {
                if (!active.get() || transport !== currentTransport || reconnectGeneration != generation) return@dispatch
                handleText(text)
            }
            override fun onClosed() = onFailure("closed")
            override fun onFailure(message: String) {
                if (!active.compareAndSet(true, false)) return
                dispatch {
                    if (transport !== currentTransport || reconnectGeneration != generation) return@dispatch
                    handleDrop(message)
                }
            }
        })
        currentTransport = current
        transport = current
        current.connect(url)
    }

    private fun handleOpen() {
        if (closed.get()) return
        val hello = pendingHello ?: return
        val encoded = try {
            hello.encode()
        } catch (error: Exception) {
            emitState(ConnectionState.Failed)
            listener?.onProtocolError(error.message ?: "Invalid hello")
            return
        }
        if (transport?.send(encoded) != true) {
            emitState(ConnectionState.Failed)
            listener?.onProtocolError("Could not send hello")
        }
    }

    private fun handleText(text: String) {
        if (closed.get()) return
        val frame = try {
            assembler.receive(text) ?: return
        } catch (error: IllegalArgumentException) {
            listener?.onProtocolError(error.message ?: "Invalid relay frame")
            handleDrop("Invalid relay frame")
            return
        }
        when (frame) {
            is ServerFrame.HelloOk -> {
                pendingHello = null
                backoffMs = INITIAL_BACKOFF_MS
                emitState(ConnectionState.Connected)
            }
            is ServerFrame.HelloErr -> {
                val rejectedGeneration = reconnectGeneration
                emitState(ConnectionState.Failed)
                listener?.onFrame(frame)
                if (reconnectGeneration != rejectedGeneration) return
                if (shouldStopReconnect(frame.code)) {
                    reconnectUrl = null
                    reconnectHello = null
                }
                handleDrop(frame.message)
                return
            }
            else -> Unit
        }
        listener?.onFrame(frame)
    }

    private fun handleDrop(message: String) {
        if (closed.get()) return
        if (state == ConnectionState.Idle) return
        reconnectGeneration += 1
        assembler.clear()
        pendingHello = null
        val dropped = transport
        transport = null
        dropped?.close()
        val canReconnect = mode == Mode.Token && reconnectUrl != null && reconnectHello != null
        if (!canReconnect) {
            if (state != ConnectionState.Failed) {
                emitState(ConnectionState.Failed)
                listener?.onProtocolError(message)
            }
            return
        }
        emitState(ConnectionState.Connecting)
        val generation = reconnectGeneration
        val delay = backoffMs
        backoffMs = (backoffMs * 2).coerceAtMost(MAX_BACKOFF_MS)
        schedule(delay) {
            dispatch {
                if (closed.get() || generation != reconnectGeneration) return@dispatch
                val url = reconnectUrl ?: return@dispatch
                pendingHello = reconnectHello
                start(url)
            }
        }
    }

    private fun shouldStopReconnect(code: String): Boolean =
        PairingPolicy.shouldStopReconnect(code)

    private fun emitState(next: ConnectionState) {
        state = next
        listener?.onState(next)
    }

    private fun dispatch(block: () -> Unit) {
        mainHandler(Runnable { synchronized(this) { block() } })
    }

    companion object {
        private const val INITIAL_BACKOFF_MS = 1_000L
        private const val MAX_BACKOFF_MS = 30_000L
    }
}
