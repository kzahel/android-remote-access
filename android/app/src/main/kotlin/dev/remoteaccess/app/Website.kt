package dev.remoteaccess.app

import android.content.Context

/**
 * The public website link shown for sharing setup. Debug builds configured with a development
 * origin can switch to it; pairing always uses the relay origin carried by each scanned QR.
 */
internal object Website {
    val developmentAvailable get() = BuildConfig.DEV_SHARING_WEBSITE.isNotEmpty()

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
