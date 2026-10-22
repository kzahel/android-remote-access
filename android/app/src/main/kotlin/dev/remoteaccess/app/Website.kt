package dev.remoteaccess.app

import android.content.Context

/**
 * Build-configured service origins. The selected website also pins new enrollment; existing
 * grants may use either configured origin so a debug website switch does not strand them.
 */
internal object Website {
    val developmentAvailable get() = BuildConfig.DEBUG && BuildConfig.DEV_SHARING_WEBSITE.isNotEmpty()

    fun accepts(origin: String): Boolean =
        origin == BuildConfig.SHARING_WEBSITE || (developmentAvailable && origin == BuildConfig.DEV_SHARING_WEBSITE)

    fun requireConfigured(origin: String) {
        require(accepts(origin)) { "Service origin is not configured in this build" }
    }

    fun development(context: Context): Boolean =
        developmentAvailable && context.getSharedPreferences("website", Context.MODE_PRIVATE).getBoolean("development", false)

    fun setDevelopment(
        context: Context,
        enabled: Boolean,
    ) {
        check(developmentAvailable)
        context.getSharedPreferences("website", Context.MODE_PRIVATE).save { putBoolean("development", enabled) }
    }

    fun current(context: Context): String = if (development(context)) BuildConfig.DEV_SHARING_WEBSITE else BuildConfig.SHARING_WEBSITE
}
