package dev.remoteaccess.protocol

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

/** Strict binary application boundary, independent of Android and transport. */
data class ControlCommand(val id: Long, val op: Int, val values: List<Int> = emptyList(), val text: String = "") {
    companion object {
        fun decode(bytes: ByteArray): ControlCommand {
            require(bytes.size in 12..4112)
            val input = ByteBuffer.wrap(bytes)
            require(input.int == 0x41524331)
            val op = input.get().toInt() and 255
            require(input.get() == 0.toByte() && input.get() == 0.toByte() && input.get() == 0.toByte())
            val id = input.int.toLong() and 0xffffffffL
            require(id > 0)
            val values = mutableListOf<Int>()
            var text = ""
            when (op) {
                1, 2, 3, 9 -> require(!input.hasRemaining())
                4, 5 -> {
                    val count = if (op == 4) 3 else 6
                    require(input.remaining() == count * 4)
                    repeat(count) { values.add(input.int.also { require(it >= 0) }) }
                    require(values[0] > 0)
                    if (op == 5) require(values[5] in 40..2000)
                }
                6 -> {
                    require(input.remaining() == 1)
                    values.add(input.get().toInt().also { require(it in 1..3) })
                }
                7, 8 -> {
                    require(input.remaining() <= if (op == 7) 4096 else 256)
                    text =
                        Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(input).toString()
                    if (op == 8) require(text.matches(Regex("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+")))
                }
                else -> error("Unknown command")
            }
            return ControlCommand(id, op, values, text)
        }

        fun reply(
            id: Long,
            kind: Int,
            payload: ByteArray,
        ): ByteArray {
            require(id in 1..0xffffffffL && kind in 1..3 && payload.size <= 1048564)
            return ByteBuffer.allocate(12 + payload.size).putInt(0x41525031).put(kind.toByte())
                .put(byteArrayOf(0, 0, 0)).putInt(id.toInt()).put(payload).array()
        }
    }
}
