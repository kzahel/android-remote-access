package dev.remoteaccess.app

import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.View
import android.view.WindowInsets
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import java.text.DateFormat
import java.util.Date

/** Plain native management UI. Authority and sessions belong to the application, not this activity. */
class MainActivity : ComponentActivity() {
    private val store by lazy { HostStore.get(this) }
    private var page = "home"
    private var browserId: String? = null
    private var pending: Enrollment? = null
    private var notice: String? = null
    private var busy = false
    private var changing = false
    private var loaded = false
    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            HostRuntime.io.execute {
                WakeSupport.register(this)
                WakeSupport.enqueue(this, androidx.work.Data.EMPTY, registration = true)
            }
            render()
        }
    private var listening = false
    private var activityLimit = 200
    private val handler = Handler(Looper.getMainLooper())
    private val refresh = Runnable { if (listening && loaded) render() }
    private val listener: () -> Unit = {
        handler.removeCallbacks(refresh)
        handler.postDelayed(refresh, 150)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (page == "home") finish() else navigate("home")
                }
            },
        )
        page = savedInstanceState?.getString("page") ?: "home"
        browserId = savedInstanceState?.getString("browserId")
        if (page == "grant") page = "home" // Never persist QR secrets in activity state.
        HostRuntime.io.execute {
            store.load()
            runOnUiThread {
                loaded = true
                intent.dataString?.let { showInvitation(it) } ?: render()
            }
        }
        render()
    }

    override fun onStart() {
        super.onStart()
        listening = true
        store.listeners.add(listener)
        if (loaded) render()
    }

    override fun onStop() {
        listening = false
        handler.removeCallbacks(refresh)
        store.listeners.remove(listener)
        super.onStop()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.dataString?.let { showInvitation(it) }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString("page", page)
        outState.putString("browserId", browserId)
        super.onSaveInstanceState(outState)
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private fun navigate(
        value: String,
        id: String? = null,
    ) {
        page = value
        browserId = id
        notice = null
        if (value != "grant") pending = null
        render()
    }

    private fun render() {
        if (isDestroyed || isFinishing) return
        val layout =
            LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(20), dp(12), dp(20), dp(24))
            }
        val scroll =
            ScrollView(this).apply {
                isFillViewport = true
                addView(layout)
                setOnApplyWindowInsetsListener { view, insets ->
                    val bars = insets.getInsets(WindowInsets.Type.systemBars())
                    view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                    insets
                }
            }
        setContentView(scroll)
        if (page != "home") button(layout, "Back", R.id.navigate_back) { navigate("home") }
        text(
            layout,
            when (page) {
                "settings" -> "Settings"
                "activity" -> "Activity"
                "browser" -> "Browser"
                "grant" -> "Pair browser"
                else -> "Remote access"
            },
            26f,
        )
        if (!loaded) {
            text(layout, "Loading…")
            return
        }
        notice?.let { text(layout, it, 16f).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE } }
        when (page) {
            "settings" -> settings(layout)
            "activity" -> activity(layout)
            "browser" -> browser(layout)
            "grant" -> invitation(layout)
            else -> home(layout)
        }
    }

    private fun home(layout: LinearLayout) {
        val state = store.snapshot
        toggle(layout, "Remote access", state.settings.armed, R.id.access_toggle) { enabled ->
            change { it.settings(armed = enabled) }
        }
        val live = HostSessions.current.get()
        val browsers = state.browsers.filter { !it.revoked }
        val status =
            when {
                !state.settings.armed -> "Off · Paired browsers cannot connect"
                browsers.isEmpty() -> "Pair a browser to get started"
                live != null -> "${store.browser(live.browserId)?.nickname ?: "Browser"} · ${live.status}"
                browsers.none { it.enabled } -> "No browsers allowed · Enable one below"
                !state.settings.automatic -> "On · Automatic requests are off"
                com.google.firebase.FirebaseApp.getApps(this).isEmpty() -> "Remote wake is not configured in this build"
                !WakeSupport.notificationsAllowed(this) -> "Notification permission needed · Open Settings"
                browsers.any { it.enabled && !it.wakeReady } -> "Wake setup incomplete · Open Settings"
                else -> "Ready for connection requests"
            }
        text(layout, status, 18f).apply {
            id = R.id.host_status
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        text(layout, getString(R.string.development_description), 14f)
        text(layout, "Paired browsers", 20f)
        if (state.browsers.isEmpty()) text(layout, "No paired browsers yet.")
        state.browsers.forEach { browser ->
            val summary =
                when {
                    browser.revoked -> "Removed locally · Cleanup pending"
                    !browser.enabled -> "Disabled"
                    !state.settings.armed -> "Allowed · Remote access is off"
                    live?.browserId == browser.id -> "Connected or connecting"
                    else -> "Allowed · ${lastConnected(browser)}"
                }
            button(layout, "${browser.nickname}\n$summary") { navigate("browser", browser.id) }
        }
        button(layout, getString(R.string.pair_browser), R.id.pair_browser) {
            GmsBarcodeScanning.getClient(this).startScan().addOnSuccessListener { code ->
                showInvitation(code.rawValue ?: "")
            }.addOnFailureListener {
                notice = "Scanner unavailable. Try again when Play services is ready."
                render()
            }
        }
        val row = LinearLayout(this)
        layout.addView(row)
        button(row, "Activity", R.id.open_activity) { navigate("activity") }
        button(row, "Settings", R.id.open_settings) { navigate("settings") }
    }

    private fun settings(layout: LinearLayout) {
        toggle(layout, "Connect when requested", store.snapshot.settings.automatic, R.id.enable_wake) { enabled ->
            if (enabled && Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
            ) {
                notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                change { it.settings(automatic = true) }
            } else {
                change { it.settings(automatic = enabled) }
            }
        }
        text(
            layout,
            "Let paired browsers contact this phone while the app is closed. Delivery depends on Android and network availability.",
            14f,
        )
        text(
            layout,
            if (WakeSupport.notificationsAllowed(
                    this,
                )
            ) {
                "Connection notifications allowed"
            } else {
                "Allow connection notifications to receive requests"
            },
        )
        button(layout, "Notification settings", R.id.notification_settings) {
            startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
        }
        button(layout, "Retry setup", R.id.retry_setup) {
            HostRuntime.io.execute {
                WakeSupport.register(this)
                WakeSupport.enqueue(this, androidx.work.Data.EMPTY, registration = true)
            }
            notice = "Retrying browser settings and wake setup…"
            render()
        }
        if (com.google.firebase.FirebaseApp.getApps(this).isEmpty()) text(layout, "Remote wake is not configured in this build.", 14f)
        store.snapshot.browsers.filter { !it.revoked }.forEach {
            text(
                layout,
                "${it.nickname}: ${if (!it.synced) {
                    "Settings not synchronized"
                } else if (it.wakeReady) {
                    "Automatic requests ready"
                } else {
                    "Automatic requests unavailable or off"
                }}",
                14f,
            )
        }
        text(layout, "Android Remote Access ${BuildConfig.VERSION_NAME}", 14f)
        text(
            layout,
            "After a restart, unlock the phone locally once. Activity is stored only on this phone for up to 30 days or 10,000 entries.",
            14f,
        )
    }

    private fun browser(layout: LinearLayout) {
        val browser =
            browserId?.let(store::browser) ?: run {
                text(layout, "Browser removed")
                return
            }
        text(layout, browser.nickname, 22f)
        text(layout, "Paired ${time(browser.pairedAt)}\n${lastConnected(browser)}", 14f)
        text(layout, "Paired through ${browser.authority().getString("origin")}", 14f)
        if (browser.revoked) {
            text(layout, "Access is blocked on this phone. Relay removal is pending.")
            button(layout, "Retry removal", R.id.remove_browser) { change { } }
            return
        }
        toggle(layout, "Allow this browser", browser.enabled, R.id.browser_toggle) { enabled -> change { it.enable(browser.id, enabled) } }
        button(layout, "Rename", R.id.rename_browser) {
            val input =
                EditText(this).apply {
                    setText(browser.nickname)
                    isSingleLine = true
                    filters = arrayOf(android.text.InputFilter.LengthFilter(60))
                }
            AlertDialog.Builder(this).setTitle("Browser nickname").setView(input).setNegativeButton("Cancel", null)
                .setPositiveButton("Save") { _, _ -> perform { store.rename(browser.id, input.text.toString()) } }.show()
        }
        val live = HostSessions.current.get()
        text(layout, if (live?.browserId == browser.id) live.status else "No active session")
        val disconnect = button(layout, "Disconnect", R.id.disconnect_browser) { HostRuntime.disconnect(this, browser.id) }
        disconnect.isEnabled = live?.browserId == browser.id
        button(layout, getString(R.string.connect_phone), R.id.connect_phone) {
            HostRuntime.connect(this, browser.id)
        }.isEnabled = store.allowed(browser.id, browser.generation) && live == null
        text(layout, "Development fallback: opens a connection for up to one minute so this browser can run a check.", 14f)
        button(layout, getString(R.string.remove_browser), R.id.remove_browser) {
            AlertDialog.Builder(
                this,
            ).setTitle("Remove ${browser.nickname}?").setMessage("Its access will be revoked. To connect again, pair this browser again.")
                .setNegativeButton("Cancel", null).setPositiveButton("Remove") { _, _ -> change { it.revoke(browser.id) } }.show()
        }
    }

    private fun activity(layout: LinearLayout) {
        text(layout, "Recent activity · Stored on this phone", 14f)
        val container = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        layout.addView(container)
        HostRuntime.io.execute {
            val events = store.events(activityLimit)
            runOnUiThread {
                if (isDestroyed || page != "activity" || !container.isAttachedToWindow) return@runOnUiThread
                if (events.isEmpty()) text(container, "No activity yet.")
                events.forEach { event ->
                    text(container, event.kind, 16f)
                    text(container, "${time(event.at)}${event.browserName?.let { " · $it" } ?: ""}", 14f)
                }
                if (events.size == activityLimit && activityLimit < 10000) {
                    button(container, "Show older activity") {
                        activityLimit = (activityLimit + 200).coerceAtMost(10000)
                        render()
                    }
                }
            }
        }
    }

    private fun showInvitation(uri: String) {
        try {
            check(!busy)
            pending = Enrollment(uri)
            page = "grant"
            notice = null
            render()
        } catch (_: Exception) {
            notice = "Invalid or expired pairing code. Create a new code in your browser."
            render()
        }
    }

    private fun invitation(layout: LinearLayout) {
        val invitation =
            pending ?: run {
                navigate("home")
                return
            }
        text(layout, "Grant this browser access through ${invitation.origin}?")
        text(
            layout,
            "Only continue if you opened this pairing code yourself. You can rename, disable or remove this browser afterward.",
            14f,
        )
        button(layout, getString(R.string.grant_browser), R.id.grant_browser) {
            perform(network = true) {
                val accepted = invitation.grant(KeystoreIdentity.loadOrCreate("phone-identity-v1"))
                store.pair(accepted)
                WakeSupport.enqueue(this, androidx.work.Data.EMPTY, registration = true)
                runOnUiThread {
                    pending = null
                    page = "home"
                    notice = "Browser paired"
                }
            }
        }
        button(layout, "Cancel") { navigate("home") }
    }

    private fun change(work: (HostStore) -> Unit) {
        if (changing) return
        changing = true
        notice = null
        render()
        HostRuntime.change(this, work, finished = { saved ->
            runOnUiThread {
                changing = false
                if (!saved) notice = "Couldn’t save the change. Check the current access setting and try again."
                render()
            }
        })
    }

    private fun perform(
        network: Boolean = false,
        work: () -> Unit,
    ) {
        if (busy) return
        busy = true
        render()
        (if (network) HostRuntime.network else HostRuntime.io).execute {
            try {
                work()
            } catch (
                _: Exception,
            ) {
                runOnUiThread { notice = "Couldn’t complete the action. Check your connection and try again." }
            } finally {
                runOnUiThread {
                    busy = false
                    render()
                }
            }
        }
    }

    private fun text(
        layout: LinearLayout,
        value: String,
        size: Float = 16f,
    ): TextView =
        TextView(this).apply {
            text = value
            textSize = size
            setPadding(0, dp(7), 0, dp(7))
            layout.addView(this)
        }

    private fun button(
        layout: LinearLayout,
        label: String,
        resource: Int = View.NO_ID,
        action: () -> Unit,
    ): Button =
        Button(this).apply {
            id = resource
            text = label
            isAllCaps = false
            isEnabled = !busy || resource == R.id.navigate_back
            setOnClickListener { action() }
            layout.addView(this, LinearLayout.LayoutParams(if (layout.orientation == LinearLayout.VERTICAL) -1 else -2, -2))
        }

    private fun toggle(
        layout: LinearLayout,
        label: String,
        checked: Boolean,
        resource: Int,
        action: (Boolean) -> Unit,
    ) {
        layout.addView(
            Switch(this).apply {
                id = resource
                text = label
                textSize = 18f
                minHeight = dp(56)
                isChecked = checked
                isEnabled = loaded && !changing && (!busy || resource == R.id.access_toggle)
                setOnCheckedChangeListener { _, enabled -> action(enabled) }
            },
            LinearLayout.LayoutParams(-1, -2),
        )
    }

    private fun time(value: Long) = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(value))

    private fun lastConnected(browser: Browser) =
        if (browser.lastConnected == 0L) {
            "Never connected"
        } else {
            "Last connected ${time(
                browser.lastConnected,
            )}"
        }
}
