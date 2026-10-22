package dev.remoteaccess.app

import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import androidx.work.WorkInfo
import androidx.work.WorkManager
import org.json.JSONObject
import org.junit.rules.TestWatcher
import org.junit.runner.Description
import java.io.File
import java.util.concurrent.TimeUnit

/** Only booleans, counts and fixed enums leave an owned fixture after failure. */
class FixtureFailureDiagnostics : TestWatcher() {
    override fun failed(
        e: Throwable,
        description: Description,
    ) {
        runCatching {
            val instrumentation = InstrumentationRegistry.getInstrumentation()
            val device = UiDevice.getInstance(instrumentation)
            if (device.executeShellCommand("getprop ro.kernel.qemu").trim() != "1") return
            val context = instrumentation.targetContext
            val snapshot = HostStore.get(context).load().snapshot
            val preferences = WakeSupport.preferences(context)
            val wakeState =
                when (preferences.getString("wakeState", null)) {
                    null -> "unset"
                    "Device settings synchronized" -> "synchronized"
                    "Wake registration unavailable. Retry in Settings." -> "registration-unavailable"
                    "Some device settings could not be synchronized. Retry in Settings." -> "sync-incomplete"
                    else -> "other"
                }
            val jobs =
                WorkManager
                    .getInstance(context)
                    .getWorkInfosForUniqueWork("register-push")
                    .get(3, TimeUnit.SECONDS)
            val result =
                JSONObject()
                    .put("armed", snapshot.settings.armed)
                    .put("automatic", snapshot.settings.automatic)
                    .put("notificationsAllowed", WakeSupport.notificationsAllowed(context))
                    .put("fidPresent", preferences.contains("fid"))
                    .put("devices", snapshot.devices.size)
                    .put("synced", snapshot.devices.count { it.synced })
                    .put("wakeReady", snapshot.devices.count { it.wakeReady })
                    .put("registrationRunning", jobs.count { it.state == WorkInfo.State.RUNNING })
                    .put("registrationQueued", jobs.count { it.state == WorkInfo.State.ENQUEUED || it.state == WorkInfo.State.BLOCKED })
                    .put("wakeState", wakeState)
            File(context.filesDir, "hosted-failure-state.json").writeText(result.toString())
        }
    }
}
