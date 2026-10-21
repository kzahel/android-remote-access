package dev.remoteaccess.app

import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
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
import dev.remoteaccess.app.control.ScreenAccessService
import dev.remoteaccess.app.unlock.PinVault
import dev.remoteaccess.app.unlock.UnlockSetup
import java.text.DateFormat
import java.util.Date

/** Plain native management UI. Authority and sessions belong to the application, not this activity. */
class MainActivity : ComponentActivity() {
    private val store by lazy { HostStore.get(this) }
    private lateinit var shell: ManagementShell
    private val backStack = mutableListOf<String>()
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
        setTheme(Appearance.theme(this))
        super.onCreate(savedInstanceState)
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    goBack()
                }
            },
        )
        page = savedInstanceState?.getString("page") ?: "home"
        browserId = savedInstanceState?.getString("browserId")
        if (page == "grant") page = "home" // Never persist QR secrets in activity state.
        backStack.addAll(savedInstanceState?.getStringArrayList("navigation") ?: emptyList())
        shell = ManagementShell(this, ::goBack, { navigate(it) }, ::showSharingSetup)
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
        outState.putStringArrayList("navigation", ArrayList(backStack))
        outState.putString("page", page)
        outState.putString("browserId", browserId)
        outState.putBoolean("sharing", sharingDialog?.isShowing == true)
        super.onSaveInstanceState(outState)
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private fun goBack() {
        if (shell.closeDrawer()) return
        if (backStack.isNotEmpty()) {
            page = backStack.removeAt(backStack.lastIndex)
            notice = null
            pending = null
            render()
        } else if (page != "home") {
            navigate("home")
        } else {
            finish()
        }
    }

    private fun navigate(
        value: String,
        id: String? = null,
    ) {
        if (value in setOf("home", "activity", "settings")) {
            backStack.clear()
        } else if (page != value) {
            backStack.add(page)
        }
        page = value
        browserId = id
        notice = null
        if (value != "grant") pending = null
        render()
    }

    private fun render() {
        if (isDestroyed || isFinishing) return
        shell.page(
            page,
            when (page) {
                "settings" -> "Settings"
                "features" -> "Choose features"
                "activity" -> "Activity"
                "browsers" -> "Manage access"
                "browser" -> browserId?.let(store::browser)?.nickname ?: "Browser"
                "screen" -> "Screen and control"
                "unlock" -> "Unlocking"
                "background" -> "Background connections"
                "appearance" -> "Appearance"
                "about" -> "About"
                "grant" -> "Allow this browser?"
                else -> "Home"
            },
        )
        val layout = shell.body
        if (!loaded) {
            text(layout, "Loading…")
            return
        }
        notice?.let { text(layout, it, 16f).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE } }
        when (page) {
            "settings" -> settings(layout)
            "features" -> features(layout)
            "activity" -> activity(layout)
            "browsers" -> browsers(layout)
            "browser" -> browser(layout)
            "screen" -> screenSettings(layout)
            "unlock" -> unlockSettings(layout)
            "background" -> backgroundSettings(layout)
            "appearance" -> appearance(layout)
            "about" -> about(layout)
            "grant" -> invitation(layout)
            else -> home(layout)
        }
    }

    private fun home(layout: LinearLayout) {
        val state = store.snapshot
        val live = HostSessions.current.get()
        val browsers = state.browsers.filter { !it.revoked }
        val status =
            when {
                !state.settings.armed -> "Remote access is off"
                browsers.isEmpty() -> "Connect from another device to get started"
                live != null -> "${store.browser(live.browserId)?.nickname ?: "Browser"} · ${sessionStatus(live.status)}"
                browsers.none { it.enabled } -> "Access is paused for all paired browsers"
                !state.settings.automatic -> "Available while this app is open"
                com.google.firebase.FirebaseApp.getApps(this).isEmpty() -> "Background connections need attention"
                !WakeSupport.notificationsAllowed(this) -> "Background connections need notifications"
                browsers.any { it.enabled && (!it.synced || !it.wakeReady) } -> "Updating connection setup…"
                else -> "Ready for connection requests"
            }
        val access = section(layout)
        toggle(access, "Allow remote access", state.settings.armed, R.id.access_toggle) { enabled ->
            change { it.settings(armed = enabled) }
        }
        text(access, status).apply {
            id = R.id.host_status
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        if (live != null) {
            button(access, "Stop connection", R.id.disconnect_browser) { HostRuntime.disconnect(this, live.browserId) }
        }
        if (state.settings.armed && browsers.any { it.enabled }) {
            if (ScreenAccessService.current == null) {
                row(layout, "Screen access is off", "Review to enable viewing and control", R.id.review_settings) { navigate("screen") }
            }
            if (state.settings.automatic && (
                    !WakeSupport.notificationsAllowed(this) ||
                        browsers.any { it.enabled && (!it.synced || !it.wakeReady) }
                )
            ) {
                row(layout, "Background connections", "Review connection setup", R.id.background_settings) { navigate("background") }
            }
        }
        if (state.settings.armed && browsers.isNotEmpty() && browsers.none { it.enabled }) {
            row(layout, "Manage access", "Choose which browsers can connect", R.id.manage_access) { navigate("browsers") }
        }
        button(layout, "Connect from another device", R.id.pair_browser) { showSharingSetup() }
        text(
            layout,
            "Open the website on another device, then pair it with this phone. Paired browsers can reconnect without scanning again.",
            14f,
        )
    }

    private fun browsers(layout: LinearLayout) {
        text(layout, "Browsers you have paired can reach this phone. Open an entry to rename it, change permissions or remove access.", 14f)
        if (store.snapshot.browsers.isEmpty()) text(layout, "No paired browsers yet.")
        store.snapshot.browsers.forEach { browser ->
            val summary =
                when {
                    browser.revoked -> "Access removed · Finishing removal"
                    !browser.enabled -> "Access paused"
                    !store.snapshot.settings.armed -> "Allowed · Remote access is off"
                    HostSessions.current.get()?.browserId == browser.id -> "Connected"
                    else -> lastConnected(browser)
                }
            row(layout, browser.nickname, summary) { navigate("browser", browser.id) }
        }
        button(layout, "Add browser", R.id.pair_browser) { showSharingSetup() }
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
        text(layout, "Browser paired. Choose what you want to enable, or do this later in Settings.")
        featureRows(layout)
        button(layout, "Done", R.id.skip_features) { navigate("home") }
    }

    private fun featureRows(layout: LinearLayout) {
        row(layout, "Screen and control", if (ScreenAccessService.current != null) "Enabled" else "Off", R.id.screen_settings) {
            navigate("screen")
        }
        row(
            layout,
            "Unlocking",
            if (PinVault(this).saved()) "PIN saved on this phone" else "Optional · No saved PIN",
            R.id.unlock_settings,
        ) {
            navigate("unlock")
        }
        row(
            layout,
            "Background connections",
            when {
                !store.snapshot.settings.automatic -> "Off · Connect while the app is open"
                !WakeSupport.notificationsAllowed(this) -> "Notifications needed"
                else -> "On · Depends on Android and network availability"
            },
            R.id.background_settings,
        ) {
            navigate("background")
        }
    }

    private fun screenSettings(layout: LinearLayout) {
        text(
            layout,
            "See this phone’s screen and control it from a paired browser. " +
                "Android uses one accessibility permission for these features.",
            14f,
        )
        text(
            layout,
            if (ScreenAccessService.current != null) "Screen access is enabled" else "Screen access is off",
        )
        text(layout, "Smooth video also needs Android’s screen-sharing approval when requested. Protected screens may remain hidden.", 14f)
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
    }

    private fun unlockSettings(layout: LinearLayout) {
        text(
            layout,
            "Enter your phone’s PIN during a remote session, or optionally save it on this phone. " +
                "Each browser needs your permission to unlock.",
        )
        text(layout, "After a restart, unlock the phone locally once before remote unlocking can work.", 14f)
        button(layout, "Save phone PIN", R.id.save_pin) { UnlockSetup.show(this) { render() } }
        if (PinVault(this).saved()) {
            text(layout, "A PIN is saved on this phone")
            button(layout, "Forget saved PIN", R.id.forget_pin) { UnlockSetup.forget(this) { render() } }
        }
        row(layout, "Manage browser permissions", "Choose which browsers may unlock", R.id.manage_access) { navigate("browsers") }
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
        featureRows(layout)
        row(layout, "Manage access", "Paired browsers and their permissions", R.id.manage_access) { navigate("browsers") }
        row(
            layout,
            "Appearance",
            when (Appearance.choice(this)) {
                "light" -> "Light"
                "dark" -> "Dark"
                else -> "System"
            },
            R.id.appearance_settings,
        ) {
            navigate("appearance")
        }
        row(layout, "About", "App version and information", R.id.about_settings) { navigate("about") }
        if (Website.developmentAvailable) {
            toggle(layout, "Use development website", Website.development(this), R.id.development_website) { enabled ->
                perform { Website.setDevelopment(this, enabled) }
            }
            text(layout, "Debug build. Sharing setup links to ${Website.current(this).removePrefix("https://")}.", 14f)
        }
    }

    private fun appearance(layout: LinearLayout) {
        text(layout, "Choose how this app looks. System follows your phone’s appearance setting.", 14f)
        val selected = Appearance.choice(this)
        val choices = RadioGroup(this).apply { orientation = RadioGroup.VERTICAL }
        for ((mode, resource) in listOf(
            "system" to R.id.appearance_system,
            "light" to R.id.appearance_light,
            "dark" to R.id.appearance_dark,
        )) {
            choices.addView(
                RadioButton(this).apply {
                    id = resource
                    text = mode.replaceFirstChar { it.uppercase() }
                    textSize = 18f
                    minHeight = dp(56)
                    isChecked = mode == selected
                    isEnabled = !busy
                },
                LinearLayout.LayoutParams(-1, -2),
            )
        }
        choices.setOnCheckedChangeListener { _, checked ->
            val mode =
                when (checked) {
                    R.id.appearance_light -> "light"
                    R.id.appearance_dark -> "dark"
                    else -> "system"
                }
            if (mode != selected) {
                perform {
                    Appearance.save(this, mode)
                    runOnUiThread { recreate() }
                }
            }
        }
        layout.addView(choices)
    }

    private fun backgroundSettings(layout: LinearLayout) {
        connectionRequests(layout)
        toggle(layout, "Restore setup after restart", RestartRecovery.enabled(this), R.id.restore_setup) { enabled ->
            perform { RestartRecovery.setEnabled(this, enabled) }
        }
        text(
            layout,
            "Refresh connection setup after restarting or updating. Unlock the phone locally once after a restart. " +
                "Screen sharing still needs new approval.",
            14f,
        )
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
    }

    private fun about(layout: LinearLayout) {
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
        text(layout, "Paired ${time(browser.pairedAt)}\n${lastConnected(browser)}", 14f)
        if (browser.revoked) {
            text(layout, "This browser can no longer connect. Connect this phone to the internet to finish removing it.")
            button(layout, "Retry removal", R.id.remove_browser) { change { } }
            return
        }
        toggle(layout, "Allow this browser", browser.enabled, R.id.browser_toggle) { enabled -> change { it.enable(browser.id, enabled) } }
        toggle(
            layout,
            "Allow unlocking",
            browser.unlockAllowed,
            R.id.allow_unlock,
        ) { enabled -> change { it.allowUnlock(browser.id, enabled) } }
        text(layout, "Lets this browser submit a PIN or request the PIN saved on this phone. Each unlock is an explicit action.", 14f)
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
                    val entry = section(container)
                    text(
                        entry,
                        when (event.kind) {
                            "Wake setup completed" -> "Connection settings updated"
                            "Wake setup failed" -> "Connection setup needs attention"
                            "Session blocked: phone busy" -> "Connection declined · Phone busy"
                            else -> event.kind
                        },
                        16f,
                    )
                    text(entry, "${time(event.at)}${event.browserName?.let { " · $it" } ?: ""}", 14f)
                }
                shell.restoreScroll()
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
            backStack.clear()
            backStack.add("home")
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
        text(layout, invitation.name ?: "Unnamed browser", 20f)
        if (invitation.origin != Website.current(this)) text(layout, invitation.origin.removePrefix("https://"), 14f)
        text(layout, "Only allow a browser you just opened yourself.", 14f)
        button(layout, getString(R.string.grant_browser), R.id.grant_browser) {
            perform(network = true) {
                val accepted = invitation.grant(KeystoreIdentity.loadOrCreate("phone-identity-v1"))
                store.pair(accepted, invitation.name)
                WakeSupport.enqueue(this, androidx.work.Data.EMPTY, registration = true)
                runOnUiThread {
                    pending = null
                    backStack.clear()
                    backStack.add("home")
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
                error: Exception,
            ) {
                if (BuildConfig.DEBUG) android.util.Log.w("RemoteAccess", "Action failed: ${error.javaClass.simpleName}")
                runOnUiThread { notice = "Couldn’t complete the action. Check your connection and try again." }
            } finally {
                runOnUiThread {
                    busy = false
                    render()
                }
            }
        }
    }

    private fun color(attr: Int): Int = TypedValue().also { theme.resolveAttribute(attr, it, true) }.data

    private fun section(layout: LinearLayout): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(8), dp(16), dp(12))
            background =
                GradientDrawable().apply {
                    cornerRadius = dp(16).toFloat()
                    setColor(color(R.attr.surfaceColor))
                    setStroke(dp(1), color(R.attr.outlineColor))
                }
            layout.addView(this, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(16) })
        }

    private fun row(
        layout: LinearLayout,
        label: String,
        summary: String,
        resource: Int = View.NO_ID,
        action: () -> Unit,
    ) {
        val row =
            LinearLayout(this).apply {
                id = resource
                gravity = Gravity.CENTER_VERTICAL
                minimumHeight = dp(76)
                setPadding(dp(16), dp(8), dp(16), dp(8))
                background =
                    RippleDrawable(
                        ColorStateList.valueOf(color(android.R.attr.colorControlHighlight)),
                        GradientDrawable().apply {
                            cornerRadius = dp(12).toFloat()
                            setColor(color(R.attr.surfaceColor))
                            setStroke(dp(1), color(R.attr.outlineColor))
                        },
                        null,
                    )
                isFocusable = true
                isClickable = true
                isEnabled = !busy
                setOnClickListener { action() }
            }
        val copy =
            LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            }
        text(copy, label, 17f).apply {
            setTypeface(null, Typeface.BOLD)
            setPadding(0, dp(2), 0, dp(2))
        }
        text(copy, summary, 14f).setPadding(0, dp(2), 0, dp(2))
        row.contentDescription = "$label. $summary"
        row.addView(copy, LinearLayout.LayoutParams(0, -2, 1f))
        row.addView(
            TextView(this).apply {
                text = if (resources.configuration.layoutDirection == View.LAYOUT_DIRECTION_RTL) "‹" else "›"
                textSize = 26f
                setPadding(dp(12), 0, 0, 0)
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            },
        )
        layout.addView(row, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(8) })
    }

    private fun text(
        layout: LinearLayout,
        value: String,
        size: Float = 16f,
    ): TextView =
        TextView(this).apply {
            text = value
            textSize = size
            setTextColor(color(if (size < 16f) android.R.attr.textColorSecondary else android.R.attr.textColorPrimary))
            if (size >= 20f) {
                setTypeface(null, Typeface.BOLD)
                isAccessibilityHeading = true
            }
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
            minHeight = dp(52)
            val primary = resource in setOf(R.id.pair_browser, R.id.grant_browser, R.id.skip_features, R.id.save_pin)
            backgroundTintList = ColorStateList.valueOf(color(if (primary) android.R.attr.colorAccent else R.attr.accentSurfaceColor))
            setTextColor(color(if (primary) R.attr.onAccentColor else android.R.attr.textColorPrimary))
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
