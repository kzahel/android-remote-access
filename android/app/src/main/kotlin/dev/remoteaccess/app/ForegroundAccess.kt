package dev.remoteaccess.app

import android.content.Context
import android.os.Handler
import android.os.Looper
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/** Visible-app reachability needs no notification, accessibility or capture permission. */
internal object ForegroundAccess {
    private class Entry(val browser: Browser) {
        val active = AtomicBoolean(true)
        lateinit var connection: RelayConnection

        @Volatile var ready = false

        @Volatile var lease: HostSessions.Lease? = null

        @Volatile var expires = Long.MAX_VALUE

        @Volatile var passed = false
    }

    private val entries = ConcurrentHashMap<String, Entry>()
    private val owners = mutableSetOf<Any>()
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var store: HostStore
    private lateinit var app: android.app.Application
    private val retryAfter = mutableMapOf<String, Long>()

    @Volatile private var visible = false
    private val retry = Runnable { HostRuntime.io.execute { reconcile() } }
    private val listener: () -> Unit = { HostRuntime.io.execute { reconcile() } }

    fun start(
        context: Context,
        owner: Any,
    ) {
        val application = context.applicationContext as android.app.Application
        HostRuntime.io.execute {
            synchronized(this) {
                app = application
                store = HostStore.get(app).load()
                if (owners.isEmpty()) store.listeners.add(listener)
                owners.add(owner)
                visible = true
                reconcile()
            }
        }
    }

    fun stop(owner: Any) {
        HostRuntime.io.execute {
            synchronized(this) {
                owners.remove(owner)
                visible = owners.isNotEmpty()
                if (!visible) {
                    handler.removeCallbacks(retry)
                    store.listeners.remove(listener)
                    entries.values.toList().forEach { end(it) }
                    retryAfter.clear()
                }
            }
        }
    }

    fun listening(id: String): Boolean = entries[id]?.let { it.active.get() && it.ready } == true

    @Synchronized
    fun acquireWorker(browser: Browser): HostSessions.Lease? {
        val entry = entries[browser.id]
        if (entry?.lease != null) return null
        if (entry != null) end(entry)
        return HostSessions.acquire(browser)
    }

    @Synchronized
    fun disconnect(id: String) {
        entries[id]?.let { end(it) }
        schedule(500)
    }

    private fun valid(entry: Entry): Boolean =
        visible && entry.active.get() && store.allowed(entry.browser.id, entry.browser.generation) &&
            (entry.lease?.active?.get() != false) && System.currentTimeMillis() < entry.expires

    @Synchronized
    private fun admit(entry: Entry): Boolean {
        if (!valid(entry)) return false
        val lease = HostSessions.acquire(entry.browser) ?: return false
        entry.lease = lease
        lease.connection = entry.connection
        entry.expires = System.currentTimeMillis() + 65000
        store.record("Connection requested", entry.browser.id)
        handler.postDelayed({
            HostRuntime.io.execute {
                synchronized(this) {
                    if (entries[entry.browser.id] === entry) {
                        end(entry)
                        reconcile()
                    }
                }
            }
        }, 65000)
        return true
    }

    @Synchronized
    private fun reconcile() {
        if (!visible) return
        entries.values.toList().filter { !valid(it) }.forEach { end(it) }
        var delay = Long.MAX_VALUE
        for (browser in store.snapshot.browsers) {
            if (!browser.synced || !store.allowed(browser.id, browser.generation) || entries.containsKey(browser.id)) continue
            if (HostSessions.current.get()?.browserId == browser.id) continue
            val remaining = (retryAfter[browser.id] ?: 0) - System.currentTimeMillis()
            if (remaining > 0) {
                delay = minOf(delay, remaining)
                continue
            }
            val entry = Entry(browser)
            entries[browser.id] = entry
            entry.connection =
                RelayConnection(
                    KeystoreIdentity.loadOrCreate("phone-identity-v1"), browser.authority(),
                    { state -> HostRuntime.io.execute { report(entry, state) } },
                    accessGeneration = browser.generation,
                    current = { valid(entry) }, admit = { admit(entry) },
                    features = { PhoneFeatures.report(app) },
                )
            entry.connection.connect()
        }
        if (delay != Long.MAX_VALUE) schedule(delay)
    }

    @Synchronized
    private fun report(
        entry: Entry,
        state: String,
    ) {
        if (entries[entry.browser.id] !== entry || !entry.active.get()) return
        entry.lease?.status = state
        when (state) {
            "Waiting for your browser" -> entry.ready = true
            "Encrypted session established" -> store.connected(entry.browser.id)
            "Encrypted connection passed" -> {
                entry.passed = true
                store.record("Connection check completed", entry.browser.id)
                handler.postDelayed({
                    HostRuntime.io.execute {
                        synchronized(this) {
                            if (entries[entry.browser.id] === entry) {
                                end(entry, graceful = true)
                                reconcile()
                            }
                        }
                    }
                }, 1000)
            }
            else ->
                if (state.startsWith("Connection closed") || state.contains("rejected")) {
                    end(entry, reconnectDelay = if (entry.passed) 500 else 5000)
                    schedule(if (entry.passed) 500 else 5000)
                }
        }
        store.listeners.forEach { it() }
    }

    private fun end(
        entry: Entry,
        graceful: Boolean = false,
        reconnectDelay: Long = 500,
    ) {
        if (!entry.active.compareAndSet(true, false)) return
        entries.remove(entry.browser.id, entry)
        retryAfter[entry.browser.id] = System.currentTimeMillis() + reconnectDelay
        entry.connection.close(graceful)
        entry.lease?.let {
            HostSessions.release(it)
            store.record("Connection ended", entry.browser.id)
        }
    }

    private fun schedule(delay: Long) {
        if (visible) {
            handler.removeCallbacks(retry)
            handler.postDelayed(retry, delay)
        }
    }
}
