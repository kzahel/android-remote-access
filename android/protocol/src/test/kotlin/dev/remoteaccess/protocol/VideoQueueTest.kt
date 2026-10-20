package dev.remoteaccess.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class VideoQueueTest {
    @Test fun dropsInvalidateDependentFramesAndRequireNewKey() {
        val queue = VideoQueue(10, 2)
        assertFalse(queue.offer(byteArrayOf(1), false))
        assertTrue(queue.offer(byteArrayOf(2, 3), true))
        assertTrue(queue.offer(byteArrayOf(4), false))
        assertFalse(queue.offer(byteArrayOf(5), false))
        assertNull(queue.poll())
        assertTrue(queue.needsKey)
        assertTrue(queue.offer(byteArrayOf(6), true))
        assertEquals(listOf<Byte>(6), queue.poll()?.toList())
        assertNull(queue.poll())
    }

    @Test fun byteBudgetAndExplicitResetAlsoInvalidateDependencies() {
        val queue = VideoQueue(10)
        assertFalse(queue.offer(ByteArray(11), true))
        assertTrue(queue.offer(ByteArray(10), true))
        assertFalse(queue.offer(byteArrayOf(1), false))
        assertNull(queue.poll())
        assertTrue(queue.offer(byteArrayOf(2), true))
        queue.reset()
        assertNull(queue.poll())
        assertFalse(queue.offer(byteArrayOf(3), false))
    }
}
