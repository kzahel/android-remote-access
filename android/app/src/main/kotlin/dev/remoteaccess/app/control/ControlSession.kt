package dev.remoteaccess.app.control

import android.app.KeyguardManager
import android.content.Context
import dev.remoteaccess.protocol.ControlCommand
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

/** One authenticated session owns one ordered command stream. Never retry input. */
internal class ControlSession(private val context: Context, private val current: () -> Boolean, private val send: (ByteArray) -> Unit) {
    private val active = AtomicBoolean(true)
    private val busy = AtomicBoolean(false)
    private var lastId = 0L

    fun receive(bytes: ByteArray) {
        check(active.get() && current())
        val command = ControlCommand.decode(bytes)
        check(command.id > lastId) // Record replay checks do not replace command ordering.
        lastId = command.id
        check(busy.compareAndSet(false, true))
        val replied = AtomicBoolean(false)
        val reply = { kind: Int, payload: ByteArray ->
            if (replied.compareAndSet(false, true)) {
                busy.set(false)
                if (active.get() && current()) send(ControlCommand.reply(command.id, kind, payload))
            }
        }
        if (command.op == 10) {
            val intent =
                android.content.Intent(android.content.Intent.ACTION_MAIN)
                    .addCategory(android.content.Intent.CATEGORY_LAUNCHER)
            val apps =
                context.packageManager.queryIntentActivities(intent, 0).distinctBy { it.activityInfo.packageName }
                    .map {
                        it.loadLabel(context.packageManager).toString().take(100) to it.activityInfo.packageName
                    }.sortedBy { it.first }.take(200)
            reply(
                4,
                org.json.JSONArray().apply {
                    apps.forEach { (name, pkg) -> put(JSONObject().put("name", name).put("packageName", pkg)) }
                }.toString().toByteArray(),
            )
        } else if (command.op == 1 || command.op == 2) {
            val state =
                ScreenAccessService.current?.state() ?: JSONObject().put("type", "state").put("v", 1)
                    .put("accessibility", false).put("locked", context.getSystemService(KeyguardManager::class.java).isKeyguardLocked)
                    .put("width", 0).put("height", 0).put("scene", 0)
            reply(1, state.toString().toByteArray())
        } else {
            val service = ScreenAccessService.current
            if (service == null) reply(2, byteArrayOf(1)) else service.execute(command, this, { active.get() && current() }, reply)
        }
    }

    fun close() {
        active.set(false)
        ScreenAccessService.current?.release(this)
    }
}
