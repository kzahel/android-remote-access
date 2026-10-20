package dev.remoteaccess.protocol

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertFails
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RecordFramingTest {
    @Test fun largestRecordRoundtripsAndNextRecordHasFreshAssembly() {
        val record = ByteArray(RecordFraming.LIMIT) { 42 }
        val assembler = RecordAssembler()
        var result: ByteArray? = null
        RecordFraming.fragment(record).forEach { result = assembler.accept(it, 0) }
        assertContentEquals(record, result)
        assertContentEquals(byteArrayOf(1), assembler.accept(RecordFraming.fragment(byteArrayOf(1)).single(), 1))
    }

    @Test fun replayReorderingAndExpiryFailClosed() {
        val chunks = RecordFraming.fragment(ByteArray(20000))
        val assembler = RecordAssembler()
        assertFails { assembler.accept(chunks[1], 0) }
        assertNull(assembler.accept(chunks[0], 0))
        assertFails { assembler.accept(chunks[0], 0) }
        assertTrue(assembler.expired(5000))
        assertFails { assembler.accept(chunks[1], 5000) }
        assertFails { RecordFraming.fragment(ByteArray(RecordFraming.LIMIT + 1)) }
    }
}
