package dev.remoteaccess.app

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import dev.remoteaccess.protocol.Identity
import dev.remoteaccess.protocol.JcaIdentity
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.spec.ECGenParameterSpec

/** Platform signing adapter. No identity secret crosses the protocol boundary. */
object KeystoreIdentity {
    fun loadOrCreate(alias: String): Identity {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (!store.containsAlias(alias)) {
            KeyPairGenerator
                .getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
                .apply {
                    initialize(
                        KeyGenParameterSpec
                            .Builder(
                                alias,
                                KeyProperties.PURPOSE_SIGN,
                            ).setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                            .setDigests(KeyProperties.DIGEST_SHA256)
                            .build(),
                    )
                }.generateKeyPair()
        }
        val entry = store.getEntry(alias, null) as KeyStore.PrivateKeyEntry
        return JcaIdentity(entry.privateKey, entry.certificate.publicKey)
    }
}
