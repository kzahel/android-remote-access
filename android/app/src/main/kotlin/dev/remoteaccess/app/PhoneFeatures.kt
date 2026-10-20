package dev.remoteaccess.app

import android.content.Context
import com.google.firebase.FirebaseApp
import org.json.JSONObject

/** Capability state is sent only inside an authenticated E2E session. */
internal object PhoneFeatures {
    fun report(context: Context): JSONObject {
        val state = HostStore.get(context).snapshot
        val requests =
            when {
                !state.settings.automatic -> "off"
                FirebaseApp.getApps(context).isEmpty() -> "unavailable"
                !WakeSupport.notificationsAllowed(context) -> "notifications-needed"
                state.browsers.any { !it.revoked && it.enabled && !it.wakeReady } -> "setup-needed"
                else -> "enabled"
            }
        return JSONObject().put("type", "features").put("v", 1)
            .put("screenViewing", "unavailable").put("touchControl", "unavailable")
            .put("connectionRequests", requests)
    }
}
