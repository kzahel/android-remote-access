package dev.remoteaccess.app

import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@RunWith(AndroidJUnit4::class)
class HostStoreTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var db: HostDatabase
    private lateinit var store: HostStore

    @Before
    fun setup() {
        WakeSupport.preferences(context).edit().clear().commit()
        db = Room.inMemoryDatabaseBuilder(context, HostDatabase::class.java).build()
        store = HostStore.fixture(context, db)
    }

    @After
    fun cleanup() {
        db.close()
        WakeSupport.preferences(context).edit().clear().commit()
    }

    private fun grant(id: String) = JSONObject().put("id", id).put("origin", "https://example.test").put("viewer", "public-identity-$id")

    @Test
    fun migratesOnceAndPreservesRevocationAndWakeChoice() {
        val raw = grant("a").toString()
        WakeSupport.preferences(context).edit().putString("grant", raw).putBoolean("revoked", true).putBoolean("wakeEnabled", true).commit()
        store.load()
        val browser = store.snapshot.browsers.single()
        assertEquals(raw, browser.grant)
        assertTrue(browser.revoked)
        assertTrue(store.snapshot.settings.automatic)
        assertFalse(store.allowed(browser.id, browser.generation))
        assertFalse(WakeSupport.preferences(context).contains("grant"))
        // Simulate a crash between the database commit and preference cleanup.
        WakeSupport.preferences(context).edit().putString("grant", grant("b").toString()).commit()
        val reopened = HostStore.fixture(context, db).load()
        assertEquals(listOf("a"), reopened.snapshot.browsers.map { it.id })
        assertEquals(1, reopened.events().count { it.kind == "Previous pairing imported" })
    }

    @Test
    fun multipleBrowsersKeepSeparateAuthorityAndOldGenerationsNeverReturn() {
        store.load()
        val a = store.pair(grant("a"))
        val b = store.pair(grant("b"))
        store.rename(a.id, "Work laptop")
        assertEquals(a.grant, store.browser(a.id)?.grant)
        store.enable(a.id, false)
        assertFalse(store.allowed(a.id, a.generation))
        assertTrue(store.allowed(b.id, b.generation))
        store.enable(a.id, true)
        assertFalse(store.allowed(a.id, a.generation))
        assertTrue(store.allowed(a.id, requireNotNull(store.browser(a.id)).generation))
        val before = requireNotNull(store.browser(b.id)).generation
        store.settings(armed = false)
        assertFalse(store.allowed(b.id, before))
        store.settings(armed = true)
        assertFalse(store.allowed(b.id, before))
        store.revoke(a.id)
        assertFalse(store.allowed(a.id, requireNotNull(store.browser(a.id)).generation))
        assertEquals("Work laptop", store.browser(a.id)?.nickname)
        store.removed(a.id)
        assertEquals(listOf(b.id), store.snapshot.browsers.map { it.id })
        assertEquals("Browser removed locally", store.events().first { it.kind == "Browser removed locally" }.kind)
    }

    @Test
    fun historyIsBoundedAndCannotRecordArbitraryPayloads() {
        store.load()
        db.runInTransaction {
            repeat(10005) {
                db.dao().event(
                    ActivityEvent(at = System.currentTimeMillis(), browserId = null, browserName = null, kind = "Connection ended"),
                )
            }
            db.dao().event(ActivityEvent(at = 1, browserId = null, browserName = null, kind = "Too old"))
        }
        assertEquals(9999, store.events(10000).size)
        assertFailsWith<IllegalArgumentException> { store.record("sensitive remote payload") }
        assertFailsWith<IllegalArgumentException> { store.rename("missing", "\n") }
    }
}
