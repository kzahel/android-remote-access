package dev.remoteaccess.protocol

/** Consent and encoder startup are bounded; a terminal request can never be revived. */
class CaptureLifecycle(
    val id: Int,
    now: Long,
) {
    enum class Phase(val wire: String) { OFF("off"), CONSENT("consent"), STARTING("starting"), ACTIVE("active") }

    enum class Reason(val wire: String) {
        NONE("none"),
        STOPPED("stopped"),
        CANCELED("canceled"),
        TIMEOUT("timeout"),
        INTERRUPTED("interrupted"),
        LOCKED("locked"),
        UNAVAILABLE("unavailable"),
        DISCONNECTED("disconnected"),
        PERMISSION("permission"),
    }

    data class Snapshot(val id: Int, val phase: Phase, val reason: Reason)

    @Volatile var phase = Phase.CONSENT
        private set

    @Volatile var reason = Reason.NONE
        private set
    private var deadline = now + CONSENT_TIMEOUT

    @Synchronized fun approved(now: Long): Boolean {
        if (phase != Phase.CONSENT || expire(now)) return false
        phase = Phase.STARTING
        deadline = now + START_TIMEOUT
        return true
    }

    @Synchronized fun frame(now: Long): Boolean {
        if (phase !in listOf(Phase.STARTING, Phase.ACTIVE) || expire(now)) return false
        phase = Phase.ACTIVE
        deadline = now + FRAME_TIMEOUT
        return true
    }

    @Synchronized fun expire(now: Long): Boolean {
        if (phase != Phase.OFF && now >= deadline) stop(Reason.TIMEOUT)
        return phase == Phase.OFF
    }

    @Synchronized fun stop(why: Reason) {
        if (phase == Phase.OFF) return
        phase = Phase.OFF
        reason = why
    }

    @Synchronized fun snapshot() = Snapshot(id, phase, reason)

    companion object {
        const val CONSENT_TIMEOUT = 60_000L
        const val START_TIMEOUT = 15_000L
        const val FRAME_TIMEOUT = 10_000L
    }
}
