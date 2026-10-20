package dev.remoteaccess.protocol

/** Dependent frames cannot survive a drop. Bound memory and require a fresh keyframe to recover. */
class VideoQueue(private val maxBytes: Int = 524236, private val maxFrames: Int = 4) {
    private val queue = ArrayDeque<ByteArray>()
    private var bytes = 0
    var needsKey = true
        private set

    @Synchronized fun reset() {
        queue.clear()
        bytes = 0
        needsKey = true
    }

    @Synchronized fun offer(
        frame: ByteArray,
        key: Boolean,
    ): Boolean {
        if (queue.size >= maxFrames || bytes + frame.size > maxBytes) reset()
        if (frame.size > maxBytes || (needsKey && !key)) return false
        needsKey = false
        queue.addLast(frame)
        bytes += frame.size
        return true
    }

    @Synchronized fun poll(): ByteArray? = queue.removeFirstOrNull()?.also { bytes -= it.size }
}
