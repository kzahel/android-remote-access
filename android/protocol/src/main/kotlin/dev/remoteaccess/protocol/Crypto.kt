package dev.remoteaccess.protocol

import java.math.BigInteger
import java.nio.ByteBuffer
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.PublicKey
import java.security.SecureRandom
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import java.util.concurrent.atomic.AtomicBoolean
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class SessionRejected : Exception("Session rejected")

internal fun requireSession(value: Boolean) {
    if (!value) throw SessionRejected()
}

internal fun bytes(vararg parts: ByteArray): ByteArray = parts.fold(ByteArray(0)) { a, b -> a + b }

internal fun text(value: String): ByteArray = value.toByteArray(Charsets.UTF_8)

internal fun same(
    a: ByteArray,
    b: ByteArray,
): Boolean = java.security.MessageDigest.isEqual(a, b)

internal fun hash(value: ByteArray): ByteArray = java.security.MessageDigest.getInstance("SHA-256").digest(value)

internal fun random(size: Int): ByteArray = ByteArray(size).also { SecureRandom().nextBytes(it) }

internal fun domain(label: String): ByteArray = text("ara/session/$label/v1\u0000")

internal fun header(type: Int): ByteArray = byteArrayOf(65, 82, 65, 49, type.toByte(), 1, 1, 0)

internal fun frame(
    data: ByteArray,
    type: Int,
    size: Int,
) {
    requireSession(data.size == size && same(data.copyOfRange(0, 8), header(type)))
}

internal fun uint32(value: Long): ByteArray {
    requireSession(value in 0..0xffffffffL)
    return ByteBuffer.allocate(4).putInt(value.toInt()).array()
}

interface Identity {
    val publicKey: ByteArray

    fun sign(data: ByteArray): ByteArray
}

/** Works with a non-exportable Android Keystore PrivateKey as well as JCA keys. */
class JcaIdentity(private val privateKey: PrivateKey, publicKey: PublicKey) : Identity {
    private val encoded = Crypto.publicBytes(publicKey)
    override val publicKey: ByteArray get() = encoded.copyOf()

    override fun sign(data: ByteArray): ByteArray = Crypto.sign(privateKey, data)
}

class Authority(
    id: ByteArray,
    val generation: Long,
    peer: ByteArray,
    private val isCurrent: () -> Boolean,
) {
    val id: ByteArray = id.copyOf()
    val peer: ByteArray = peer.copyOf()

    internal fun check() {
        requireSession(id.size == 16 && peer.size == 65 && isCurrent())
        uint32(generation)
    }
}

object Crypto {
    private val curve: ECParameterSpec =
        AlgorithmParameters.getInstance("EC").apply {
            init(ECGenParameterSpec("secp256r1"))
        }.getParameterSpec(ECParameterSpec::class.java)

    fun generate(): KeyPair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()

    private fun fixed(value: BigInteger): ByteArray {
        val raw = value.toByteArray()
        requireSession(raw.size <= 33 && value.signum() >= 0)
        return raw.takeLast(32).toByteArray().let { ByteArray(32 - it.size) + it }
    }

    fun publicBytes(key: PublicKey): ByteArray {
        requireSession(key is ECPublicKey)
        val ec = key as ECPublicKey
        requireSession(ec.params.order == curve.order && ec.params.generator == curve.generator)
        return byteArrayOf(4) + fixed(ec.w.affineX) + fixed(ec.w.affineY)
    }

