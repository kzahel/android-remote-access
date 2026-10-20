package dev.remoteaccess.app

import android.app.Application

class RemoteApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        WakeSupport.channels(this)
        HostRuntime.io.execute {
            HostStore.get(this).load()
            WakeSupport.register(this)
            WakeSupport.enqueue(this, androidx.work.Data.EMPTY, registration = true)
        }
    }
}
