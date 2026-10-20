package dev.remoteaccess.app

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Bounded native work: FCM receipt itself never establishes authority or keeps a socket alive. */
class WakeWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result {
        val preferences = WakeSupport.preferences(applicationContext)
        val removePush = inputData.getBoolean("removePush", false)
        if ((!removePush && !WakeSupport.allowed(applicationContext)) || preferences.getBoolean("revoked", false)) return Result.success()
        val saved = preferences.getString("grant", null) ?: return Result.success()
        val registration = inputData.getBoolean("registration", false)
        val expires = inputData.getLong("expires", 0)
        if (!registration && expires * 1000 <= System.currentTimeMillis()) return Result.success()
        val grant = JSONObject(saved)
        val done = CountDownLatch(1)
        val passed = AtomicBoolean(false)
        val expected =
            if (!registration) {
                "Encrypted connection passed"
            } else if (removePush) {
                "Remote wake disabled"
            } else {
                "Remote wake ready"
            }
        val current = {
            (removePush || WakeSupport.allowed(applicationContext)) &&
                preferences.getString("grant", null) == saved && !isStopped
        }
        val connection =
            RelayConnection(
                KeystoreIdentity.loadOrCreate("phone-identity-v1"),
                grant,
                { state ->
                    preferences.save { putString("wakeState", state) }
                    if (state == expected) {
                        passed.set(true)
                        done.countDown()
                    } else if (state.startsWith("Connection closed") || state.contains("rejected")) {
                        done.countDown()
                    }
                },
                fid = preferences.getString("fid", null),
                requestId = if (registration) null else inputData.getString("requestId"),
                registrationOnly = registration,
                removePush = removePush,
                current = current,
            )
        return try {
            connection.connect()
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(if (registration) 20 else 65)
            while (current() && System.nanoTime() < deadline && !done.await(100, TimeUnit.MILLISECONDS)) Unit
            if (!registration && passed.get()) {
                preferences.save { putLong("lastWakeExchange", System.currentTimeMillis()) }
                WakeSupport.notify(applicationContext, "Encrypted connection check passed")
            }
            // No unbounded retries; the owner can retry from the browser or reopen the app.
            if (registration && !passed.get()) {
                preferences.save { putString("wakeState", "Wake setup unavailable. Open the app to retry.") }
            }
            Result.success()
        } catch (_: Exception) {
            Result.failure()
        } finally {
            connection.close(graceful = passed.get())
        }
    }
}
