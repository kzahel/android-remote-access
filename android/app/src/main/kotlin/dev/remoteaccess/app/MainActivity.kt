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
import androidx.core.content.IntentCompat
import androidx.core.content.PackageManagerCompat
import androidx.core.content.UnusedAppRestrictionsConstants
import androidx.core.net.toUri
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import java.text.DateFormat
import java.util.Date

/** Plain native management UI. Authority and sessions belong to the application, not this activity. */
class MainActivity : ComponentActivity() {
    private val store by lazy { HostStore.get(this) }
    private var page = "home"
    private var browserId: String? = null
    private var pending: Enrollment? = null
    private var sharingDialog: AlertDialog? = null
    private val foregroundOwner = Any()
    private var notice: String? = null
    private var busy = false
    private var changing = false
    private var loaded = false
    private var lastNotificationsAllowed: Boolean? = null
    private var unusedRestrictions: Int? = null
    private var readinessRequest = 0
    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            refreshSystemReadiness()
        }
    private val unusedAppSettings =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
            refreshSystemReadiness()
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
                refreshSystemReadiness()
                if (intent.dataString == null && savedInstanceState?.getBoolean("sharing") == true) showSharingSetup()
            }
        }
        render()
    }

    override fun onStart() {
        super.onStart()
        listening = true
        store.listeners.add(listener)
        ForegroundAccess.start(this, foregroundOwner)
        if (loaded) render()
    }

    override fun onResume() {
        super.onResume()
        if (loaded) refreshSystemReadiness()
    }

    private fun refreshSystemReadiness() {
        val allowed = WakeSupport.notificationsAllowed(this)
        if (lastNotificationsAllowed != allowed) {
            lastNotificationsAllowed = allowed
            val app = applicationContext
            HostRuntime.io.execute {
                WakeSupport.register(app)
                WakeSupport.enqueue(app, androidx.work.Data.EMPTY, registration = true)
            }
        }
        render()
        val request = ++readinessRequest
        val future = PackageManagerCompat.getUnusedAppRestrictionsStatus(applicationContext)
        future.addListener({
            val status =
                try {
                    future.get()
                } catch (_: Exception) {
                    UnusedAppRestrictionsConstants.ERROR
                }
            runOnUiThread {
                if (isDestroyed || request != readinessRequest) return@runOnUiThread
                if (unusedRestrictions != status) {
                    unusedRestrictions = status
                    if (listening) render()
                }
            }
        }, HostRuntime.io)
    }

    private fun openNotificationSettings() {
        startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
    }

    private fun sessionStatus(status: String): String =
        when (status) {
            "Connecting", "Browser connected; securing session" -> "Connecting…"
            "Waiting for your browser" -> "Waiting for browser"
            "Encrypted session established" -> "Connected securely"
            "Encrypted connection passed" -> "Connection verified"
            "Remote control connected" -> "Viewing and control connected"
            else -> "Connection ended"
        }

    override fun onStop() {
        listening = false
        handler.removeCallbacks(refresh)
        store.listeners.remove(listener)
        ForegroundAccess.stop(foregroundOwner)
        super.onStop()
    }

    override fun onDestroy() {
        sharingDialog?.dismiss()
        super.onDestroy()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        sharingDialog?.dismiss()
        intent.dataString?.let { showInvitation(it) }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString("page", page)
        outState.putString("browserId", browserId)
        outState.putBoolean("sharing", sharingDialog?.isShowing == true)
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
        val lightBars =
            android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
        window.insetsController?.setSystemBarsAppearance(lightBars, lightBars)
        if (page != "home") button(layout, "Back", R.id.navigate_back) { navigate("home") }
        text(
            layout,
            when (page) {
                "settings" -> "Settings"
                "features" -> "Enable features"
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
            "features" -> features(layout)
            "activity" -> activity(layout)
            "browser" -> browser(layout)
            "grant" -> invitation(layout)
            else -> home(layout)
        }
    }

    private fun home(layout: LinearLayout) {
        val state = store.snapshot
        toggle(layout, "Allow remote access", state.settings.armed, R.id.access_toggle) { enabled ->
            change { it.settings(armed = enabled) }
        }
        val live = HostSessions.current.get()
        val browsers = state.browsers.filter { !it.revoked }
        val status =
            when {
                !state.settings.armed -> "Off · Paired browsers cannot connect"
                browsers.isEmpty() -> "Pair a browser to get started"
                live != null -> "${store.browser(live.browserId)?.nickname ?: "Browser"} · ${sessionStatus(live.status)}"
                browsers.none { it.enabled } -> "No browsers allowed · Enable one below"
                !state.settings.automatic ->
                    if (browsers.any { ForegroundAccess.listening(it.id) }) "Available while this app is open" else "Paired · Connecting…"
                com.google.firebase.FirebaseApp.getApps(this).isEmpty() -> "Connection setup unavailable"
                !WakeSupport.notificationsAllowed(this) -> "Notifications are off · Enable them to receive requests"
                browsers.any { it.enabled && (!it.synced || !it.wakeReady) } -> "Connection setup needs attention"
                else -> "Ready for connection requests"
            }
        text(layout, status, 18f).apply {
            id = R.id.host_status
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        if (state.settings.armed && browsers.any { it.enabled } && live == null &&
            (
                !state.settings.automatic || !WakeSupport.notificationsAllowed(this) ||
                    browsers.any { it.enabled && (!it.synced || !it.wakeReady) }
            )
        ) {
            button(layout, "Finish setup", R.id.review_settings) { navigate("features") }
        }
        if (state.browsers.isNotEmpty()) text(layout, "Paired browsers", 20f)
        state.browsers.forEach { browser ->
            val summary =
                when {
                    browser.revoked -> "Access removed · Finishing removal"
                    !browser.enabled -> "Disabled"
                    !state.settings.armed -> "Allowed · Remote access is off"
                    live?.browserId == browser.id -> sessionStatus(live.status)
                    else -> "Allowed · ${lastConnected(browser)}"
                }
            button(layout, "${browser.nickname}\n$summary") { navigate("browser", browser.id) }
        }
        button(layout, if (browsers.isEmpty()) "Set up sharing" else "Add browser", R.id.pair_browser) { showSharingSetup() }
        if (browsers.isNotEmpty()) button(layout, "How to connect", R.id.how_to_connect) { showSharingSetup() }
        val row = LinearLayout(this)
        layout.addView(row)
        button(row, "Activity", R.id.open_activity) { navigate("activity") }
        button(row, "Settings", R.id.open_settings) { navigate("settings") }
    }

    private fun showSharingSetup() {
        if (sharingDialog?.isShowing == true) return
        sharingDialog = SharingSetup.show(this, store.snapshot.browsers.none { !it.revoked }) { scanPairingCode() }
    }

    private fun scanPairingCode() {
        GmsBarcodeScanning.getClient(this).startScan().addOnSuccessListener { code ->
            showInvitation(code.rawValue ?: "")
        }.addOnFailureListener {
            notice = "Couldn’t open the scanner. Check that Google Play services is up to date and try again."
            render()
        }
    }

    private fun features(layout: LinearLayout) {
        text(
            layout,
            if (store.snapshot.browsers.any { !it.revoked }) {
                "Pairing is complete. Choose the features you want to use. You can change these later."
            } else {
                "Choose the features you want to use. Pair a browser whenever you’re ready."
            },
            14f,
        )
        text(layout, "Connection requests", 20f)
        connectionRequests(layout)
        text(layout, "Screen viewing and touch", 20f)
        text(
            layout,
            "See this phone’s screen and control it from a paired browser. " +
                "Android uses one accessibility permission for these features.",
            14f,
        )
        text(
            layout,
            if (dev.remoteaccess.app.control.ScreenAccessService.current != null) "Screen access is enabled" else "Screen access is off",
        )
        button(layout, "Screen access settings") {
            AlertDialog.Builder(this).setTitle("Allow remote screen access?")
                .setMessage(
                    "Android Remote Access uses accessibility to capture this phone’s screen, read the focused field, " +
                        "and perform taps, gestures and typing that you request from a paired browser. " +
                        "Screen content and actions are encrypted between this phone and your browser " +
                        "and pass through our relay when needed. " +
                        "They are not stored in Activity. Only enable this if you want paired browsers to view and control this phone. " +
                        "You can stop access in the app or Android settings.",
                )
                .setNegativeButton(
                    "Cancel",
                    null,
                ).setPositiveButton("Continue") { _, _ -> startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }.show()
        }
        button(layout, "Done", R.id.skip_features) { navigate("home") }
    }

    private fun connectionRequests(layout: LinearLayout) {
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
                "Notifications are on"
            } else {
                "Notifications are off. Turn them on to receive connection requests."
            },
        )
        button(layout, "Notification settings", R.id.notification_settings) {
            openNotificationSettings()
        }
    }

    private fun settings(layout: LinearLayout) {
        button(layout, "Feature setup", R.id.open_features) { navigate("features") }
        connectionRequests(layout)
        text(layout, "When this app is unused", 20f)
        val restrictionsEnabled =
            unusedRestrictions in
                setOf(
                    UnusedAppRestrictionsConstants.API_30_BACKPORT,
                    UnusedAppRestrictionsConstants.API_30,
                    UnusedAppRestrictionsConstants.API_31,
                )
        text(
            layout,
            when (unusedRestrictions) {
                null -> "Checking Android settings…"
                UnusedAppRestrictionsConstants.DISABLED -> "Android’s unused-app restrictions are off."
                UnusedAppRestrictionsConstants.FEATURE_NOT_AVAILABLE -> "Android does not pause unused apps on this phone."
                UnusedAppRestrictionsConstants.ERROR -> "Couldn’t check whether Android pauses this app. Review its app settings."
                else ->
                    "Android may remove permissions or pause this app after a long period of inactivity. " +
                        "Review this setting for remote access."
            },
            14f,
        ).id = R.id.unused_app_status
        if (restrictionsEnabled || unusedRestrictions == UnusedAppRestrictionsConstants.ERROR) {
            button(layout, "Unused app settings", R.id.unused_app_settings) {
                val intent =
                    if (restrictionsEnabled) {
                        IntentCompat.createManageUnusedAppRestrictionsIntent(this, packageName)
                    } else {
                        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, "package:$packageName".toUri())
                    }
                unusedAppSettings.launch(intent)
            }
        }
        text(layout, "Connection setup", 20f)
        button(layout, "Retry setup", R.id.retry_setup) {
            HostRuntime.io.execute {
                WakeSupport.register(this)
                WakeSupport.enqueue(this, androidx.work.Data.EMPTY, registration = true)
            }
            notice = "Updating connection settings…"
            render()
        }
        if (com.google.firebase.FirebaseApp.getApps(this).isEmpty()) {
            text(layout, "Connection requests are unavailable in this installation. Install an app update to complete setup.", 14f)
        }
        store.snapshot.browsers.filter { !it.revoked }.forEach {
            text(
                layout,
                "${it.nickname}: ${if (!it.synced) {
                    "Settings update pending"
                } else if (!store.snapshot.settings.armed || !it.enabled) {
                    "Access is off"
                } else if (!store.snapshot.settings.automatic) {
                    "Connection requests are off"
                } else if (!WakeSupport.notificationsAllowed(this)) {
                    "Notifications needed"
                } else if (it.wakeReady) {
                    "Ready for connection requests"
                } else {
                    "Setup incomplete"
                }}",
                14f,
            )
        }
        text(layout, "About", 20f)
        text(layout, "Android Remote Access ${BuildConfig.VERSION_NAME}", 14f)
        text(layout, "Pair browsers to view and control this phone securely.", 14f)
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
        if (browser.revoked) {
            text(layout, "This browser can no longer connect. Connect this phone to the internet to finish removing it.")
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
        text(layout, if (live?.browserId == browser.id) sessionStatus(live.status) else "Not connected")
        val disconnect = button(layout, "Disconnect", R.id.disconnect_browser) { HostRuntime.disconnect(this, browser.id) }
        disconnect.isEnabled = live?.browserId == browser.id
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
                    text(
                        container,
                        when (event.kind) {
                            "Wake setup completed" -> "Connection settings updated"
                            "Wake setup failed" -> "Connection setup needs attention"
                            "Session blocked: phone busy" -> "Connection declined · Phone busy"
                            else -> event.kind
                        },
                        16f,
                    )
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
                    page = "features"
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
