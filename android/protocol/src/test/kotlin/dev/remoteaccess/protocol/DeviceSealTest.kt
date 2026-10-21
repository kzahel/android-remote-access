package dev.remoteaccess.protocol

import org.json.JSONObject
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

class DeviceSealTest {
    private fun bytes(hex: String) = hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

    @Test fun matchesSharedVector() {
        val vector = JSONObject(File(System.getProperty("vectors")).resolveSibling("device-v1.json").readText())
        val sealed =
            DeviceSeal.seal(
                bytes(vector.getString("secret")),
                bytes(vector.getString("id")),
                vector.getString("plaintext").toByteArray(Charsets.UTF_8),
                bytes(vector.getString("iv")),
            )
        assertEquals(vector.getString("sealed"), sealed)
    }
}
