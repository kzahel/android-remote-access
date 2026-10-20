package dev.remoteaccess.app

import android.app.Application

class RemoteApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        WakeSupport.channels(this)
        WakeSupport.register(this)
    }
}
