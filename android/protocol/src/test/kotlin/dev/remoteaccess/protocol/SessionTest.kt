package dev.remoteaccess.protocol

import org.json.JSONObject
import org.junit.Test
import java.io.File
import java.security.KeyFactory
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Base64
import kotlin.test.assertContentEquals
import kotlin.test.assertFails
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SessionTest {
    private val vectors = JSONObject(File(System.getProperty("vectors")).readText())

    private fun value(name: String): ByteArray = Base64.getDecoder().decode(vectors.getString(name))

    private fun identity(): Identity = Crypto.generate().let { JcaIdentity(it.private, it.public) }

    private class Fixture {
        val viewer = Crypto.generate().let { JcaIdentity(it.private, it.public) }
        val phone = Crypto.generate().let { JcaIdentity(it.private, it.public) }
        var active = true
        val va = Authority(ByteArray(16), 1, phone.publicKey) { active }
        val pa = Authority(ByteArray(16), 1, viewer.publicKey) { active }

        fun exchange(): Pair<Channel, Channel> {
            val v = ViewerHandshake.start(viewer, va)
            val p = PhoneHandshake.start(phone, pa, v.hello)
            val (finish, channel) = p.finish(v.answer(p.offer))
            return v.finish(finish) to channel
        }
    }

    @Test
    fun sharedVectors() {
        val hello = value("hello")
        val offer = value("offer")
        val transcript = hash(bytes(domain("transcript"), hello, offer.copyOfRange(0, 105)))
        assertContentEquals(value("transcript"), transcript)
        val fixtureKey = vectors.getJSONObject("viewerEphemeral")
        val privateKey =
            KeyFactory
                .getInstance(
                    "EC",
                ).generatePrivate(PKCS8EncodedKeySpec(Base64.getDecoder().decode(fixtureKey.getString("privatePkcs8"))))
        val peer = Base64.getDecoder().decode(vectors.getJSONObject("phoneEphemeral").getString("publicKey"))
        val secret = Crypto.agree(privateKey, peer)
        assertContentEquals(value("secret"), secret)
        val material = Crypto.deriveMaterial(secret, transcript)
        material.forEachIndexed {
            index,
            key,
            ->
            assertContentEquals(Base64.getDecoder().decode(vectors.getJSONArray("material").getString(index)), key)
        }
        val phone = Base64.getDecoder().decode(vectors.getJSONObject("phone").getString("publicKey"))
        Crypto.verify(phone, domain("phone-proof") + transcript, offer.copyOfRange(105, 169))
        val viewer = Base64.getDecoder().decode(vectors.getJSONObject("viewer").getString("publicKey"))
        Crypto.verify(viewer, domain("viewer-proof") + transcript, value("proof").copyOfRange(8, 72))
        val auth = Authority(value("pairingId"), 1, phone) { true }
        val v = Channel(auth, 0, material)
        val p = Channel(auth, 1, material)
        assertContentEquals(value("proof").copyOfRange(72, 119), v.seal(text("viewer-finished")))
        assertContentEquals(text("viewer-finished"), p.open(value("proof").copyOfRange(72, 119)))
        assertContentEquals(value("finish").copyOfRange(8, 54), p.seal(text("phone-finished")))
        v.open(value("finish").copyOfRange(8, 54))
        assertContentEquals(value("viewerRecord"), v.seal(value("viewerPlaintext")))
        assertContentEquals(value("viewerPlaintext"), p.open(value("viewerRecord")))
        assertContentEquals(value("phoneRecord"), p.seal(value("phonePlaintext")))
        assertContentEquals(value("phonePlaintext"), v.open(value("phoneRecord")))
    }

    @Test
    fun freshConnectionsAndBinaryRoundTrip() {
        val f = Fixture()
        val (v, p) = f.exchange()
        val (v2, p2) = f.exchange()
        val data = text("screen 🌞\u0000touch")
        val record = v.seal(data)
        assertContentEquals(data, p.open(record))
        assertFalse(record.contentEquals(v2.seal(data)))
        assertContentEquals(ByteArray(0), v.open(p.seal(ByteArray(0))))
        assertFails { p2.open(record) }
    }

    @Test
    fun alteredHelloAndScope() {
        for (at in listOf(0, 4, 5, 6, 7, 8, 24, 28, 93, 158, 190)) {
            val f = Fixture()
            val v = ViewerHandshake.start(f.viewer, f.va)
            val altered = v.hello.copyOf().apply { this[at] = (this[at].toInt() xor 1).toByte() }
            assertFails {
                val p = PhoneHandshake.start(f.phone, f.pa, altered)
                v.answer(p.offer)
            }
        }
    }

    @Test
    fun invalidPointsAndLengths() {
        val f = Fixture()
        val v = ViewerHandshake.start(f.viewer, f.va)
        val altered =
            v.hello.copyOf().apply {
                fill(0, 190)
                this[190] = 4
            }
        assertFails { PhoneHandshake.start(f.phone, f.pa, altered) }
        assertFails { PhoneHandshake.start(f.phone, f.pa, v.hello + byteArrayOf(0)) }
        assertFails { PhoneHandshake.start(identity(), f.pa, v.hello) }
    }

    @Test
    fun alteredOfferAndTerminalHandshake() {
        for (at in listOf(0, 7, 8, 40, 105, 168)) {
            val f = Fixture()
            val v = ViewerHandshake.start(f.viewer, f.va)
            val p = PhoneHandshake.start(f.phone, f.pa, v.hello)
            val altered = p.offer.copyOf().apply { this[at] = (this[at].toInt() xor 1).toByte() }
            assertFails { v.answer(altered) }
            assertFails { v.answer(p.offer) }
        }
    }

    @Test
    fun alteredProofAndConfirmation() {
        for (at in listOf(8, 72, 118)) {
            val f = Fixture()
            val v = ViewerHandshake.start(f.viewer, f.va)
            val p = PhoneHandshake.start(f.phone, f.pa, v.hello)
            val proof = v.answer(p.offer)
            assertFails { p.finish(proof.copyOf().apply { this[at] = (this[at].toInt() xor 1).toByte() }) }
            assertFails { p.finish(proof) }
        }
    }

    @Test
    fun phoneConfirmationRequired() {
        val f = Fixture()
        val v = ViewerHandshake.start(f.viewer, f.va)
        val p = PhoneHandshake.start(f.phone, f.pa, v.hello)
        val (finish, _) = p.finish(v.answer(p.offer))
        assertFails { v.finish(finish.copyOf().apply { this[53] = (this[53].toInt() xor 1).toByte() }) }
        assertFails { v.finish(finish) }
    }

    @Test
    fun badRecordsPoisonBothDirections() {
        for (kind in listOf("tamper", "replay", "order", "reflection", "oversize", "reserved")) {
            val (v, p) = Fixture().exchange()
            val record = v.seal(text("input"))
            val bad =
                when (kind) {
                    "replay" -> {
                        p.open(record)
                        record
                    }
                    "order" -> v.seal(text("later"))
                    "reflection" -> p.seal(text("wrong direction"))
                    "oversize" -> ByteArray(1048609)
                    else ->
                        record.copyOf().apply {
                            val at = if (kind == "tamper") 32 else 5
                            this[at] = (this[at].toInt() xor 1).toByte()
                        }
                }
            assertFails { p.open(bad) }
            assertFails { p.open(record) }
            assertFails { p.seal(text("closed")) }
        }
    }

    @Test
    fun revocationFencesExistingAndNewSessions() {
        val f = Fixture()
        val (v, p) = f.exchange()
        f.active = false
        assertFails { v.seal(text("input")) }
        assertFails { p.open(byteArrayOf()) }
        assertFails { ViewerHandshake.start(f.viewer, f.va) }
    }

    @Test
    fun revocationDuringSigningAndBeforeFinish() {
        val f = Fixture()
        val signer =
            object : Identity {
                override val publicKey: ByteArray = f.phone.publicKey

                override fun sign(data: ByteArray): ByteArray = f.phone.sign(data).also { f.active = false }
            }
        val v = ViewerHandshake.start(f.viewer, f.va)
        assertFails { PhoneHandshake.start(signer, f.pa, v.hello) }
        val f2 = Fixture()
        val v2 = ViewerHandshake.start(f2.viewer, f2.va)
        val p2 = PhoneHandshake.start(f2.phone, f2.pa, v2.hello)
        val proof = v2.answer(p2.offer)
        f2.active = false
        assertFails { p2.finish(proof) }
    }

    @Test
    fun boundAndEmptyRecords() {
        val (v, p) = Fixture().exchange()
        val max = ByteArray(1048576) { (it % 251).toByte() }
        assertContentEquals(max, p.open(v.seal(max)))
        assertFails { v.seal(ByteArray(1048577)) }
        assertFails { v.seal(byteArrayOf()) }
        assertTrue(vectors.getString("warning").contains("SYNTHETIC"))
    }
}
