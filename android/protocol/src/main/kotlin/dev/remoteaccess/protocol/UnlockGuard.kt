package dev.remoteaccess.protocol

/** Persist the latch before any digit. Reconnection/process death never resets an uncertain attempt. */
class UnlockGuard(private val read: () -> Boolean, private val write: (Boolean) -> Unit) {
    @Synchronized fun blocked() = read()

    @Synchronized fun begin() {
        check(!read())
        write(true)
        check(read())
    }

    @Synchronized fun observeUnlocked() {
        if (read()) write(false)
    }
}
