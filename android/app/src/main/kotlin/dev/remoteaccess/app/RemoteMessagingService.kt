package dev.remoteaccess.app

import androidx.work.Data
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dev.remoteaccess.protocol.WakeHint

// Firebase 25.1 uses installation registration, rather than legacy token refresh.
@android.annotation.SuppressLint("MissingFirebaseInstanceTokenRefresh")
class RemoteMessagingService : FirebaseMessagingService() {
    override fun onRegistered(installationId: String) {
        if (!installationId.matches(Regex("[cdef][A-Za-z0-9_-]{21}"))) return
        WakeSupport.preferences(this).save { putString("fid", installationId) }
        if (WakeSupport.allowed(this)) WakeSupport.enqueue(this, Data.EMPTY, registration = true)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val hint = WakeHint.parse(message.data, System.currentTimeMillis()) ?: return
        if (!WakeSupport.allowed(this)) return
        // High priority wakes have a visible purpose; this grants no session authority.
        WakeSupport.notify(this, "Your browser is contacting this phone")
        WakeSupport.preferences(this).save { putLong("lastPushReceipt", System.currentTimeMillis()) }
        WakeSupport.enqueue(this, Data.Builder().putString("requestId", hint.requestId).putLong("expires", hint.expires).build())
    }
}
