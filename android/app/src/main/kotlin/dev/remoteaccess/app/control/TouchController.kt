package dev.remoteaccess.app.control

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.PathMeasure
import android.os.Handler
import android.os.SystemClock
import dev.remoteaccess.protocol.TouchBatch

/** Port of the spike's measured continuation mechanics. All operations run on main. */
internal class TouchController(private val service: AccessibilityService, private val main: Handler) {
    private data class Finger(val stroke: GestureDescription.StrokeDescription, val x: Float, val y: Float)

    private val fingers = linkedMapOf<Int, Finger>()
    private var owner: Any? = null
    private var gesture = 0
    private var sequence = -1
    private var scene = 0
    private var version = 0
    private var lastPacket = 0L
    private var started = 0L
    private var allowed: () -> Boolean = { false }
    private var pending: ((Int) -> Unit)? = null
    private var dispatches = 0
    val dispatching get() = dispatches > 0
    val active get() = owner != null
    private val watchdog =
        object : Runnable {
            override fun run() {
                if (!active) return
                val now = SystemClock.elapsedRealtime()
                if (!allowed() || now - lastPacket > 700 || now - started > 60000) release() else main.postDelayed(this, 100)
            }
        }

    fun accept(
        batch: TouchBatch,
        who: Any,
        width: Int,
        height: Int,
        currentScene: Int,
        current: () -> Boolean,
        reply: (Int) -> Unit,
    ) {
        if (pending != null) {
            reply(6)
            return
        }
        val mismatch = owner !== who || gesture != batch.gesture || batch.sequence != sequence + 1 || scene != currentScene
        if (batch.scene != currentScene || (active && mismatch) ||
            (!active && batch.sequence != 0)
        ) {
            release()
            reply(2)
            return
        }
        if (batch.contacts.any {
                    c ->
                c.path.any { it.x >= width || it.y >= height }
            } || !batch.contacts.map { it.id }.containsAll(fingers.keys)
        ) {
            release()
            reply(2)
            return
        }
        val builder = GestureDescription.Builder()
        val next = linkedMapOf<Int, Finger>()
        var changed = false
        for (contact in batch.contacts) {
            val previous = fingers[contact.id]
            if (previous == null || !contact.held) changed = true
            val path = Path()
            val first = contact.path.first()
            val startX = previous?.x ?: first.x
            val startY = previous?.y ?: first.y
            path.moveTo(startX, startY)
            contact.path.forEach { p ->
                if (previous != null && (p.x != previous.x || p.y != previous.y)) changed = true
                path.lineTo(p.x, p.y)
            }
            val delay = if (previous == null && active) 1L else 0L
            val stroke =
                previous?.stroke?.continueStroke(path, 0, batch.duration.toLong(), contact.held)
                    ?: GestureDescription.StrokeDescription(path, delay, batch.duration - delay, contact.held)
            builder.addStroke(stroke)
            // Android's measured endpoint, not the raw last float, is required by continueStroke.
            val measure = PathMeasure(path, false)
            val end = floatArrayOf(startX, startY)
            if (measure.length > 0) measure.getPosTan(measure.length, end, null)
            if (contact.held) next[contact.id] = Finger(stroke, end[0], end[1])
        }
        sequence = batch.sequence
        lastPacket = SystemClock.elapsedRealtime()
        allowed = current
        if (!changed) {
            reply(0)
            return
        }
        if (!active) {
            owner = who
            gesture = batch.gesture
            scene = currentScene
            started = lastPacket
            main.postDelayed(watchdog, 100)
        }
        val expected = ++version
        pending = reply
        fingers.clear()
        fingers.putAll(next)
        val accepted =
            dispatch(
                builder.build(),
                object : AccessibilityService.GestureResultCallback() {
                    override fun onCompleted(gestureDescription: GestureDescription) {
                        if (version != expected) return
                        pending = null
                        reply(if (current()) 0 else 8)
                        if (fingers.isEmpty()) clear()
                    }

                    override fun onCancelled(gestureDescription: GestureDescription) {
                        if (version != expected) return
                        pending = null
                        clear()
                        reply(7)
                    }
                },
            )
        if (!accepted) {
            pending = null
            clear()
            reply(7)
        }
    }

    fun release(who: Any? = null) {
        if (who != null && owner !== who) return
        version++
        val interrupted = pending
        pending = null
        if (fingers.isNotEmpty()) {
            try {
                val builder = GestureDescription.Builder()
                fingers.values.forEach { finger ->
                    val path = Path().apply { moveTo(finger.x, finger.y) }
                    builder.addStroke(finger.stroke.continueStroke(path, 0, 16, false))
                }
                dispatch(builder.build(), object : AccessibilityService.GestureResultCallback() {})
            } catch (_: Exception) {
                // Public API cannot guarantee a raw ACTION_CANCEL. Never inject a dummy tap.
            }
        }
        clear()
        interrupted?.invoke(7)
    }

    private fun dispatch(
        description: GestureDescription,
        callback: AccessibilityService.GestureResultCallback,
    ): Boolean {
        dispatches++
        try {
            val accepted =
                service.dispatchGesture(
                    description,
                    object : AccessibilityService.GestureResultCallback() {
                        override fun onCompleted(gestureDescription: GestureDescription) {
                            dispatches--
                            callback.onCompleted(gestureDescription)
                        }

                        override fun onCancelled(gestureDescription: GestureDescription) {
                            dispatches--
                            callback.onCancelled(gestureDescription)
                        }
                    },
                    main,
                )
            if (!accepted) dispatches--
            return accepted
        } catch (error: Exception) {
            dispatches--
            throw error
        }
    }

    private fun clear() {
        fingers.clear()
        owner = null
        pending = null
        allowed = { false }
        main.removeCallbacks(watchdog)
    }
}
