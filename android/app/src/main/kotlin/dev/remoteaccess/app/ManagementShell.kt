package dev.remoteaccess.app

import android.app.Activity
import android.content.res.ColorStateList
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.view.GravityCompat
import androidx.drawerlayout.widget.DrawerLayout

/** Stable chrome: status refreshes replace only the page body, preserving the drawer and scroll. */
internal class ManagementShell(
    private val activity: Activity,
    private val back: () -> Unit,
    private val navigate: (String) -> Unit,
    private val connect: () -> Unit,
) {
    private fun dp(value: Int) = (value * activity.resources.displayMetrics.density).toInt()

    private fun color(attr: Int): Int = TypedValue().also { activity.theme.resolveAttribute(attr, it, true) }.data

    val drawer = DrawerLayout(activity)
    private val sidebar = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
    private val toolbar = LinearLayout(activity).apply { gravity = Gravity.CENTER_VERTICAL }
    private val navigation = ImageButton(activity)
    private val title = TextView(activity)
    private val scroll = ScrollView(activity).apply { isFillViewport = true }
    val body = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
    private val links = mutableMapOf<String, TextView>()
    private var current = ""
    private var revision = 0
    private var scrollPosition = 0

    init {
        val content = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        drawer.addView(content, DrawerLayout.LayoutParams(-1, -1))
        drawer.addView(
            sidebar,
            DrawerLayout.LayoutParams(
                dp(304).coerceAtMost(activity.resources.displayMetrics.widthPixels - dp(56)),
                -1,
                GravityCompat.START,
            ),
        )
        drawer.setDrawerTitle(GravityCompat.START, "Navigation")
        drawer.setBackgroundColor(color(android.R.attr.colorBackground))
        sidebar.setBackgroundColor(color(R.attr.surfaceColor))
        content.setOnApplyWindowInsetsListener { view, insets ->
            val bars = insets.getInsets(WindowInsets.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            sidebar.setPadding(bars.left + dp(12), bars.top, bars.right + dp(12), bars.bottom + dp(16))
            insets
        }
        toolbar.setBackgroundColor(color(R.attr.surfaceColor))
        navigation.apply {
            minimumWidth = dp(56)
            background = ripple()
            imageTintList = ColorStateList.valueOf(color(android.R.attr.textColorPrimary))
            setOnClickListener { if (isTopLevel()) drawer.openDrawer(GravityCompat.START) else back() }
        }
        toolbar.addView(navigation, LinearLayout.LayoutParams(dp(56), dp(56)))
        title.apply {
            id = R.id.page_title
            textSize = 22f
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            setTextColor(color(android.R.attr.textColorPrimary))
            setTypeface(null, Typeface.BOLD)
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
            isAccessibilityHeading = true
        }
        toolbar.addView(title, LinearLayout.LayoutParams(0, -2, 1f))
        content.addView(toolbar, LinearLayout.LayoutParams(-1, dp(64)))
        content.addView(View(activity).apply { setBackgroundColor(color(R.attr.outlineColor)) }, LinearLayout.LayoutParams(-1, dp(1)))
        body.setPadding(dp(20), dp(16), dp(20), dp(32))
        scroll.addView(body)
        content.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        val heading = LinearLayout(activity).apply { gravity = Gravity.CENTER_VERTICAL }
        heading.addView(
            TextView(activity).apply {
                setText(R.string.navigation_heading)
                textSize = 22f
                setTypeface(null, Typeface.BOLD)
                setPadding(dp(16), dp(24), 0, dp(24))
            },
            LinearLayout.LayoutParams(0, -2, 1f),
        )
        heading.addView(
            ImageButton(activity).apply {
                contentDescription = "Close navigation"
                setImageResource(R.drawable.ic_close)
                imageTintList = ColorStateList.valueOf(color(android.R.attr.textColorPrimary))
                background = ripple()
                setOnClickListener { closeDrawer() }
            },
            LinearLayout.LayoutParams(dp(48), dp(48)),
        )
        sidebar.addView(heading)
        link("home", "Home", R.id.open_home, R.drawable.ic_home)
        link("activity", "Activity", R.id.open_activity, R.drawable.ic_activity)
        link("settings", "Settings", R.id.open_settings, R.drawable.ic_settings)
        sidebar.addView(View(activity), LinearLayout.LayoutParams(-1, 0, 1f))
        sidebar.addView(
            TextView(activity).apply {
                setText(R.string.how_to_connect)
                textSize = 16f
                gravity = Gravity.CENTER_VERTICAL
                minHeight = dp(56)
                setPadding(dp(16), 0, dp(16), 0)
                background = ripple()
                isClickable = true
                isFocusable = true
                setOnClickListener {
                    closeDrawer()
                    connect()
                }
            },
            LinearLayout.LayoutParams(-1, -2),
        )
        activity.setContentView(drawer)
        val flags =
            android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
        activity.window.insetsController?.setSystemBarsAppearance(if (Appearance.dark(activity)) 0 else flags, flags)
    }

    private fun isTopLevel() = current in setOf("home", "activity", "settings")

    fun closeDrawer(): Boolean {
        if (!drawer.isDrawerOpen(GravityCompat.START)) return false
        drawer.closeDrawer(GravityCompat.START)
        return true
    }

    fun page(
        page: String,
        label: String,
    ) {
        scrollPosition = if (current == page) scroll.scrollY else 0
        current = page
        title.text = label
        navigation.id = if (isTopLevel()) R.id.navigation_menu else R.id.navigate_back
        navigation.contentDescription = if (isTopLevel()) "Open navigation" else "Back"
        navigation.setImageResource(if (isTopLevel()) R.drawable.ic_menu else R.drawable.ic_back)
        val selected =
            when (page) {
                "home", "features", "grant" -> "home"
                "activity" -> "activity"
                else -> "settings"
            }
        links.forEach { (key, link) ->
            link.isSelected = selected == key
            link.setTypeface(null, if (selected == key) Typeface.BOLD else Typeface.NORMAL)
            link.background = ripple(selected == key)
        }
        body.removeAllViews()
        revision++
        restoreScroll()
    }

    fun restoreScroll() {
        val version = revision
        val y = scrollPosition
        scroll.post { if (version == revision) scroll.scrollTo(0, y) }
    }

    private fun ripple(selected: Boolean = false) =
        RippleDrawable(
            ColorStateList.valueOf(color(android.R.attr.colorControlHighlight)),
            GradientDrawable().apply {
                cornerRadius = dp(12).toFloat()
                setColor(if (selected) color(R.attr.accentSurfaceColor) else android.graphics.Color.TRANSPARENT)
            },
            null,
        )

    private fun link(
        page: String,
        label: String,
        resource: Int,
        icon: Int,
    ) {
        val row =
            TextView(activity).apply {
                id = resource
                text = label
                textSize = 17f
                gravity = Gravity.CENTER_VERTICAL
                minHeight = dp(56)
                setPadding(dp(16), 0, dp(16), 0)
                setCompoundDrawablesRelativeWithIntrinsicBounds(icon, 0, 0, 0)
                compoundDrawableTintList = ColorStateList.valueOf(color(android.R.attr.colorAccent))
                compoundDrawablePadding = dp(16)
                isClickable = true
                isFocusable = true
                setOnClickListener {
                    closeDrawer()
                    navigate(page)
                }
            }
        links[page] = row
        sidebar.addView(row, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(4) })
    }
}
