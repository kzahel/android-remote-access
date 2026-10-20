package dev.remoteaccess.app

import androidx.room.testing.MigrationTestHelper
import androidx.test.platform.app.InstrumentationRegistry
import dev.remoteaccess.app.unlock.PinVault
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFails
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class UnlockStorageTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @get:Rule val migration = MigrationTestHelper(InstrumentationRegistry.getInstrumentation(), HostDatabase::class.java)

    @Test fun migrationKeepsOldGrantsAndDoesNotGrantUnlock() {
        migration.createDatabase("unlock-migration-fixture", 1).use { db ->
            db.execSQL("INSERT INTO browsers VALUES ('a','{}','Work laptop',123,456,1,1,'old-generation',1,1)")
            db.execSQL("INSERT INTO settings VALUES (1,0,1)")
        }
        migration.runMigrationsAndValidate("unlock-migration-fixture", 2, true, HostStore.MIGRATION_1_2).use { db ->
            db.query("SELECT nickname, revoked, generation, unlockAllowed FROM browsers WHERE id='a'").use { row ->
                assertTrue(row.moveToFirst())
                assertEquals("Work laptop", row.getString(0))
                assertEquals(1, row.getInt(1))
                assertEquals("old-generation", row.getString(2))
                assertEquals(0, row.getInt(3))
            }
        }
    }

    @Test fun nativeEncryptionForgetAndAttemptLatchSurviveNewInstances() {
        val directory = File(context.cacheDir, "vault-fixture-${UUID.randomUUID()}").apply { mkdirs() }
        val alias = "vault-fixture-${UUID.randomUUID()}"

        fun vault() = PinVault(context, alias, directory)
        try {
            val value = "314159".toCharArray() // Synthetic, never a phone owner's credential.
            vault().save(value)
            assertTrue(value.all { it == '\u0000' })
            val stored = File(directory, "saved-unlock-pin").readBytes()
            assertFalse(String(stored).contains("314159"))
            val recovered = vault().read()
            assertEquals("314159", String(recovered))
            recovered.fill('\u0000')
            vault().guard.begin()
            assertFails { vault().guard.begin() }
            vault().forget()
            assertFalse(vault().saved())
            assertFails { vault().read() }
            assertTrue(vault().guard.blocked(), "Forgetting must not reset an uncertain attempt")
            vault().guard.observeUnlocked()
            assertFalse(vault().guard.blocked())
        } finally {
            vault().forget()
            directory.deleteRecursively()
        }
    }
}
