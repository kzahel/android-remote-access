package dev.remoteaccess.protocol

import java.nio.ByteBuffer

object RecordFraming {
    const val LIMIT = 1048640

    fun fragment(record: ByteArray): List<ByteArray> {
        require(record.isNotEmpty() && record.size <= LIMIT)
        return (record.indices step 16384).map { offset ->
            val size = minOf(16384, record.size - offset)
            ByteBuffer
                .allocate(12 + size)
                .putInt(0x41524431)
                .putInt(record.size)
                .putInt(offset)
                .put(record, offset, size)
                .array()
        }
    }
}

class RecordAssembler {
    private var buffer: ByteArray? = null
    private var offset = 0
    private var deadline = 0L

    fun expired(now: Long) = buffer != null && now >= deadline

    fun accept(
        chunk: ByteArray,
        now: Long,
    ): ByteArray? {
        require(chunk.size in 13..16396 && !expired(now))
        val input = ByteBuffer.wrap(chunk)
        require(input.int == 0x41524431)
        val total = input.int
        val position = input.int
        require(
            total in 1..RecordFraming.LIMIT &&
                position == offset &&
                (buffer == null || buffer?.size == total) &&
                position.toLong() + input.remaining() <= total,
        )
        if (buffer == null) {
            buffer = ByteArray(total)
            deadline = now + 5000
        }
        val target = checkNotNull(buffer)
        val size = input.remaining()
        input.get(target, offset, size)
        offset += size
        if (offset == total) {
            buffer = null
            offset = 0
            return target
        }
        return null
    }
}
