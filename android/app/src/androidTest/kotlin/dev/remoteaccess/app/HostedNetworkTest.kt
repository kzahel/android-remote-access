package dev.remoteaccess.app

import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.Request
import org.junit.Test
import kotlin.test.assertTrue

/** Wait for owned-emulator networking before creating a short-lived pairing invitation. */
class HostedNetworkTest {
    @Test fun publicOriginIsReachable() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assertTrue(context.packageName == "dev.remoteaccess.host")
        val deadline = System.nanoTime() + 90_000_000_000L
        var failure: Exception? = null
        while (System.nanoTime() < deadline) {
            try {
                http.newCall(Request.Builder().url(BuildConfig.SHARING_WEBSITE + "/health").build()).execute().use {
                    assertTrue(it.isSuccessful)
                }
                return
            } catch (error: Exception) {
                failure = error
                Thread.sleep(500)
            }
        }
        throw IllegalStateException("Owned fixture could not reach the public origin", failure)
    }
}
