package dev.remoteaccess.protocol

import dev.remoteaccess.protocol.CaptureLifecycle.Phase
import dev.remoteaccess.protocol.CaptureLifecycle.Reason
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CaptureLifecycleTest {
    @Test fun consentAndStartupCannotWaitForever() {
        val declined = CaptureLifecycle(1, 100)
        assertFalse(declined.expire(60_099))
        assertFalse(declined.approved(60_100))
        assertEquals(Reason.TIMEOUT, declined.reason)
        assertFalse(declined.frame(60_101))

        val starting = CaptureLifecycle(2, 100)
        assertTrue(starting.approved(200))
        assertEquals(Phase.STARTING, starting.phase)
        assertFalse(starting.expire(15_199))
        assertTrue(starting.expire(15_200))
        assertFalse(starting.frame(15_201))
    }

    @Test fun onlyFramesEstablishAndMaintainReadiness() {
        val capture = CaptureLifecycle(3, 0)
        assertFalse(capture.frame(1))
        assertTrue(capture.approved(2))
        assertTrue(capture.frame(10))
        assertEquals(Phase.ACTIVE, capture.phase)
        assertTrue(capture.frame(9000))
        assertFalse(capture.expire(18_999))
        assertTrue(capture.expire(19_000))
        assertEquals(Reason.TIMEOUT, capture.reason)
    }

    @Test fun aTerminalRequestCannotReviveOrChangeItsReason() {
        val old = CaptureLifecycle(4, 0)
        old.stop(Reason.STOPPED)
        assertFalse(old.approved(1))
        assertFalse(old.frame(2))
        old.stop(Reason.CANCELED)
        assertEquals(CaptureLifecycle.Snapshot(4, Phase.OFF, Reason.STOPPED), old.snapshot())
        val next = CaptureLifecycle(5, 3)
        assertTrue(next.approved(4))
        assertTrue(next.frame(5))
        assertEquals(Phase.ACTIVE, next.phase)
    }
}
