package dev.remoteaccess.protocol

import org.json.JSONArray
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFails

class ControlTest {
    private fun bytes(hex: String) = hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

    @Test fun sharedCommandVectors() {
        val file = File(System.getProperty("vectors")).resolveSibling("control-v1.json")
        val vectors = JSONArray(file.readText())
        for (i in 0 until vectors.length()) {
            val vector = vectors.getJSONObject(i)
            val parsed = ControlCommand.decode(bytes(vector.getString("hex")))
            val expected = vector.getJSONObject("command")
            assertEquals(vector.getLong("id"), parsed.id)
            when (expected.getString("op")) {
                "tap" -> assertEquals(listOf(3, 120, 240), parsed.values)
                "swipe" -> assertEquals(listOf(3, 120, 240, 400, 500, 300), parsed.values)
                "navigation" -> assertEquals(listOf(2), parsed.values)
                "text" -> assertEquals(expected.getString("text"), parsed.text)
                "launch" -> assertEquals(expected.getString("packageName"), parsed.text)
            }
        }
    }

    @Test fun malformedCommandsAreRejectedBeforeExecution() {
        val good = bytes("4152433104000000000000020000000300000078000000f0")
        for (length in 0 until good.size) assertFails { ControlCommand.decode(good.copyOf(length)) }
        for (index in listOf(0, 4, 5, 12, 16, 20)) {
            val bad = good.copyOf()
            bad[index] = 255.toByte()
            assertFails { ControlCommand.decode(bad) }
        }
        assertFails { ControlCommand.decode(good + byteArrayOf(0)) }
        assertFails { ControlCommand.decode(bytes("415243310700000000000001ff")) }
        assertFails { ControlCommand.decode(bytes("41524331060000000000000100")) }
        assertFails { ControlCommand.decode(bytes("415243310800000000000001")) }
    }
}
