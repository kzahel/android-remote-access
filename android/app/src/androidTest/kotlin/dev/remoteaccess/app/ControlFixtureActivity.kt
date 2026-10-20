package dev.remoteaccess.app

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject
import java.io.File

/** Independent Android effects witness, only in the instrumentation APK. */
class ControlFixtureActivity : Activity() {
    private var taps = 0
    private var entered = ""
    private lateinit var target: Button
    private lateinit var field: EditText
    private lateinit var scroll: ScrollView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val content =
            LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(40, 100, 40, 40)
                setBackgroundColor(Color.rgb(225, 242, 255))
            }
        content.addView(
            TextView(this).apply {
                text = "Remote control fixture"
                textSize = 24f
            },
        )
        target =
            Button(this).apply {
                text = "Tap witness"
                setOnClickListener {
                    taps++
                    text = "Tapped $taps"
                    witness()
                }
            }
        field =
            EditText(this).apply {
                hint = "Type witness"
                isSingleLine = true
                addTextChangedListener(
                    object : TextWatcher {
                        override fun beforeTextChanged(
                            s: CharSequence?,
                            start: Int,
                            count: Int,
                            after: Int,
                        ) = Unit

                        override fun onTextChanged(
                            s: CharSequence?,
                            start: Int,
                            before: Int,
                            count: Int,
                        ) {
                            entered = s.toString()
                            witness()
                        }

                        override fun afterTextChanged(s: Editable?) = Unit
                    },
                )
            }
        content.addView(target, LinearLayout.LayoutParams(-1, 160))
        content.addView(field, LinearLayout.LayoutParams(-1, 160))
        repeat(40) { i ->
            content.addView(
                TextView(this).apply {
                    text = "Scroll item $i"
                    textSize = 22f
                    setPadding(0, 30, 0, 30)
                },
            )
        }
        scroll =
            ScrollView(this).apply {
                addView(content)
                setOnScrollChangeListener { _: View, _: Int, _: Int, _: Int, _: Int -> witness() }
            }
        setContentView(scroll)
        scroll.post { witness() }
    }

    private fun witness() {
        if (!::scroll.isInitialized) return

        fun center(view: View): JSONObject {
            val location = IntArray(2)
            view.getLocationOnScreen(location)
            return JSONObject().put("x", location[0] + view.width / 2).put("y", location[1] + view.height / 2)
        }
        val value =
            JSONObject().put("taps", taps).put("text", entered).put("scroll", scroll.scrollY)
                .put("target", center(target)).put("field", center(field))
        val next = File(filesDir, "control-witness.next")
        next.writeText(value.toString())
        check(next.renameTo(File(filesDir, "control-witness.json")))
    }
}
