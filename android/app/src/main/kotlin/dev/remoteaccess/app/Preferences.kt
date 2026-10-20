package dev.remoteaccess.app

import android.annotation.SuppressLint
import android.content.SharedPreferences

/** Unlike KTX edit, surface synchronous persistence failure to the caller. */
@SuppressLint("UseKtx")
internal fun SharedPreferences.save(change: SharedPreferences.Editor.() -> Unit) {
    check(edit().apply(change).commit())
}
