package dev.remoteaccess.app.control

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import dev.remoteaccess.app.HostRuntime
import dev.remoteaccess.app.HostSessions
import dev.remoteaccess.app.MainActivity
import dev.remoteaccess.app.WakeSupport

/** Visible, bounded remote-control session; no idle service or background keepalive. */
class SessionService : Service() {
    override fun onStartCommand(
        intent: Intent?,
        flags: Int,
        startId: Int,
    ): Int {
        if (intent?.action == "stop") {
            HostSessions.current.get()?.let { HostRuntime.disconnect(this, it.deviceId) }
            stopSelf()
            return START_NOT_STICKY
        }
        val notification = notification(this)
        if (android.os.Build.VERSION.SDK_INT >= 34) {
            startForeground(WakeSupport.CONTROL_NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(WakeSupport.CONTROL_NOTIFICATION, notification)
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        fun notification(context: Context): Notification {
            val stop =
                PendingIntent.getService(
                    context,
                    1,
                    Intent(context, SessionService::class.java).setAction("stop"),
                    PendingIntent.FLAG_IMMUTABLE,
                )
            val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
            return Notification.Builder(context, WakeSupport.CHANNEL).setSmallIcon(android.R.drawable.ic_lock_lock)
                .setContentTitle("Remote control connected").setContentText("A paired device can view and control this phone.")
                .setContentIntent(open).setOngoing(true).addAction(Notification.Action.Builder(null, "Disconnect", stop).build()).build()
        }

        fun start(context: Context) {
            WakeSupport.channels(context)
            context.startForegroundService(Intent(context, SessionService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, SessionService::class.java))
        }
    }
}
