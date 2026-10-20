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
        setContentView(
            android.widget.TextView(this).apply {
                setText(dev.remoteaccess.app.R.string.remote_access_requested)
                textSize = 22f
                setPadding(40, 80, 40, 20)
            },
        )
        val main = Handler(Looper.getMainLooper())
        main.postDelayed({
            if (!isFinishing) {
                getSystemService(KeyguardManager::class.java).requestDismissKeyguard(
                    this,
                    object : KeyguardManager.KeyguardDismissCallback() {
                        override fun onDismissSucceeded() {
                            finish()
                        }

                        override fun onDismissCancelled() {
                            finish()
                        }

                        override fun onDismissError() {
                            finish()
                        }
                    },
                )
            }
        }, 250)
        main.postDelayed({ finish() }, 12000)
    }
}
