package dev.remoteaccess.app

import android.app.Activity
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import org.json.JSONObject
import java.util.concurrent.Executors

/** Foreground development host. Capture/input and background wake are later slices. */
class MainActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var grantButton: Button
    private lateinit var connectButton: Button
    private lateinit var revokeButton: Button
    private val worker = Executors.newSingleThreadExecutor()
    private val preferences by lazy { getSharedPreferences("paired-browser-v1", MODE_PRIVATE) }
    private val identity by lazy { KeystoreIdentity.loadOrCreate("phone-identity-v1") }
    private var pending: Enrollment? = null
    private var connection: RelayConnection? = null
    private var busy = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout =
            LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(36, 64, 36, 36)
            }
        layout.addView(
            TextView(this).apply {
                setText(R.string.app_name)
                textSize = 26f
            },
        )
        layout.addView(
            TextView(this).apply {
                setText(R.string.development_description)
            },
        )
        status =
            TextView(this).apply {
                textSize = 18f
                setPadding(0, 32, 0, 32)
            }
        layout.addView(status)
        layout.addView(
            Button(this).apply {
                setText(R.string.pair_browser)
                setOnClickListener {
                    if (!busy) {
                        GmsBarcodeScanning.getClient(this@MainActivity).startScan().addOnSuccessListener {
                                code ->
                            showInvitation(code.rawValue ?: "")
                        }.addOnFailureListener { report("Scanner unavailable. Try again when Play services is ready.") }
                    }
                }
            },
        )
        grantButton =
            Button(this).apply {
                setText(R.string.grant_browser)
                visibility = View.GONE
                setOnClickListener { grant() }
            }
        connectButton =
            Button(this).apply {
                setText(R.string.connect_phone)
                setOnClickListener { connect() }
            }
        revokeButton =
            Button(this).apply {
                setText(R.string.remove_browser)
                setOnClickListener { revoke() }
            }
        layout.addView(grantButton)
        layout.addView(connectButton)
        layout.addView(revokeButton)
        setContentView(layout)
        report(if (saved() == null) "Pair this phone with your browser" else "Browser paired. Tap Connect.")
        intent.dataString?.let { showInvitation(it) }
    }

    private fun saved(): JSONObject? = preferences.getString("grant", null)?.let { JSONObject(it) }

    private fun showInvitation(uri: String) {
        try {
            check(!busy)
            check(saved() == null) { "Remove the existing browser before pairing another" }
            pending = Enrollment(uri)
            grantButton.visibility = View.VISIBLE
            report("Grant this browser access through ${pending?.origin}? Only scan a code from your own browser.")
        } catch (e: Exception) {
            pending = null
            grantButton.visibility = View.GONE
            report(e.message ?: "Invalid pairing code")
        }
    }

    private fun grant() {
        val invitation = pending ?: return
        if (busy) return
        busy = true
        grantButton.isEnabled = false
        report("Waiting for browser confirmation…")
        worker.execute {
            try {
                val accepted = invitation.grant(identity)
                check(preferences.edit().putString("grant", accepted.toString()).commit())
                runOnUiThread {
                    pending = null
                    grantButton.visibility = View.GONE
                    report("Browser paired. Tap Connect.")
                }
            } catch (
                e: Exception,
            ) {
                report(e.message ?: "Pairing failed")
            } finally {
                runOnUiThread {
                    busy = false
                    grantButton.isEnabled = true
                }
            }
        }
    }

    private fun connect() {
        val grant = saved() ?: return report("Pair a browser first")
        if (busy || preferences.getBoolean("revoked", false)) return report("Finish removing this browser before reconnecting")
        connection?.close()
        connection = RelayConnection(identity, grant, ::report).also { it.connect() }
        report("Connecting…")
    }

    private fun revoke() {
        if (busy) return
        val grant = saved() ?: return report("No paired browser")
        connection?.close()
        connection = null
        check(preferences.edit().putBoolean("revoked", true).commit())
        busy = true
        revokeButton.isEnabled = false
        worker.execute {
            try {
                val signature = identity.sign(fields("ara/pair/revoke/v1", grant.getString("origin"), grant.getString("id")))
                request(grant.getString("origin"), grant.getString("id"), "revoke", JSONObject().put("signature", encoded(signature)))
                check(preferences.edit().remove("grant").remove("revoked").commit())
                report("Browser removed")
            } catch (
                _: Exception,
            ) {
                report("Browser blocked locally while disconnected. Tap Remove browser again to finish revocation.")
            } finally {
                runOnUiThread {
                    busy = false
                    revokeButton.isEnabled = true
                }
            }
        }
    }

    private fun report(message: String) {
        runOnUiThread { if (!isDestroyed) status.text = message }
    }

    override fun onDestroy() {
        connection?.close()
        worker.shutdownNow()
        super.onDestroy()
    }
}
