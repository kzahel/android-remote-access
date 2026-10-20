package dev.remoteaccess.protocol

import java.nio.ByteBuffer

data class TouchPoint(val x: Float, val y: Float)

data class TouchContact(val id: Int, val held: Boolean, val path: List<TouchPoint>)

data class TouchBatch(val scene: Int, val gesture: Int, val sequence: Int, val duration: Int, val contacts: List<TouchContact>) {
    companion object {
        fun decode(input: ByteBuffer): TouchBatch {
            require(input.remaining() >= 16)
            val scene = input.int.also { require(it > 0) }
            val gesture = input.int.also { require(it > 0) }
            val sequence = input.int.also { require(it in 0..1000000) }
            val duration = (input.short.toInt() and 65535).also { require(it in 16..100) }
            val count = (input.get().toInt() and 255).also { require(it in 1..10) }
            require(input.get() == 0.toByte())
            val ids = mutableSetOf<Int>()
            val contacts =
                (0 until count).map {
                    require(input.remaining() >= 8)
                    val id = input.int.also { require(it in 0..1000000 && ids.add(it)) }
                    val held = input.get().toInt().also { require(it in 0..1) } == 1
                    val samples = (input.get().toInt() and 255).also { require(it in 1..24) }
                    require(input.short == 0.toShort() && input.remaining() >= samples * 8)
                    TouchContact(
                        id,
                        held,
                        (0 until samples).map {
                            val x = input.float
                            val y = input.float
                            require(x.isFinite() && y.isFinite() && x >= 0 && y >= 0 && x < 16384 && y < 16384)
                            TouchPoint(x, y)
                        },
                    )
                }
            require(!input.hasRemaining())
            return TouchBatch(scene, gesture, sequence, duration, contacts)
        }
    }
}
