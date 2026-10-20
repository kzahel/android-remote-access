package dev.remoteaccess.app

import dev.remoteaccess.protocol.Authority
import dev.remoteaccess.protocol.Channel
import dev.remoteaccess.protocol.Identity
import dev.remoteaccess.protocol.PhoneHandshake
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

internal class RelayConnection(
    private val identity: Identity,
    private val grant: JSONObject,
    private val report: (String) -> Unit,
) : WebSocketListener() {
    private val active = AtomicBoolean(true)
    private var handshake: PhoneHandshake? = null
    private var channel: Channel? = null
    private var socket: WebSocket? = null
    private var ready = false

    fun connect() {
        val url = grant.getString("origin").replaceFirst("https:", "wss:") + "/api/socket"
        socket = http.newWebSocket(Request.Builder().url(url).build(), this)
    }

    @Synchronized
    fun close() {
        active.set(false)
        handshake?.close()
        channel?.close()
        socket?.cancel()
    }

    @Synchronized
    override fun onMessage(
        webSocket: WebSocket,
        text: String,
    ) {
        try {
            check(active.get())
            val message = JSONObject(text)
            when (message.getString("type")) {
                "challenge" -> {
                    val nonce = message.getString("nonce")
                    unhex(nonce, 32)
                    val data = fields("ara/relay/auth/v1", grant.getString("origin"), grant.getString("id"), "phone", nonce)
                    webSocket.send(
                        JSONObject().put(
                            "id",
                            grant.getString("id"),
                        ).put("role", "phone").put("signature", encoded(identity.sign(data))).toString(),
                    )
                }
                "authenticated" -> report("Waiting for your browser")
                "ready" -> {
                    check(!ready)
                    ready = true
                    report("Browser connected; securing session")
                }
                else -> error("Invalid relay message")
            }
        } catch (_: Exception) {
            close()
            report("Connection rejected. Reconnect or pair again.")
        }
    }

    @Synchronized
    override fun onMessage(
        webSocket: WebSocket,
        bytes: ByteString,
    ) {
        try {
            check(active.get() && ready)
            val input = bytes.toByteArray()
            val current = channel
            if (current != null) {
                val plaintext = current.open(input)
                // This slice exposes only a fixed connection check, never arbitrary commands.
                require(plaintext.contentEquals("Encrypted connection check 🌞".toByteArray(Charsets.UTF_8)))
                webSocket.send(current.seal(plaintext).toByteString())
                report("Encrypted connection passed")
            } else {
                val pending = handshake
                if (pending == null) {
                    val auth = Authority(unhex(grant.getString("id"), 16), 1, decoded(grant.getString("viewer"))) { active.get() }
                    handshake = PhoneHandshake.start(identity, auth, input).also { webSocket.send(it.offer.toByteString()) }
                } else {
                    val result = pending.finish(input)
                    channel = result.second
                    webSocket.send(result.first.toByteString())
                }
            }
        } catch (_: Exception) {
            close()
            report("Encrypted session rejected")
        }
    }

    override fun onFailure(
        webSocket: WebSocket,
        t: Throwable,
        response: Response?,
    ) {
        close()
        report("Connection closed. Tap Connect to try again.")
    }

    override fun onClosing(
        webSocket: WebSocket,
        code: Int,
        reason: String,
    ) {
        webSocket.close(code, null)
        close()
        report("Connection closed. Tap Connect to try again.")
    }
}
