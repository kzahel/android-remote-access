package dev.remoteaccess.app.control

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import dev.remoteaccess.app.HostSessions
import dev.remoteaccess.protocol.VideoQueue
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicInteger

/** One session owns the projection and a bounded mailbox. Dropping a frame requires a new keyframe. */
internal object VideoStream {
    class Request(
        val owner: Any,
        val allowed: () -> Boolean,
        @Volatile var quality: Int,
    ) {
        @Volatile var active = false

        val frames = VideoQueue()

        @Volatile var keyframe = true

        @Volatile var width = 0

        @Volatile var height = 0
        private var generation = epochs.incrementAndGet()

        @Synchronized fun reset() {
            frames.reset()
            generation = epochs.incrementAndGet()
            keyframe = true
        }

        @Synchronized fun offer(
            data: ByteArray,
            key: Boolean,
            timestamp: Long,
            w: Int,
            h: Int,
        ) {
            if (!allowed() || !active) return
            if (data.size > 524200) {
                reset()
                return
            }
            val geometry = ScreenAccessService.current?.videoGeometry(w, h) ?: return
            val packet =
                ByteBuffer.allocate(36 + data.size).putInt(generation).putInt(geometry)
                    .putInt(width).putInt(height).putInt(w).putInt(h).putInt(if (key) 1 else 0).putLong(timestamp).put(data).array()
            if (!frames.offer(packet, key)) keyframe = true
        }

        @Synchronized fun poll(): ByteArray? {
            if (!allowed() || !active) return null
            return frames.poll()
        }
    }

    private val epochs = AtomicInteger()

    @Volatile var request: Request? = null
        private set

    fun configure(
        context: Context,
        owner: Any,
        allowed: () -> Boolean,
        quality: Int,
    ): Boolean {
        if (quality == 0) {
            close(context, owner)
            return true
        }
        val old = request
        if (old?.owner === owner && old.allowed()) {
            old.quality = quality
            return true
        }
        close(context)
        if (!allowed()) return false
        request = Request(owner, allowed, quality)
        try {
            context.startActivity(Intent(context, ProjectionConsentActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) {
            request = null
            return false
        }
        return true
    }

    fun close(
        context: Context,
        owner: Any? = null,
    ) {
        val old = request ?: return
        if (owner != null && old.owner !== owner) return
        old.active = false
        request = null
        context.stopService(Intent(context, VideoService::class.java))
    }

    fun ended(stream: Request?) {
        stream?.active = false
        if (request === stream) request = null
    }

    fun available(context: Context) =
        request?.let {
            it.allowed() && it.active && !context.getSystemService(KeyguardManager::class.java).isKeyguardLocked
        } == true
}

/** Fresh system consent every time; no stored result intent or accessibility auto-approval. */
class ProjectionConsentActivity : Activity() {
    private var pending: VideoStream.Request? = null

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        val request = VideoStream.request
        if (savedInstanceState != null || request == null || !request.allowed() || HostSessions.current.get() == null) {
            finish()
            return
        }
        pending = request
        val manager = getSystemService(MediaProjectionManager::class.java)
        @Suppress("DEPRECATION")
        startActivityForResult(
            if (android.os.Build.VERSION.SDK_INT >= 34) {
                manager.createScreenCaptureIntent(
                    android.media.projection.MediaProjectionConfig.createConfigForDefaultDisplay(),
                )
            } else {
                manager.createScreenCaptureIntent()
            },
            41,
        )
    }

    @Deprecated("Activity result API is retained for this single ephemeral consent activity")
    override fun onActivityResult(
        requestCode: Int,
        resultCode: Int,
        data: Intent?,
    ) {
        super.onActivityResult(requestCode, resultCode, data)
        val request = pending
        if (requestCode == 41 && resultCode == RESULT_OK && data != null && request != null &&
            VideoStream.request === request && request.allowed()
        ) {
            startForegroundService(Intent(this, VideoService::class.java).putExtra("consent", data))
        } else if (request != null) {
            VideoStream.close(this, request.owner)
        }
        finish()
    }
}
