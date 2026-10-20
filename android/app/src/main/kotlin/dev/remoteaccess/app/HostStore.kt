package dev.remoteaccess.app

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.CopyOnWriteArraySet

@Entity(tableName = "browsers")
internal data class Browser(
    @PrimaryKey val id: String,
    val grant: String,
    val nickname: String,
    val pairedAt: Long,
    val lastConnected: Long = 0,
    val enabled: Boolean = true,
    val revoked: Boolean = false,
    val generation: String = generation(),
    val synced: Boolean = false,
    val wakeReady: Boolean = false,
) {
    fun authority() = JSONObject(grant)
}

internal fun generation(): String = UUID.randomUUID().toString().replace("-", "")

@Entity(tableName = "settings")
internal data class HostSettings(
    @PrimaryKey val id: Int = 1,
    val armed: Boolean = true,
    val automatic: Boolean = false,
)

@Entity(tableName = "activity")
internal data class ActivityEvent(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val at: Long,
    val browserId: String?,
    val browserName: String?,
    val kind: String,
)

@Dao
internal interface HostDao {
    @Query("SELECT * FROM browsers ORDER BY pairedAt, id")
    fun browsers(): List<Browser>

    @Query("SELECT * FROM settings WHERE id = 1")
    fun settings(): HostSettings?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun put(browser: Browser)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun put(settings: HostSettings)

    @Insert
    fun event(event: ActivityEvent)

    @Query("DELETE FROM activity WHERE at < :cutoff OR id NOT IN (SELECT id FROM activity ORDER BY id DESC LIMIT 10000)")
    fun prune(cutoff: Long)

    @Query("SELECT * FROM activity ORDER BY id DESC LIMIT :limit")
    fun events(limit: Int): List<ActivityEvent>

    @Query("DELETE FROM browsers WHERE id = :id")
    fun deleteBrowser(id: String)
}

@Database(entities = [Browser::class, HostSettings::class, ActivityEvent::class], version = 1, exportSchema = true)
internal abstract class HostDatabase : RoomDatabase() {
    abstract fun dao(): HostDao
}

internal data class HostSnapshot(val settings: HostSettings = HostSettings(armed = false), val browsers: List<Browser> = emptyList())

/** All disk operations run off the UI thread; record authority reads use an immutable snapshot. */
internal class HostStore private constructor(private val legacy: android.content.SharedPreferences, internal val database: HostDatabase) {
    private val dao = database.dao()

    @Volatile private var loaded = false

    @Volatile var snapshot = HostSnapshot()
        private set
    val listeners = CopyOnWriteArraySet<() -> Unit>()

    @Synchronized
    fun load(): HostStore {
        if (loaded) return this
        if (dao.settings() == null) {
            database.runInTransaction {
                dao.put(HostSettings(automatic = legacy.getBoolean("wakeEnabled", false)))
                legacy.getString("grant", null)?.let { raw ->
                    val grant = JSONObject(raw)
                    val browser =
                        Browser(
                            grant.getString("id"),
                            raw,
                            "Paired browser",
                            System.currentTimeMillis(),
                            revoked = legacy.getBoolean("revoked", false),
                        )
                    dao.put(browser)
                    append("Previous pairing imported", browser)
                }
            }
        }
        // The transaction is the migration marker. A crash before this cleanup cannot reimport.
        legacy.save { remove("grant").remove("revoked").remove("wakeEnabled") }
        dao.prune(System.currentTimeMillis() - 30L * 24 * 60 * 60 * 1000)
        loaded = true
        publish()
        return this
    }

    private fun publish() {
        snapshot = HostSnapshot(requireNotNull(dao.settings()), dao.browsers())
        listeners.forEach { it() }
    }

    fun browser(id: String) = snapshot.browsers.find { it.id == id }

    fun allowed(
        id: String,
        generation: String,
        automatic: Boolean = false,
    ): Boolean {
        val state = snapshot
        val browser = state.browsers.find { it.id == id } ?: return false
        return state.settings.armed && (!automatic || state.settings.automatic) &&
            browser.enabled && !browser.revoked && browser.generation == generation
    }

    @Synchronized
    fun pair(grant: JSONObject): Browser {
        load()
        check(snapshot.browsers.size < 32) { "Remove an unused browser before adding another" }
        val id = grant.getString("id")
        check(browser(id) == null) { "Browser already paired" }
        val number = generateSequence(1) { it + 1 }.first { n -> snapshot.browsers.none { it.nickname == "Browser $n" } }
        val browser = Browser(id, grant.toString(), "Browser $number", System.currentTimeMillis())
        database.runInTransaction {
            dao.put(browser)
            append("Browser paired", browser)
        }
        publish()
        return browser
    }

