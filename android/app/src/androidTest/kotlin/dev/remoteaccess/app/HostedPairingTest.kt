package dev.remoteaccess.app

import android.app.UiAutomation
import android.content.Intent
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.Configurator
import androidx.test.uiautomator.StaleObjectException
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/** Normal pairing/deep link and native controls, coordinated with isolated real browsers. */
@RunWith(AndroidJUnit4::class)
class HostedPairingTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val device =
        run {
            Configurator.getInstance().uiAutomationFlags = UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        }
    private val store get() = HostStore.get(context).load()

    private fun waitFor(
        timeout: Long = 30000,
        test: () -> Boolean,
    ) {
        val deadline = System.nanoTime() + timeout * 1_000_000
        while (System.nanoTime() < deadline) {
            if (test()) return
            Thread.sleep(100)
        }
        error("Native state did not arrive")
    }

    private fun tap(selector: BySelector) {
        waitFor {
            try {
                val view = device.findObject(selector)
                if (view == null || !view.isEnabled) {
                    false
                } else {
                    view.click()
                    true
                }
            } catch (_: StaleObjectException) {
                false
            }
        }
    }

    private fun click(id: String) = tap(By.res("${context.packageName}:id/$id"))

    private fun start(uri: String? = null) {
        val intent = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        if (uri != null) {
            intent.action = Intent.ACTION_VIEW
            intent.data = Uri.parse(uri)
        }
        context.startActivity(intent)
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        val control = if (uri == null) "host_status" else "grant_browser"
        assertTrue(device.wait(Until.hasObject(By.res("${context.packageName}:id/$control")), 15000))
    }

    private fun browser() {
        tap(By.textStartsWith(store.snapshot.browsers.first { !it.revoked }.nickname + "\n"))
    }

    @Test
    fun pairOrReconnectAndRevoke() {
        val stage = File(context.filesDir, "hosted-stage")
        val command = File(context.filesDir, "hosted-command")
        val uri = File(context.filesDir, "hosted-pair-uri")
        stage.delete()
        command.delete()
        val pairing = uri.exists()
        start(if (pairing) uri.readText().also { uri.delete() } else null)
        if (pairing) {
            click("grant_browser")
            waitFor(90000) { store.snapshot.browsers.any { !it.revoked } }
            click("skip_features")
        }
        val before = KeystoreIdentity.loadOrCreate("phone-identity-v1").publicKey
        assertTrue(before.contentEquals(KeystoreIdentity.loadOrCreate("phone-identity-v1").publicKey))
        browser()
        waitFor { store.snapshot.browsers.first().synced }
        HostRuntime.connect(context, store.snapshot.browsers.first { !it.revoked }.id)
        waitFor { HostSessions.current.get()?.status == "Waiting for your browser" }
        stage.writeText("connected")
        waitFor(120000) { command.exists() }
        when (command.readText()) {
            "wake" -> {
                click("navigate_back")
                click("open_settings")
                click("enable_wake")
                val allow = device.wait(Until.findObject(By.res("com.android.permissioncontroller:id/permission_allow_button")), 2000)
                allow?.click()
                waitFor(60000) { store.snapshot.browsers.all { it.wakeReady } }
                device.pressHome()
                stage.writeText("wake-ready")
            }
            "revoke" -> {
                click("remove_browser")
                assertNotNull(device.wait(Until.findObject(By.res("android:id/button1")), 10000)).click()
                waitFor { store.snapshot.browsers.isEmpty() }
                stage.writeText("revoked")
            }
        }
        command.delete()
    }

    /** Management mutations use the real UI; manual transport admission is a fixture-only helper. */
    @Test
    fun manageMultipleBrowsers() {
        val stage = File(context.filesDir, "hosted-stage")
        val command = File(context.filesDir, "hosted-command")
        val uriFile = File(context.filesDir, "hosted-pair-uri")
        start()
        stage.writeText("ready")
        val deadline = System.nanoTime() + 900_000_000_000L
        while (System.nanoTime() < deadline) {
            if (!command.exists()) {
                Thread.sleep(100)
                continue
            }
            val task = JSONObject(command.readText())
            command.delete()
            val action = task.getString("action")
            val id = task.optString("id")
            when (action) {
                "stop" -> {
                    stage.writeText("stopped")
                    return
                }
                "pair" -> {
                    val before = store.snapshot.browsers.size
                    val uri = uriFile.readText()
                    uriFile.delete()
                    start(uri)
                    click("grant_browser")
                    waitFor(90000) { store.snapshot.browsers.size == before + 1 }
                    waitFor { store.snapshot.browsers.all { it.synced } }
                }
                "home" -> start()
                "control-ready" -> {
                    start()
                    waitFor { dev.remoteaccess.app.control.ScreenAccessService.current != null }
                    waitFor { ForegroundAccess.listening(id) }
                }
                "save-fixture-pin" -> {
                    assertTrue(device.executeShellCommand("getprop ro.kernel.qemu").trim() == "1")
                    start()
                    click("open_settings")
                    click("open_features")
                    click("save_pin")
                    // Disposable emulator credential; never used on a physical phone.
                    device.findObject(By.res("${context.packageName}:id/save_pin_value")).text = "314159"
                    device.findObject(By.res("${context.packageName}:id/save_pin_confirm")).text = "314159"
                    assertNotNull(device.findObject(By.res("android:id/button1"))).click()
                    waitFor { dev.remoteaccess.app.unlock.PinVault(context).saved() }
                }
                "control-fixture" -> {
                    context.startActivity(
                        Intent().setClassName("${context.packageName}.test", "dev.remoteaccess.app.ControlFixtureActivity")
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK),
                    )
                    assertTrue(device.wait(Until.hasObject(By.text("Tap witness")), 10000))
                }
                "setup" -> {
                    start()
                    click("pair_browser")
                    val scan = assertNotNull(device.wait(Until.findObject(By.res("${context.packageName}:id/scan_pairing_code")), 10000))
                    assertTrue(scan.isEnabled)
                    click("copy_website")
                    val clipboard = context.getSystemService(android.content.ClipboardManager::class.java)
                    waitFor { clipboard.primaryClip?.getItemAt(0)?.text?.toString() == BuildConfig.SHARING_WEBSITE }
                }
                "website-qr" -> click("show_website_qr")
                "share-link" -> {
                    click("share_website")
                    waitFor { device.currentPackageName in setOf("android", "com.android.intentresolver") }
                    device.pressBack()
                }
                "close-setup" -> device.pressBack()
                "features" -> {
                    start()
                    click("review_settings")
                    assertTrue(device.wait(Until.hasObject(By.res("${context.packageName}:id/skip_features")), 10000))
                }
                "skip-setup" -> click("skip_features")
                "deny-feature-permission" -> {
                    val paired = store.snapshot.browsers.map { it.id }
                    start()
                    click("review_settings")
                    click("enable_wake")
                    val deny = By.res("com.android.permissioncontroller:id/permission_deny_button")
                    assertNotNull(device.wait(Until.findObject(deny), 10000)).click()
                    waitFor { store.snapshot.settings.automatic }
                    assertTrue(!WakeSupport.notificationsAllowed(context))
                    click("skip_features")
                    assertTrue(store.snapshot.browsers.map { it.id } == paired)
                }
                "foreground" -> {
                    start()
                    assertTrue(!WakeSupport.notificationsAllowed(context))
                    assertTrue(store.snapshot.settings.automatic == task.optBoolean("automatic", false))
                    waitFor { ForegroundAccess.listening(id) }
                }
                "activity" -> {
                    start()
                    click("open_activity")
                }
                "settings" -> {
                    start()
                    click("open_settings")
                }
                "notification-refresh" -> {
                    start()
                    click("open_settings")
                    waitFor {
                        device.findObject(By.res("${context.packageName}:id/unused_app_status"))?.text?.let {
                            it != "Checking Android settings…"
                        } == true
                    }
                    click("notification_settings")
                    assertTrue(device.wait(Until.hasObject(By.pkg("com.android.settings")), 10000))
                    device.pressBack()
                    if (device.hasObject(By.res("${context.packageName}:id/unused_app_settings"))) {
                        click("unused_app_settings")
                        assertTrue(device.wait(Until.hasObject(By.pkg("com.android.settings")), 10000))
                        device.pressBack()
                    }
                    // Channel blocking changes real notification authority without killing instrumentation.
                    device.pressHome()
                    val manager = context.getSystemService(android.app.NotificationManager::class.java)
                    val channel = requireNotNull(manager.getNotificationChannel(WakeSupport.CHANNEL))
                    channel.importance = android.app.NotificationManager.IMPORTANCE_NONE
                    manager.createNotificationChannel(channel)
                    assertTrue(!WakeSupport.notificationsAllowed(context))
                    context.startActivity(
                        Intent(context, MainActivity::class.java)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                    )
                    assertTrue(
                        device.wait(Until.hasObject(By.text("Notifications are off. Turn them on to receive connection requests.")), 15000),
                    )
                    waitFor { store.snapshot.browsers.all { !it.wakeReady } }
                    context.startActivity(
                        Intent(android.provider.Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                            .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.packageName)
                            .putExtra(android.provider.Settings.EXTRA_CHANNEL_ID, WakeSupport.CHANNEL)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    )
                    val channelToggle =
                        assertNotNull(device.wait(Until.findObject(By.pkg("com.android.settings").checkable(true).checked(false)), 10000))
                    channelToggle.click()
                    waitFor { WakeSupport.notificationsAllowed(context) }
                    device.pressBack()
                    assertTrue(device.wait(Until.hasObject(By.text("Notifications are on")), 15000))
                    waitFor { store.snapshot.browsers.all { it.wakeReady } }
                }
                "notification-state" -> {
                    start()
                    click("open_settings")
                    val allowed = task.getBoolean("enabled")
                    assertTrue(WakeSupport.notificationsAllowed(context) == allowed)
                    val message =
                        if (allowed) {
                            "Notifications are on"
                        } else {
                            "Notifications are off. Turn them on to receive connection requests."
                        }
                    assertTrue(device.wait(Until.hasObject(By.text(message)), 15000))
                    waitFor { store.snapshot.browsers.all { it.wakeReady == allowed } }
                }
                "global" -> {
                    start()
                    if (store.snapshot.settings.armed != task.getBoolean("enabled")) click("access_toggle")
                    waitFor { store.snapshot.settings.armed == task.getBoolean("enabled") }
                    waitFor { store.snapshot.browsers.all { it.synced } }
                }
                "automatic" -> {
                    start()
                    click("open_settings")
                    if (store.snapshot.settings.automatic != task.getBoolean("enabled")) click("enable_wake")
                    device.wait(Until.findObject(By.res("com.android.permissioncontroller:id/permission_allow_button")), 2000)?.click()
                    waitFor(60000) {
                        store.snapshot.settings.automatic == task.getBoolean("enabled") &&
                            store.snapshot.browsers.all {
                                it.wakeReady == task.getBoolean("enabled")
                            }
                    }
                }
                else -> {
                    start()
                    tap(By.textStartsWith(requireNotNull(store.browser(id)).nickname + "\n"))
                    when (action) {
                        "details" -> Unit
                        "rename" -> {
                            click("rename_browser")
                            val nameField = assertNotNull(device.wait(Until.findObject(By.clazz("android.widget.EditText")), 10000))
                            nameField.text = task.getString("name")
                            assertNotNull(device.findObject(By.res("android:id/button1"))).click()
                            waitFor { store.browser(id)?.nickname == task.getString("name") }
                        }
                        "allow-unlock" -> {
                            if (store.browser(id)?.unlockAllowed != task.getBoolean("enabled")) click("allow_unlock")
                            waitFor { store.browser(id)?.unlockAllowed == task.getBoolean("enabled") }
                            waitFor { store.snapshot.browsers.all { it.synced } }
                        }
                        "enable" -> {
                            if (store.browser(id)?.enabled != task.getBoolean("enabled")) click("browser_toggle")
                            waitFor { store.browser(id)?.enabled == task.getBoolean("enabled") && store.browser(id)?.synced == true }
                        }
                        "connect" -> {
                            HostRuntime.connect(context, id)
                            waitFor {
                                HostSessions.current.get()?.let { it.browserId == id && it.status == "Waiting for your browser" } == true
                            }
                        }
                        "disconnect" -> {
                            click("disconnect_browser")
                            waitFor { HostSessions.current.get() == null }
                        }
                        "remove" -> {
                            click("remove_browser")
                            assertNotNull(device.wait(Until.findObject(By.res("android:id/button1")), 10000)).click()
                            waitFor { store.browser(id) == null }
                        }
                        else -> error("Unknown fixture action")
                    }
                }
            }
            val result =
                JSONObject().put("action", action).put(
                    "browsers",
                    org.json.JSONArray(
                        store.snapshot.browsers.map {
                            JSONObject().put(
                                "id",
                                it.id,
                            ).put("nickname", it.nickname).put("enabled", it.enabled).put("generation", it.generation)
                                .put("lastConnected", it.lastConnected).put("wakeReady", it.wakeReady)
                        },
                    ),
                ).put("armed", store.snapshot.settings.armed).put("active", HostSessions.current.get()?.browserId)
            stage.writeText(result.toString())
        }
        error("Management fixture timed out")
    }

    @Test
    fun revokeFixture() {
        assertTrue(File(context.filesDir, "hosted-stage").exists(), "Not an enrolled acceptance fixture")
        HostSessions.stop()
        androidx.work.WorkManager.getInstance(context).cancelAllWork()
        for (browser in store.snapshot.browsers) {
            store.revoke(browser.id)
            val grant = browser.authority()
            val signature =
                KeystoreIdentity.loadOrCreate(
                    "phone-identity-v1",
                ).sign(fields("ara/pair/revoke/v1", grant.getString("origin"), browser.id))
            request(grant.getString("origin"), browser.id, "revoke", JSONObject().put("signature", encoded(signature)))
            store.removed(browser.id)
        }
    }
}
