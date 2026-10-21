package dev.remoteaccess.app

import android.app.Activity
import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.view.isVisible
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter

/** Public website navigation is deliberately separate from approving a device's secret pairing QR. */
internal object SharingSetup {
    fun show(
        activity: Activity,
        first: Boolean,
        scan: () -> Unit,
    ): AlertDialog {
        val density = activity.resources.displayMetrics.density

        fun dp(value: Int) = (value * density).toInt()
        val website = Website.current(activity)
        val content =
            LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(24), dp(8), dp(24), dp(8))
            }

        fun text(value: String) =
            TextView(activity).apply {
                text = value
                textSize = 16f
                setPadding(0, dp(8), 0, dp(8))
                content.addView(this)
            }

        fun button(
            label: String,
            resource: Int,
            action: () -> Unit,
        ) = Button(activity).apply {
            text = label
            id = resource
            isAllCaps = false
            setOnClickListener { action() }
            content.addView(this, LinearLayout.LayoutParams(-1, -2))
        }
        text("On another phone, tablet or computer, open:")
        text(website.removePrefix("https://")).apply {
            id = R.id.sharing_website
            setTextIsSelectable(true)
        }
        button("Copy link", R.id.copy_website) {
            activity.getSystemService(ClipboardManager::class.java)
                .setPrimaryClip(ClipData.newPlainText("YepControl website", website))
        }
        button("Share link", R.id.share_website) {
            activity.startActivity(
                Intent.createChooser(
                    Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, website),
                    "Open on another device",
                ),
            )
        }
        val qr =
            ImageView(activity).apply {
                id = R.id.website_qr
                contentDescription = "Website QR code. Opens $website; does not grant access."
                isVisible = false
                setBackgroundColor(Color.WHITE)
            }
        val show =
            button("Show website QR", R.id.show_website_qr) {
                if (qr.isVisible) {
                    qr.isVisible = false
                } else {
                    val matrix = QRCodeWriter().encode(website, BarcodeFormat.QR_CODE, 512, 512)
                    val pixels = IntArray(512 * 512) { at -> if (matrix[at % 512, at / 512]) Color.BLACK else Color.WHITE }
                    qr.setImageBitmap(Bitmap.createBitmap(pixels, 512, 512, Bitmap.Config.ARGB_8888))
                    qr.isVisible = true
                }
            }
        content.addView(qr, content.indexOfChild(show) + 1, LinearLayout.LayoutParams(-1, dp(220)))
        text(
            if (first) {
                "Create a pairing code on the website. Scan that code with this phone to approve the device."
            } else {
                "A paired device can connect without scanning again. " +
                    "To add another device, create a pairing code there and scan it below."
            },
        )
        val dialog =
            AlertDialog.Builder(activity)
                .setTitle(if (first) "Set up sharing" else "Add device")
                .setView(ScrollView(activity).apply { addView(content) })
                .setNegativeButton("Close", null)
                .create()
        button("Scan pairing code", R.id.scan_pairing_code) {
            dialog.dismiss()
            scan()
        }
        dialog.show()
        return dialog
    }
}
