package dev.remoteaccess.app

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.UserManager
import androidx.work.Data

/** Opt-in setup repair after credential-protected storage becomes available; never a boot unlock. */
class RestartRecovery : BroadcastReceiver() {
    override fun onReceive(
        context: Context,
        intent: Intent,
    ) {
        if (intent.action !in setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED) ||
            !enabled(context) || !context.getSystemService(UserManager::class.java).isUserUnlocked
        ) {
            return
        }
        // WorkManager owns bounded work beyond this broadcast. No socket/foreground service starts here.
        WakeSupport.enqueue(context, Data.EMPTY, registration = true)
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
                PackageManager.DONT_KILL_APP,
            )
        }
    }
}
