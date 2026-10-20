package dev.remoteaccess.protocol

import kotlin.test.Test
import kotlin.test.assertFails
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class UnlockGuardTest {
    @Test fun uncertainAttemptsSurviveProcessAndSessionReplacement() {
        var disk = false

        fun guard() = UnlockGuard({ disk }, { disk = it })
        guard().begin()
        assertTrue(guard().blocked())
        assertFails { guard().begin() }
        guard().observeUnlocked()
        assertFalse(guard().blocked())
        guard().begin()
        assertTrue(disk)
    }

    @Test fun failedPersistenceNeverAdmitsDigits() {
        val guard = UnlockGuard({ false }, { error("Disk failure") })
        assertFails { guard.begin() }
        val lostWrite = UnlockGuard({ false }, { })
        assertFails { lostWrite.begin() }
    }
}
