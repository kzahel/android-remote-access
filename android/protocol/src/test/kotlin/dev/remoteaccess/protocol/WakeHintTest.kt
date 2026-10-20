package dev.remoteaccess.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class WakeHintTest {
    private val now = 1_800_000_000_000L
    private val valid = mapOf("intent" to "connect-v1", "requestId" to "ab".repeat(16), "expires" to "1800000060")

    @Test
    fun acceptsOnlyBoundedCurrentHints() {
        assertEquals(WakeHint("ab".repeat(16), 1_800_000_060), WakeHint.parse(valid, now))
        assertNull(WakeHint.parse(valid + ("expires" to "1800000000"), now))
        assertNull(WakeHint.parse(valid + ("expires" to "1800000062"), now))
        assertNull(WakeHint.parse(valid, now + 61000))
    }

    @Test
    fun rejectsMalformedAndOverflowedInput() {
        for (value in listOf("", "-1", "garbage", Long.MAX_VALUE.toString(), "999999999999999999999")) {
            assertNull(WakeHint.parse(valid + ("expires" to value), now))
        }
        assertNull(WakeHint.parse(valid + ("requestId" to "not-an-id"), now))
        assertNull(WakeHint.parse(valid + ("intent" to "unlock"), now))
        assertNull(WakeHint.parse(emptyMap(), now))
    }

    @Test
    fun selectsOnlyAWellFormedPairAndGeneration() {
        val scoped = valid + mapOf("pairingId" to "12".repeat(16), "generation" to "34".repeat(16))
        assertEquals("12".repeat(16), WakeHint.parse(scoped, now)?.pairingId)
        assertEquals("34".repeat(16), WakeHint.parse(scoped, now)?.generation)
        assertNull(WakeHint.parse(scoped + ("generation" to "bad"), now))
        assertNull(WakeHint.parse(scoped - "pairingId", now))
        assertNull(WakeHint.parse(scoped - "generation", now))
    }
}
