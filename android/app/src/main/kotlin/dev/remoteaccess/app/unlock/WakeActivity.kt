package dev.remoteaccess.app.unlock

import android.app.Activity
import android.app.KeyguardManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper

/** Android's ordinary wake/dismiss APIs. A secure keyguard still needs its credential. */
class WakeActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setTurnScreenOn(true)
        setShowWhenLocked(true)
        getSystemService(KeyguardManager::class.java).requestDismissKeyguard(this, null)
        Handler(Looper.getMainLooper()).postDelayed({ finish() }, 3000)
    }
}
