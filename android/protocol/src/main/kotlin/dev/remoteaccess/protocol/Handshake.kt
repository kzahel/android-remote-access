package dev.remoteaccess.protocol

import java.security.KeyPair

class ViewerHandshake private constructor(
    val hello: ByteArray,
    private val identity: Identity,
    private val auth: Authority,
    private var ephemeral: KeyPair?,
) {
    private enum class Phase { OFFER, WORKING, FINISH, DONE, FAILED }

    private var phase = Phase.OFFER
    private var record: Channel? = null

    @Synchronized
    fun answer(offer: ByteArray): ByteArray {
        try {
            auth.check()
            requireSession(phase == Phase.OFFER)
            phase = Phase.WORKING
            frame(offer, 2, 169)
            val transcript = hash(bytes(domain("transcript"), hello, offer.copyOfRange(0, 105)))
            Crypto.verify(auth.peer, domain("phone-proof") + transcript, offer.copyOfRange(105, 169))
            val key = ephemeral ?: throw SessionRejected()
            ephemeral = null
            val current = channel(auth, 0, key, offer.copyOfRange(40, 105), transcript)
            record = current
            val signature = identity.sign(domain("viewer-proof") + transcript)
            requireSession(signature.size == 64)
            val proof = bytes(header(3), signature, current.seal(text("viewer-finished")))
            auth.check()
            phase = Phase.FINISH
            return proof
        } catch (_: Exception) {
            phase = Phase.FAILED
            ephemeral = null
            record?.close()
            throw SessionRejected()
        }
    }

    @Synchronized
    fun finish(finish: ByteArray): Channel {
        try {
            auth.check()
            requireSession(phase == Phase.FINISH)
            phase = Phase.WORKING
            frame(finish, 4, 54)
            val current = record ?: throw SessionRejected()
            requireSession(same(current.open(finish.copyOfRange(8, finish.size)), text("phone-finished")))
            auth.check()
            phase = Phase.DONE
            return current
        } catch (_: Exception) {
            phase = Phase.FAILED
            ephemeral = null
            record?.close()
            throw SessionRejected()
        }
    }

    companion object {
        fun start(
            identity: Identity,
            auth: Authority,
        ): ViewerHandshake {
            auth.check()
            val key = Crypto.generate()
            val hello =
                bytes(
                    header(1),
                    auth.id,
                    uint32(auth.generation),
                    identity.publicKey,
                    auth.peer,
                    random(32),
                    Crypto.publicBytes(key.public),
                )
            auth.check()
            return ViewerHandshake(hello, identity, auth, key)
        }
    }
}

class PhoneHandshake private constructor(
    val offer: ByteArray,
    private val auth: Authority,
    private val transcript: ByteArray,
    private val record: Channel,
) {
    private var used = false

    @Synchronized
    fun close() {
        used = true
        record.close()
    }

    @Synchronized
    fun finish(proof: ByteArray): Pair<ByteArray, Channel> {
        try {
            auth.check()
            requireSession(!used)
            used = true
            frame(proof, 3, 119)
            Crypto.verify(auth.peer, domain("viewer-proof") + transcript, proof.copyOfRange(8, 72))
            requireSession(same(record.open(proof.copyOfRange(72, proof.size)), text("viewer-finished")))
            val finish = header(4) + record.seal(text("phone-finished"))
            auth.check()
            return finish to record
        } catch (_: Exception) {
            record.close()
            throw SessionRejected()
        }
    }

    companion object {
        fun start(
            identity: Identity,
            auth: Authority,
            hello: ByteArray,
        ): PhoneHandshake {
            auth.check()
            frame(hello, 1, 255)
            requireSession(
                same(hello.copyOfRange(8, 24), auth.id) &&
                    same(hello.copyOfRange(24, 28), uint32(auth.generation)) &&
                    same(hello.copyOfRange(28, 93), auth.peer) &&
                    same(hello.copyOfRange(93, 158), identity.publicKey),
            )
            val key = Crypto.generate()
            val unsigned = bytes(header(2), random(32), Crypto.publicBytes(key.public))
            val transcript = hash(bytes(domain("transcript"), hello, unsigned))
            val current = channel(auth, 1, key, hello.copyOfRange(190, hello.size), transcript)
            try {
                val signature = identity.sign(domain("phone-proof") + transcript)
                requireSession(signature.size == 64)
                auth.check()
                return PhoneHandshake(unsigned + signature, auth, transcript, current)
            } catch (_: Exception) {
                current.close()
                throw SessionRejected()
            }
        }
    }
}