    fun publicKey(raw: ByteArray): PublicKey {
        requireSession(raw.size == 65 && raw[0] == 4.toByte())
        val x = BigInteger(1, raw.copyOfRange(1, 33))
        val y = BigInteger(1, raw.copyOfRange(33, 65))
        val p = (curve.curve.field as java.security.spec.ECFieldFp).p
        requireSession(
            x < p && y < p &&
                y.modPow(BigInteger.valueOf(2), p) ==
                (x.modPow(BigInteger.valueOf(3), p) + curve.curve.a * x + curve.curve.b).mod(p),
        )
        return KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(ECPoint(x, y), curve))
    }

    fun sign(
        key: PrivateKey,
        data: ByteArray,
    ): ByteArray {
        val der =
            Signature.getInstance("SHA256withECDSA").run {
                initSign(key)
                update(data)
                sign()
            }
        var offset = 2
        requireSession(der.size in 8..72 && der[0] == 0x30.toByte() && der[1].toInt() == der.size - 2)

        fun integer(): ByteArray {
            requireSession(offset + 2 <= der.size && der[offset++] == 2.toByte())
            val length = der[offset++].toInt() and 255
            requireSession(length in 1..33 && offset + length <= der.size)
            return fixed(BigInteger(der.copyOfRange(offset, offset + length))).also { offset += length }
        }
        val raw = integer() + integer()
        requireSession(offset == der.size)
        return raw
    }

    fun verify(
        key: ByteArray,
        data: ByteArray,
        raw: ByteArray,
    ) {
        requireSession(raw.size == 64)

        fun integer(start: Int): ByteArray {
            val encoded = BigInteger(1, raw.copyOfRange(start, start + 32)).toByteArray()
            return byteArrayOf(2, encoded.size.toByte()) + encoded
        }
        val body = integer(0) + integer(32)
        val der = byteArrayOf(0x30, body.size.toByte()) + body
        requireSession(
            Signature.getInstance("SHA256withECDSA").run {
                initVerify(publicKey(key))
                update(data)
                verify(der)
            },
        )
    }

    fun agree(
        key: PrivateKey,
        peer: ByteArray,
    ): ByteArray =
        KeyAgreement.getInstance("ECDH").run {
            init(key)
            doPhase(publicKey(peer), true)
            generateSecret()
        }

    private fun hmac(
        key: ByteArray,
        data: ByteArray,
    ): ByteArray =
        Mac.getInstance("HmacSHA256").run {
            init(SecretKeySpec(key, "HmacSHA256"))
            doFinal(data)
        }

    fun deriveMaterial(
        secret: ByteArray,
        transcript: ByteArray,
    ): List<ByteArray> {
        requireSession(secret.size == 32 && transcript.size == 32)
        val prk = hmac(transcript, secret)
        return try {
            listOf("viewer-key", "phone-key", "viewer-nonce", "phone-nonce").mapIndexed { index, label ->
                hmac(prk, text("ara/session/v1/$label") + byteArrayOf(1)).copyOf(if (index < 2) 32 else 4)
            }
        } finally {
            prk.fill(0)
        }
    }
}

class Channel internal constructor(private val auth: Authority, private val direction: Int, material: List<ByteArray>) {
    private val sendKey = material[direction].copyOf()
    private val receiveKey = material[1 - direction].copyOf()
    private val sendPrefix = material[direction + 2].copyOf()
    private val receivePrefix = material[3 - direction].copyOf()
    private val closed = AtomicBoolean(false)
    private val sending = AtomicBoolean(false)
    private val receiving = AtomicBoolean(false)
    private var sendSequence = 0L
    private var sendBytes = 0L
    private var receiveBytes = 0L
    private var receiveSequence = 0L

    fun close() {
        closed.set(true)
        sendKey.fill(0)
        receiveKey.fill(0)
        sendPrefix.fill(0)
        receivePrefix.fill(0)
    }

    private fun ready() {
        requireSession(!closed.get())
        auth.check()
    }

    fun seal(plaintext: ByteArray): ByteArray {
        try {
            ready()
            requireSession(sending.compareAndSet(false, true))
            requireSession(plaintext.size <= 1048576 && sendSequence < 1048576L && sendBytes + plaintext.size <= 1073741824L)
            val h = text("ARR1") + byteArrayOf(direction.toByte(), 0, 0, 0) + ByteBuffer.allocate(8).putLong(sendSequence++).array()
            sendBytes += plaintext.size
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(sendKey, "AES"), GCMParameterSpec(128, sendPrefix + h.copyOfRange(8, 16)))
            cipher.updateAAD(h)
            val result = h + cipher.doFinal(plaintext)
            ready()
            return result
        } catch (_: Exception) {
            close()
            throw SessionRejected()
        } finally {
            sending.set(false)
        }
    }

    fun open(record: ByteArray): ByteArray {
        try {
            ready()
            requireSession(receiving.compareAndSet(false, true))
            requireSession(record.size in 32..1048608)
            val h = record.copyOfRange(0, 16)
            requireSession(same(h.copyOfRange(0, 8), text("ARR1") + byteArrayOf((1 - direction).toByte(), 0, 0, 0)))
            requireSession(
                receiveSequence < 1048576L &&
                    receiveBytes + record.size - 32 <= 1073741824L &&
                    ByteBuffer.wrap(h, 8, 8).long == receiveSequence,
            )
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(receiveKey, "AES"), GCMParameterSpec(128, receivePrefix + h.copyOfRange(8, 16)))
            cipher.updateAAD(h)
            val plaintext = cipher.doFinal(record.copyOfRange(16, record.size))
            ready()
            receiveSequence++
            receiveBytes += plaintext.size
            return plaintext
        } catch (_: Exception) {
            close()
            throw SessionRejected()
        } finally {
            receiving.set(false)
        }
    }
}

internal fun channel(
    auth: Authority,
    direction: Int,
    ephemeral: KeyPair,
    peer: ByteArray,
    transcript: ByteArray,
): Channel {
    val secret = Crypto.agree(ephemeral.private, peer)
    try {
        val material = Crypto.deriveMaterial(secret, transcript)
        return try {
            auth.check()
            Channel(auth, direction, material)
        } finally {
            material.forEach { it.fill(0) }
        }
    } finally {
        secret.fill(0)
    }
}
