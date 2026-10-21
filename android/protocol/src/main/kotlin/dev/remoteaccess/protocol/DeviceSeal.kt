package dev.remoteaccess.protocol

import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Seals the phone's device report into a pairing offer with the QR secret, which the relay never
 * sees: HKDF-SHA256(secret, salt = pairing ID, info) to AES-256-GCM, AAD = info || ID.
 */
object DeviceSeal {
    private val info = text("ara/pair/device/v1")

    private fun hmac(
        key: ByteArray,
        data: ByteArray,
    ): ByteArray =
        Mac.getInstance("HmacSHA256").run {
            init(SecretKeySpec(key, "HmacSHA256"))
            doFinal(data)
        }

    fun seal(
        secret: ByteArray,
        id: ByteArray,
        plaintext: ByteArray,
        iv: ByteArray = random(12),
    ): String {
        require(secret.size == 32 && id.size == 16 && iv.size == 12)
        val prk = hmac(id, secret)
        val key = hmac(prk, info + byteArrayOf(1))
        try {
            val sealed =
                Cipher.getInstance("AES/GCM/NoPadding").run {
                    init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
                    updateAAD(info + id)
                    doFinal(plaintext)
                }
            return Base64.getEncoder().encodeToString(iv + sealed)
        } finally {
            prk.fill(0)
            key.fill(0)
        }
    }
}
