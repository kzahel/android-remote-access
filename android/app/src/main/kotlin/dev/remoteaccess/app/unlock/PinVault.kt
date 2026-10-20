package dev.remoteaccess.app.unlock

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import dev.remoteaccess.protocol.UnlockGuard
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Phone-local opt-in secret. Credential-protected, no backup, available only after first unlock. */
internal class PinVault(
    context: Context,
    private val keyAlias: String = "saved-unlock-pin-v1",
    directory: File = context.noBackupFilesDir,
) {
    private val blob = AtomicFile(File(directory, "saved-unlock-pin"))
    private val latch = AtomicFile(File(directory, "unlock-attempt"))
    val guard =
        UnlockGuard(
            {
                if (!latch.baseFile.exists()) {
                    false
                } else {
                    runCatching {
                        latch.readFully().contentEquals(
                            byteArrayOf(0),
                        )
                    }.getOrDefault(false).not()
                }
            },
            { write(latch, byteArrayOf(if (it) 1 else 0)) },
        )

    fun saved() = blob.baseFile.exists()

    fun save(pin: CharArray) =
        synchronized(lock) {
            var bytes: ByteArray? = null
            try {
                require(pin.size in 4..16 && pin.all { it in '0'..'9' })
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.ENCRYPT_MODE, key())
                bytes = ByteArray(pin.size) { pin[it].code.toByte() }
                write(blob, cipher.iv + cipher.doFinal(bytes))
            } finally {
                bytes?.fill(0)
                pin.fill('\u0000')
            }
        }

    fun read(): CharArray =
        synchronized(lock) {
            val encoded = blob.readFully()
            require(encoded.size in 32..44)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, encoded.copyOfRange(0, 12)))
            val bytes = cipher.doFinal(encoded.copyOfRange(12, encoded.size))
            try {
                require(bytes.size in 4..16 && bytes.all { it.toInt() in 48..57 })
                CharArray(bytes.size) { bytes[it].toInt().toChar() }
            } finally {
                bytes.fill(0)
                encoded.fill(0)
            }
        }

    fun forget() =
        synchronized(lock) {
            blob.delete()
            KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(keyAlias)
        }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(keyAlias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(
                KeyGenParameterSpec.Builder(keyAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setKeySize(
                        256,
                    ).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setUserAuthenticationRequired(false).build(),
            )
        }.generateKey()
    }

    private fun write(
        file: AtomicFile,
        bytes: ByteArray,
    ) {
        val output = file.startWrite()
        try {
            output.write(bytes)
            file.finishWrite(output)
        } catch (error: Exception) {
            file.failWrite(output)
            throw error
        }
    }

    companion object {
        private val lock = Any()
    }
}
