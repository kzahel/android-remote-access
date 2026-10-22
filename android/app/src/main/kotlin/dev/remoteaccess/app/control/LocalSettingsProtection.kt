package dev.remoteaccess.app.control

import android.os.Looper

/** Visible local settings own this gate; every remote transport uses the same input service. */
internal object LocalSettingsProtection {
    private val owners = mutableSetOf<Any>()

    @Volatile var blocked = false
        private set

    @Volatile var revision = 0L
        private set

    fun set(
        owner: Any,
        protected: Boolean,
    ) {
        check(Looper.myLooper() == Looper.getMainLooper())
        val changed = if (protected) owners.add(owner) else owners.remove(owner)
        if (!changed) return
        blocked = owners.isNotEmpty()
        revision++
        ScreenAccessService.current?.settingsChanged()
    }
}
