package dev.remoteaccess.app

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.UserManager
import androidx.work.Data

/** Opt-in setup repair after credential-protected storage becomes available; never a boot unlock. */
class RestartRecovery : BroadcastReceiver() {
    override fun onReceive(
        context: Context,
        intent: Intent,
    ) {
        if (intent.action !in setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED) ||
            !enabled(context) ||
            !context.getSystemService(UserManager::class.java).isUserUnlocked
        ) {
            return
        }
        val pending = goAsync()
        HostRuntime.io.execute {
            try {
                HostStore.get(context).load().record(
                    if (intent.action == Intent.ACTION_BOOT_COMPLETED) "Setup restored after restart" else "Setup restored after update",
                )
                // WorkManager owns bounded work beyond this broadcast. No socket/foreground service starts here.
                WakeSupport.enqueue(context, Data.EMPTY, registration = true)
                WakeSupport.preferences(context).save { putLong("lastRestartRecovery", System.currentTimeMillis()) }
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        private fun component(context: Context) = ComponentName(context, RestartRecovery::class.java)

        fun enabled(context: Context) =
            context.packageManager.getComponentEnabledSetting(component(context)) ==
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED

        fun setEnabled(
            context: Context,
            enabled: Boolean,
        ) {
            context.packageManager.setComponentEnabledSetting(
                component(context),
                if (enabled) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP or if (Build.VERSION.SDK_INT >= 33) PackageManager.SYNCHRONOUS else 0,
            )
        }
    }
}
