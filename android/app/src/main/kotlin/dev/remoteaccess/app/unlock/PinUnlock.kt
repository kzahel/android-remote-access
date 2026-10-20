package dev.remoteaccess.app.unlock

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.app.KeyguardManager
import android.app.admin.DevicePolicyManager
import android.content.Intent
import android.graphics.Path
import android.os.Handler
import android.os.SystemClock
import android.view.WindowManager
import android.view.accessibility.AccessibilityNodeInfo

/** One known credential, one observed SystemUI keypad, no guesses and no retries. Main thread only. */
internal class PinUnlock(private val service: AccessibilityService, private val main: Handler) {
    private val vault by lazy { PinVault(service) }
    var active = false
        private set

    fun observeUnlocked() {
        if (!service.getSystemService(KeyguardManager::class.java).isKeyguardLocked) runCatching { vault.guard.observeUnlocked() }
    }

    fun wake() {
        service.startActivity(Intent(service, WakeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    private fun nodes(predicate: (AccessibilityNodeInfo) -> Boolean): List<AccessibilityNodeInfo> {
        val found = mutableListOf<AccessibilityNodeInfo>()
        var count = 0

        fun visit(
            node: AccessibilityNodeInfo?,
            depth: Int,
        ) {
            if (node == null || depth > 30 || count++ > 600) return
            if (node.isVisibleToUser && node.isEnabled && node.packageName?.toString() == "com.android.systemui" && predicate(node)) {
                found.add(
                    node,
                )
            }
            repeat(node.childCount) { visit(node.getChild(it), depth + 1) }
        }
        service.windows.forEach { visit(it.root, 0) }
        return found.distinct()
    }

    private fun key(name: String) = nodes { it.viewIdResourceName == "com.android.systemui:id/$name" }.singleOrNull()

    fun attempt(
        pin: CharArray,
        allowed: () -> Boolean,
        reply: (Int) -> Unit,
    ) {
        if (active) {
            pin.fill('\u0000')
            reply(6)
            return
        }
        val keyguard = service.getSystemService(KeyguardManager::class.java)
        if (!allowed() || !keyguard.isKeyguardLocked || !keyguard.isKeyguardSecure || pin.size !in 4..16 || pin.any { it !in '0'..'9' }) {
            pin.fill('\u0000')
            reply(4)
            return
        }
        if (vault.guard.blocked() || runCatching {
                service.getSystemService(DevicePolicyManager::class.java).getMaximumFailedPasswordsForWipe(null)
            }.getOrNull() != 0
        ) {
            pin.fill('\u0000')
            reply(9)
            return
        }
        active = true
        var finished = false

        fun finish(code: Int) {
            if (finished) return
            finished = true
            active = false
            pin.fill('\u0000')
            runCatching {
                if (code == 0) {
                    vault.guard.observeUnlocked()
                } else if (vault.guard.blocked()) {
                    vault.forget()
                }
            }
            reply(code)
        }
        val deadline = SystemClock.elapsedRealtime() + 6000
        var revealed = false

        fun observe(until: Long) {
            if (!allowed()) {
                finish(8)
                return
            }
            if (!keyguard.isKeyguardLocked) {
                finish(0)
                return
            }
            if (SystemClock.elapsedRealtime() >= until) {
                finish(9)
                return
            }
            main.postDelayed({ observe(until) }, 100)
        }

        fun submit(
            digits: List<AccessibilityNodeInfo>,
            enter: AccessibilityNodeInfo?,
            index: Int,
        ) {
            if (!allowed()) {
                finish(8)
                return
            }
            if (!keyguard.isKeyguardLocked) {
                finish(0)
                return
            }
            if (index == digits.size) {
                if (keyguard.isKeyguardLocked && enter != null &&
                    (!enter.refresh() || !enter.performAction(AccessibilityNodeInfo.ACTION_CLICK))
                ) {
                    finish(9)
                    return
                }
                observe(SystemClock.elapsedRealtime() + 3500)
            } else {
                val node = digits[index]
                if (!node.refresh() || !node.isVisibleToUser || !node.isEnabled ||
                    !node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                ) {
                    finish(9)
                    return
                }
                main.postDelayed({ submit(digits, enter, index + 1) }, 100)
            }
        }

        fun prepare() {
            if (!allowed()) {
                finish(8)
                return
            }
            val entry = key("pinEntry")
            if (entry == null) {
                if (SystemClock.elapsedRealtime() >= deadline) {
                    finish(4)
                    return
                }
                if (!revealed && SystemClock.elapsedRealtime() >= deadline - 4000) {
                    revealed = true
                    val bounds = service.getSystemService(WindowManager::class.java).maximumWindowMetrics.bounds
                    val path = Path().apply { moveTo(bounds.width() / 2f, bounds.height() * 0.4f) }
                    service.dispatchGesture(
                        GestureDescription.Builder()
                            .addStroke(GestureDescription.StrokeDescription(path, 0, 60)).build(),
                        null,
                        main,
                    )
                }
                main.postDelayed({ prepare() }, 150)
                return
            }
            if (!entry.isPassword || !entry.text.isNullOrEmpty()) {
                finish(4)
                return
            }
            val digits =
                pin.map { ch ->
                    key("key$ch")?.takeIf { it.isClickable && it.windowId == entry.windowId }
                        ?: nodes { it.isClickable && it.windowId == entry.windowId && it.text?.toString() == ch.toString() }.singleOrNull()
                }
            val enter = key("key_enter")
            if (digits.any { it == null } || (enter == null && pin.size < 6) || (enter != null && !enter.isClickable)) {
                finish(4)
                return
            }
            try {
                vault.guard.begin()
            } catch (_: Exception) {
                finish(9)
                return
            }
            submit(digits.filterNotNull(), enter, 0)
        }
        try {
            wake()
            main.postDelayed({ prepare() }, 300)
        } catch (_: Exception) {
            finish(4)
        }
    }
}
