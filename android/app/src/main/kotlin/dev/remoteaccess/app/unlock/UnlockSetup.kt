package dev.remoteaccess.app.unlock

import android.app.Activity
import android.app.AlertDialog
import android.text.InputType
import android.view.View
import android.view.WindowManager
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import dev.remoteaccess.app.HostRuntime
import dev.remoteaccess.app.HostSessions
import dev.remoteaccess.app.R

/** Local-only credential setup. Never prefill, back up, log or return a saved PIN. */
internal object UnlockSetup {
    fun show(
        activity: Activity,
        changed: () -> Unit,
    ) {
        val vault = PinVault(activity)
        val layout =
            LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(40, 12, 40, 12)
            }
        layout.addView(
            TextView(activity).apply {
                setText(R.string.unlock_pin_explanation)
            },
        )
        val pin =
            EditText(activity).apply {
                id = R.id.save_pin_value
                hint = "Phone PIN"
                inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
                isSaveEnabled = false
                importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
            }
        val confirm =
            EditText(activity).apply {
                id = R.id.save_pin_confirm
                hint = "Confirm PIN"
                inputType = pin.inputType
                isSaveEnabled = false
                importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
            }
        layout.addView(pin)
        layout.addView(confirm)
        val dialog =
            AlertDialog.Builder(activity).setTitle("Save phone PIN").setView(layout).setNegativeButton("Cancel", null)
                .setPositiveButton("Save", null).create()
        dialog.setOnDismissListener {
            pin.text.clear()
            confirm.text.clear()
        }
        dialog.setOnShowListener {
            dialog.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val value = pin.text.toString()
                if (!value.matches(Regex("[0-9]{4,16}")) || value != confirm.text.toString()) {
                    confirm.error = "Enter the same 4–16 digit PIN in both fields"
                    return@setOnClickListener
                }
                val secret = value.toCharArray()
                pin.text.clear()
                confirm.text.clear()
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = false
                HostRuntime.io.execute {
                    val saved = runCatching { vault.save(secret) }.isSuccess
                    secret.fill('\u0000')
                    activity.runOnUiThread {
                        if (saved) {
                            dialog.dismiss()
                            changed()
                        } else {
                            confirm.error = "Couldn’t save the PIN. Try again."
                            dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = true
                        }
                    }
                }
            }
        }
        dialog.show()
    }

    fun forget(
        activity: Activity,
        changed: () -> Unit,
    ) {
        AlertDialog.Builder(
            activity,
        ).setTitle(
            "Forget saved PIN?",
        ).setMessage("Remote sessions will end. Manual PIN entry stays available to devices allowed to unlock.")
            .setNegativeButton("Cancel", null).setPositiveButton("Forget") { _, _ ->
                HostSessions.stop()
                HostRuntime.io.execute {
                    PinVault(activity).forget()
                    activity.runOnUiThread(changed)
                }
            }.show()
    }
}