    @Synchronized
    fun rename(
        id: String,
        value: String,
    ) {
        val name = value.trim()
        require(name.isNotEmpty() && name.length <= 60 && name.none { it.isISOControl() }) { "Use a name between 1 and 60 characters" }
        val browser = requireNotNull(browser(id))
        database.runInTransaction {
            dao.put(browser.copy(nickname = name))
            append("Browser renamed", browser.copy(nickname = name))
        }
        publish()
    }

    @Synchronized
    fun settings(
        armed: Boolean = snapshot.settings.armed,
        automatic: Boolean = snapshot.settings.automatic,
    ) {
        val before = snapshot.settings
        if (before.armed == armed && before.automatic == automatic) return
        database.runInTransaction {
            dao.put(HostSettings(armed = armed, automatic = automatic))
            snapshot.browsers.forEach { dao.put(it.copy(generation = generation(), synced = false, wakeReady = false)) }
            if (before.armed != armed) append(if (armed) "Remote access enabled" else "Remote access disabled")
            if (before.automatic != automatic) append(if (automatic) "Automatic requests enabled" else "Automatic requests disabled")
        }
        publish()
    }

    @Synchronized
    fun enable(
        id: String,
        enabled: Boolean,
    ) {
        val browser = requireNotNull(browser(id))
        if (browser.enabled == enabled || browser.revoked) return
        database.runInTransaction {
            dao.put(browser.copy(enabled = enabled, generation = generation(), synced = false, wakeReady = false))
            append(if (enabled) "Browser enabled" else "Browser disabled", browser)
        }
        publish()
    }

    @Synchronized
    fun revoke(id: String) {
        val browser = requireNotNull(browser(id))
        if (browser.revoked) return
        database.runInTransaction {
            dao.put(browser.copy(revoked = true, enabled = false, generation = generation(), synced = false, wakeReady = false))
            append("Browser removed locally", browser)
        }
        publish()
    }

    @Synchronized
    fun removed(id: String) {
        val browser = browser(id) ?: return
        check(browser.revoked)
        database.runInTransaction {
            dao.deleteBrowser(id)
            append("Browser removal confirmed", browser)
        }
        publish()
    }

    @Synchronized
    fun synced(
        id: String,
        generation: String,
        wakeReady: Boolean,
    ) {
        val browser = browser(id) ?: return
        if (browser.generation != generation || browser.revoked) return
        dao.put(browser.copy(synced = true, wakeReady = wakeReady))
        publish()
    }

    @Synchronized
    fun connected(id: String) {
        val browser = browser(id) ?: return
        database.runInTransaction {
            dao.put(browser.copy(lastConnected = System.currentTimeMillis()))
            append("Browser connected", browser)
        }
        publish()
    }

    @Synchronized
    fun record(
        kind: String,
        id: String? = null,
    ) {
        require(kind in EVENT_KINDS)
        database.runInTransaction { append(kind, id?.let(::browser)) }
        listeners.forEach { it() }
    }

    private fun append(
        kind: String,
        browser: Browser? = null,
    ) {
        val now = System.currentTimeMillis()
        dao.event(ActivityEvent(at = now, browserId = browser?.id, browserName = browser?.nickname, kind = kind))
        dao.prune(now - 30L * 24 * 60 * 60 * 1000)
    }

    @Synchronized
    fun events(limit: Int = 100): List<ActivityEvent> {
        dao.prune(System.currentTimeMillis() - 30L * 24 * 60 * 60 * 1000)
        return dao.events(limit.coerceIn(1, 10000))
    }

    companion object {
        private val EVENT_KINDS =
            setOf(
                "Connection requested",
                "Remote control started",
                "Connection check completed",
                "Connection failed",
                "Connection ended",
                "Disconnected on phone",
                "Session blocked: phone busy",
                "Wake setup completed",
                "Wake setup failed",
                "Access stopped on phone",
            )

        @Volatile private var instance: HostStore? = null

        fun get(context: Context): HostStore =
            instance ?: synchronized(this) {
                instance ?: HostStore(
                    WakeSupport.preferences(context.applicationContext),
                    Room.databaseBuilder(context.applicationContext, HostDatabase::class.java, "remote-access.db").build(),
                ).also {
                    instance = it
                }
            }

        fun fixture(
            context: Context,
            database: HostDatabase,
        ) = HostStore(context.getSharedPreferences("host-store-fixture", Context.MODE_PRIVATE), database)
    }
}
