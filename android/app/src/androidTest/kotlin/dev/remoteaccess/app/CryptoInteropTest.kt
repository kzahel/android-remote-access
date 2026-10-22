package dev.remoteaccess.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.remoteaccess.protocol.Authority
import dev.remoteaccess.protocol.Channel
import dev.remoteaccess.protocol.Crypto
import dev.remoteaccess.protocol.PhoneHandshake
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.net.SocketTimeoutException
import java.security.KeyStore
import java.util.Base64
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlin.test.assertContentEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Instrumentation-only bounded local bridge. No listener exists in the app APK. */
@RunWith(AndroidJUnit4::class)
class CryptoInteropTest {
    @Test
    fun browserAndKeystore() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val alias = "crypto-interop-${UUID.randomUUID()}"
        val portFile = File(context.filesDir, "interop-port")
        val identityFile = File(context.filesDir, "interop-public")
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val identity = KeystoreIdentity.loadOrCreate(alias)
        val entry = store.getEntry(alias, null) as KeyStore.PrivateKeyEntry

        fun decode(text: String): ByteArray = Base64.getDecoder().decode(text)
        var active = true
        var auth: Authority? = null
        var pending: PhoneHandshake? = null
        var channel: Channel? = null
        var exchanges = 0
        var rejections = 0
        var done = false
        try {
            assertTrue(entry.privateKey.encoded == null)
            assertContentEquals(identity.publicKey, KeystoreIdentity.loadOrCreate(alias).publicKey)
            // Check shared derivation and exact AES-GCM records on the Android provider.
            val v =
                JSONObject(
                    InstrumentationRegistry
                        .getInstrumentation()
                        .context.assets
                        .open(
                            "session-v1.json",
                        ).bufferedReader()
                        .use { it.readText() },
                )
            val material = Crypto.deriveMaterial(decode(v.getString("secret")), decode(v.getString("transcript")))
            material.forEachIndexed { i, value -> assertContentEquals(decode(v.getJSONArray("material").getString(i)), value) }
            listOf("viewer", "phone").forEachIndexed { direction, role ->
                val record = decode(v.getString("${role}Record"))
                val header = record.copyOfRange(0, 16)
                val nonce = material[direction + 2] + header.copyOfRange(8, 16)
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(material[direction], "AES"), GCMParameterSpec(128, nonce))
                cipher.updateAAD(header)
                assertContentEquals(record, header + cipher.doFinal(decode(v.getString("${role}Plaintext"))))
            }
            ServerSocket(0, 4, InetAddress.getByName("127.0.0.1")).use { server ->
                server.soTimeout = 1000
                context.filesDir.mkdirs()
                identityFile.writeText(Base64.getEncoder().encodeToString(identity.publicKey))
                portFile.writeText(server.localPort.toString())
                val deadline = System.nanoTime() + 180_000_000_000L
                while (!done && System.nanoTime() < deadline) {
                    val socket =
                        try {
                            server.accept()
                        } catch (_: SocketTimeoutException) {
                            continue
                        }
                    socket.use {
                        socket.soTimeout = 5000
                        val input = socket.getInputStream().buffered()
                        val head = StringBuilder()
                        while (!head.endsWith("\r\n\r\n")) {
                            val byte = input.read()
                            require(byte >= 0 && head.length < 8192)
                            head.append(byte.toChar())
                        }
                        val lines = head.toString().split("\r\n")
                        val path = lines.first().split(" ")[1]
                        val length =
                            lines
                                .firstOrNull { it.startsWith("Content-Length:", true) }
                                ?.substringAfter(':')
                                ?.trim()
                                ?.toInt() ?: 0
                        require(length in 0..65536)
                        val body = ByteArray(length)
                        var at = 0
                        while (at < length) {
                            val n = input.read(body, at, length - at)
                            require(n > 0)
                            at += n
                        }
                        var status = 200
                        val reply =
                            try {
                                when (path) {
                                    "/setup" -> {
                                        pending?.close()
                                        channel?.close()
                                        channel = null
                                        pending = null
                                        active = true
                                        val peer = decode(body.toString(Charsets.UTF_8))
                                        Crypto.publicKey(peer)
                                        auth = Authority(ByteArray(16), 1, peer) { active }
                                        identity.publicKey
                                    }
                                    "/hello" ->
                                        PhoneHandshake
                                            .start(identity, auth ?: error("Setup required"), body)
                                            .also {
                                                pending?.close()
                                                pending = it
                                            }.offer
                                    "/proof" -> {
                                        val result = (pending ?: error("No handshake")).finish(body)
                                        channel = result.second
                                        result.first
                                    }
                                    "/record" -> {
                                        val current = channel ?: error("No channel")
                                        val plaintext = current.open(body)
                                        exchanges++
                                        current.seal(plaintext)
                                    }
                                    "/revoke" -> {
                                        active = false
                                        channel?.close()
                                        ByteArray(0)
                                    }
                                    "/done" -> {
                                        done = true
                                        ByteArray(0)
                                    }
                                    else -> error("Unknown fixture route")
                                }
                            } catch (_: Exception) {
                                status = 400
                                rejections++
                                ByteArray(0)
                            }
                        val output = socket.getOutputStream()
                        output.write("HTTP/1.1 $status Fixture\r\nContent-Length: ${reply.size}\r\nConnection: close\r\n\r\n".toByteArray())
                        output.write(reply)
                        output.flush()
                    }
                }
            }
            assertTrue(done, "Browser did not finish the interoperability run")
            assertTrue(exchanges >= 3, "Expected confirmed encrypted application exchanges")
            assertTrue(rejections >= 3, "Expected native rejection of tamper, replay and revocation")
            assertFalse(active, "Final fixture must be revoked")
        } finally {
            pending?.close()
            channel?.close()
            portFile.delete()
            identityFile.delete()
            store.deleteEntry(alias)
        }
    }
}
