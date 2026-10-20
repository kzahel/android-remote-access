package dev.remoteaccess.app

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Bounded work. Neither push receipt nor relay policy establishes endpoint authority. */
class WakeWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result {
        val store = HostStore.get(applicationContext).load()
        if (inputData.getBoolean("registration", false)) return synchronize(store)
        val id = inputData.getString("pairingId") ?: return Result.success()
        val generation = inputData.getString("generation") ?: return Result.success()
        val automatic = !inputData.getBoolean("manual", false)
        val expires = inputData.getLong("expires", 0)
        if (automatic && inputData.getString("requestId")?.matches(Regex("[0-9a-f]{32}")) != true) return Result.success()
        val browser = store.browser(id) ?: return Result.success()
        if (!store.allowed(id, generation, automatic) || expires <= System.currentTimeMillis() / 1000) return Result.success()
        if (automatic && !WakeSupport.notificationsAllowed(applicationContext)) return Result.success()
        // Synchronize policy before the advanced manual fallback opens a session.
        if (!browser.synced && !syncBrowser(store, browser)) return Result.success()
        val lease = ForegroundAccess.acquireWorker(browser)
        if (lease == null) {
            store.record("Session blocked: phone busy", id)
            return Result.success()
        }
        val done = CountDownLatch(1)
        val viewerClosed = CountDownLatch(1)
        val passed = AtomicBoolean(false)
        val current = {
            lease.active.get() && !isStopped && store.allowed(id, generation, automatic) &&
                (!automatic || WakeSupport.notificationsAllowed(applicationContext)) && expires > System.currentTimeMillis() / 1000
        }
        val connection =
            RelayConnection(
                KeystoreIdentity.loadOrCreate("phone-identity-v1"),
                browser.authority(),
                { state ->
                    lease.status = state
                    if (current()) {
                        when (state) {
                            "Encrypted session established" -> store.connected(id)
                            "Encrypted connection passed" -> {
                                passed.set(true)
                                store.record("Connection check completed", id)
                                done.countDown()
                            }
                            else ->
                                if (state.startsWith("Connection closed") || state.contains("rejected")) {
                                    viewerClosed.countDown()
                                    done.countDown()
                                }
                        }
                        store.listeners.forEach { it() }
                    }
                },
                requestId = if (automatic) inputData.getString("requestId") else null,
                accessGeneration = generation,
                current = current,
                features = { PhoneFeatures.report(applicationContext) },
            )
        lease.connection = connection
        return try {
            if (!current()) return Result.success()
            store.record("Connection requested", id)
            connection.connect()
            while (current() && !done.await(100, TimeUnit.MILLISECONDS)) Unit
            if (passed.get()) {
                WakeSupport.preferences(applicationContext).save { putLong("lastWakeExchange", System.currentTimeMillis()) }
                if (automatic) WakeSupport.notify(applicationContext, "Secure connection verified")
                // Let the viewer consume the optional feature report before graceful teardown.
                viewerClosed.await(1000, TimeUnit.MILLISECONDS)
            } else if (current()) {
                store.record("Connection failed", id)
            }
            Result.success()
        } finally {
            connection.close(graceful = passed.get())
            HostSessions.release(lease)
            store.record("Connection ended", id)
        }
    }

    private fun synchronize(store: HostStore): Result {
        var failed = false
        for (browser in store.snapshot.browsers) {
            if (isStopped) break
            if (browser.revoked) {
                try {
                    val grant = browser.authority()
                    val identity = KeystoreIdentity.loadOrCreate("phone-identity-v1")
                    val signature = identity.sign(fields("ara/pair/revoke/v1", grant.getString("origin"), browser.id))
                    request(grant.getString("origin"), browser.id, "revoke", org.json.JSONObject().put("signature", encoded(signature)))
                    store.removed(browser.id)
                } catch (_: Exception) {
                    failed = true
                }
            } else if (!syncBrowser(store, browser)) {
                failed = true
            }
        }
        WakeSupport.preferences(applicationContext).save {
            putString(
                "wakeState",
                if (failed) "Some browser settings could not be synchronized. Retry in Settings." else "Browser settings synchronized",
            )
        }
        store.listeners.forEach { it() }
        return Result.success()
    }

    private fun syncBrowser(
        store: HostStore,
        browser: Browser,
    ): Boolean {
        val preferences = WakeSupport.preferences(applicationContext)
        val enabled = store.allowed(browser.id, browser.generation)
        val push = enabled && store.snapshot.settings.automatic && WakeSupport.notificationsAllowed(applicationContext)
        val fid = if (push) preferences.getString("fid", null) else null
        val expected = if (fid != null) "Remote wake ready" else "Remote wake disabled"
        val done = CountDownLatch(1)
        val passed = AtomicBoolean(false)
        val current = { !isStopped && store.browser(browser.id)?.let { !it.revoked && it.generation == browser.generation } == true }
        val connection =
            RelayConnection(
                KeystoreIdentity.loadOrCreate("phone-identity-v1"), browser.authority(),
                { state ->
                    if (state == expected) {
                        passed.set(true)
                        done.countDown()
                    } else if (state.startsWith("Connection closed") || state.contains("rejected")) {
                        done.countDown()
                    }
                },
                fid = fid, registrationOnly = true, removePush = fid == null,
                accessGeneration = browser.generation, accessEnabled = enabled, current = current,
            )
        return try {
            connection.connect()
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
            while (current() && System.nanoTime() < deadline && !done.await(100, TimeUnit.MILLISECONDS)) Unit
            if (passed.get() && current()) {
                store.synced(browser.id, browser.generation, wakeReady = fid != null)
            } else {
                store.record("Wake setup failed", browser.id)
            }
            passed.get() && current()
        } catch (_: Exception) {
            store.record("Wake setup failed", browser.id)
            false
        } finally {
            connection.close(graceful = passed.get())
        }
    }
}
