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
    private val legacy get() = context.getSharedPreferences("host-store-fixture", android.content.Context.MODE_PRIVATE)
    private lateinit var db: HostDatabase
    private lateinit var store: HostStore

    @Before
    fun setup() {
        legacy.edit().clear().commit()
        db = Room.inMemoryDatabaseBuilder(context, HostDatabase::class.java).build()
        store = HostStore.fixture(context, db)
    }

    @After
    fun cleanup() {
        db.close()
        legacy.edit().clear().commit()
    }

    private fun grant(id: String) =
        JSONObject().put(
            "id",
            id,
        ).put("origin", BuildConfig.SHARING_WEBSITE).put("viewer", "public-identity-$id")

    @Test
    fun migratesOnceAndPreservesRevocationAndWakeChoice() {
        val raw = grant("a").toString()
        legacy.edit().putString("grant", raw).putBoolean("revoked", true).putBoolean("wakeEnabled", true).commit()
        store.load()
        val pairedDevice = store.snapshot.devices.single()
        assertEquals(raw, pairedDevice.grant)
        assertTrue(pairedDevice.revoked)
        assertTrue(store.snapshot.settings.automatic)
        assertFalse(store.allowed(pairedDevice.id, pairedDevice.generation))
        assertFalse(legacy.contains("grant"))
        // Simulate a crash between the database commit and preference cleanup.
        legacy.edit().putString("grant", grant("b").toString()).commit()
        val reopened = HostStore.fixture(context, db).load()
        assertEquals(listOf("a"), reopened.snapshot.devices.map { it.id })
        assertEquals(1, reopened.events().count { it.kind == "Previous pairing imported" })
    }

    @Test
    fun multipleDevicesKeepSeparateAuthorityAndOldGenerationsNeverReturn() {
        store.load()
        val a = store.pair(grant("a"))
        val b = store.pair(grant("b"))
        store.rename(a.id, "Work laptop")
        assertEquals(a.grant, store.device(a.id)?.grant)
        store.enable(a.id, false)
        assertFalse(store.allowed(a.id, a.generation))
        assertTrue(store.allowed(b.id, b.generation))
        store.enable(a.id, true)
        assertFalse(store.allowed(a.id, a.generation))
        assertTrue(store.allowed(a.id, requireNotNull(store.device(a.id)).generation))
        val before = requireNotNull(store.device(b.id)).generation
        store.settings(armed = false)
        assertFalse(store.allowed(b.id, before))
        store.settings(armed = true)
        assertFalse(store.allowed(b.id, before))
        store.revoke(a.id)
        assertFalse(store.allowed(a.id, requireNotNull(store.device(a.id)).generation))
        assertEquals("Work laptop", store.device(a.id)?.nickname)
        store.removed(a.id)
        assertEquals(listOf(b.id), store.snapshot.devices.map { it.id })
        assertEquals("Device removed locally", store.events().first { it.kind == "Device removed locally" }.kind)
    }

    @Test
    fun historyIsBoundedAndCannotRecordArbitraryPayloads() {
        store.load()
        db.runInTransaction {
            repeat(10005) {
                db.dao().event(
                    ActivityEvent(at = System.currentTimeMillis(), deviceId = null, deviceName = null, kind = "Connection ended"),
                )
            }
            db.dao().event(ActivityEvent(at = 1, deviceId = null, deviceName = null, kind = "Too old"))
        }
        assertEquals(9999, store.events(10000).size)
        assertFailsWith<IllegalArgumentException> { store.record("sensitive remote payload") }
        assertFailsWith<IllegalArgumentException> { store.rename("missing", "\n") }
    }

    @Test
    fun rejectsNewGrantsForUnconfiguredServices() {
        store.load()
        assertFailsWith<IllegalArgumentException> { store.pair(grant("bad").put("origin", "https://other.example")) }
        assertTrue(store.snapshot.devices.isEmpty())
    }

    @Test
    fun savedOffOriginGrantsStayVisibleButCannotRegainAuthority() {
        val allowed = store.load().pair(grant("allowed"))
        val unsupported = Device("old", grant("old").put("origin", "https://other.example").toString(), "Old device", 1)
        db.dao().put(unsupported)
        db.dao().put(Device("malformed", "{}", "Malformed grant", 1))
        store = HostStore.fixture(context, db).load()
        assertEquals(3, store.snapshot.devices.size)
        assertTrue(store.allowed(allowed.id, allowed.generation))
        assertFalse(store.allowed(unsupported.id, unsupported.generation))
        assertFalse(requireNotNull(store.device("malformed")).originAllowed)
        assertFailsWith<IllegalArgumentException> { requireNotNull(store.device(unsupported.id)).authority() }
        store.enable(unsupported.id, false)
        store.enable(unsupported.id, true)
        assertFalse(store.allowed(unsupported.id, requireNotNull(store.device(unsupported.id)).generation))
        store.revoke(unsupported.id)
        store.removed(unsupported.id)
        assertEquals(setOf(allowed.id, "malformed"), store.snapshot.devices.map { it.id }.toSet())
    }
}
