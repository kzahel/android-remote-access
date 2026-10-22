package dev.remoteaccess.app

import android.content.Context
import android.content.res.Configuration

/** Local presentation preference; it has no bearing on remote access authority. */
internal object Appearance {
    fun choice(context: Context): String =
        context
            .getSharedPreferences("appearance", Context.MODE_PRIVATE)
            .getString("mode", "system")
            ?.takeIf { it in setOf("system", "light", "dark") } ?: "system"

    fun save(
        context: Context,
        mode: String,
    ) {
        require(mode in setOf("system", "light", "dark"))
        context.getSharedPreferences("appearance", Context.MODE_PRIVATE).save { putString("mode", mode) }
    }

    fun dark(context: Context): Boolean =
        when (choice(context)) {
            "dark" -> true
            "light" -> false
            else -> context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
        }

    fun theme(context: Context): Int = if (dark(context)) R.style.Theme_RemoteAccess_Dark else R.style.Theme_RemoteAccess_Light
}
