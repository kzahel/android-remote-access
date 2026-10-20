package dev.remoteaccess.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/** Injects decoded QR content through the normal deep link, then exercises Grant. */
@RunWith(AndroidJUnit4::class)
class HostedPairingTest {
    @Test
    fun pairOrReconnectAndRevoke() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val device = UiDevice.getInstance(instrumentation)
        val stage = File(context.filesDir, "hosted-stage")
        val command = File(context.filesDir, "hosted-command")
        val uriFile = File(context.filesDir, "hosted-pair-uri")
        val pairing = uriFile.exists()
        stage.delete()
        command.delete()
        val intent = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        if (pairing) {
            intent.action = Intent.ACTION_VIEW
            intent.data = Uri.parse(uriFile.readText())
            uriFile.delete()
        }
        context.startActivity(intent)
        if (pairing) {
            val grant = device.wait(Until.findObject(By.res("${context.packageName}:id/grant_browser")), 15000)
            assertNotNull(grant, "Normal grant screen missing")
            grant.click()
        }
        if (pairing) {
            assertTrue(device.wait(Until.hasObject(By.text("Browser paired. Tap Connect.")), 90000))
        } else {
            assertTrue(context.getSharedPreferences("paired-browser-v1", 0).contains("grant"))
            assertTrue(device.wait(Until.hasObject(By.res("${context.packageName}:id/connect_phone")), 15000))
        }
        val before = KeystoreIdentity.loadOrCreate("phone-identity-v1").publicKey
        assertTrue(before.contentEquals(KeystoreIdentity.loadOrCreate("phone-identity-v1").publicKey))
        device.findObject(By.res("${context.packageName}:id/connect_phone")).click()
        assertTrue(device.wait(Until.hasObject(By.text("Waiting for your browser")), 20000))
        stage.writeText("connected")
        val deadline = System.nanoTime() + 120_000_000_000L
        while (!command.exists() && System.nanoTime() < deadline) Thread.sleep(200)
        assertTrue(command.exists(), "Browser runner did not finish")
        if (command.readText() == "wake") {
            device.findObject(By.res("${context.packageName}:id/enable_wake")).click()
            if (android.os.Build.VERSION.SDK_INT >= 33 &&
                context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) {
                val allow = device.wait(Until.findObject(By.res("com.android.permissioncontroller:id/permission_allow_button")), 10000)
                assertNotNull(allow, "Notification permission prompt missing")
                allow.click()
            }
            assertTrue(device.wait(Until.hasObject(By.text("Remote wake ready")), 60000), "Firebase registration did not reach relay")
            device.pressHome()
            stage.writeText("wake-ready")
        }
        if (command.readText() == "revoke") {
            device.findObject(By.res("${context.packageName}:id/remove_browser")).click()
            assertTrue(device.wait(Until.hasObject(By.text("Browser removed")), 20000))
            stage.writeText("revoked")
        }
        command.delete()
    }

    /** Owned test fixture cleanup also works behind a secure keyguard, without credential entry. */
    @Test
    fun revokeFixture() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assertTrue(File(context.filesDir, "hosted-stage").exists(), "Not an enrolled acceptance fixture")
        val preferences = WakeSupport.preferences(context)
        val grant = JSONObject(assertNotNull(preferences.getString("grant", null)))
        preferences.save { putBoolean("revoked", true) }
        androidx.work.WorkManager.getInstance(context).cancelAllWork()
        val signature =
            KeystoreIdentity.loadOrCreate(
                "phone-identity-v1",
            ).sign(fields("ara/pair/revoke/v1", grant.getString("origin"), grant.getString("id")))
        request(grant.getString("origin"), grant.getString("id"), "revoke", JSONObject().put("signature", encoded(signature)))
        preferences.save { remove("grant").remove("revoked").putBoolean("wakeEnabled", false) }
    }
}
