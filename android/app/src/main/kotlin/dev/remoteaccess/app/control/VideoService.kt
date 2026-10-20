package dev.remoteaccess.app.control

import android.app.Activity
import android.app.KeyguardManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.view.Surface
import android.view.WindowManager
import java.util.concurrent.atomic.AtomicBoolean

/** User-consented H.264 encoder. All encoder/display resources have one worker owner. */
class VideoService : Service() {
    private val running = AtomicBoolean(false)
    private var projection: MediaProjection? = null
    private var request: VideoStream.Request? = null

    @Volatile private var resize: Pair<Int, Int>? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(
        intent: Intent?,
        flags: Int,
        startId: Int,
    ): Int {
        if (running.get()) return START_NOT_STICKY
        val current = VideoStream.request

        @Suppress("DEPRECATION")
        val consent = intent?.getParcelableExtra<Intent>("consent")
        if (current == null || consent == null || !current.allowed()) {
            stopSelf()
            return START_NOT_STICKY
        }
        request = current
        try {
            startForeground(102, SessionService.notification(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
            val capture = checkNotNull(getSystemService(MediaProjectionManager::class.java).getMediaProjection(Activity.RESULT_OK, consent))
            projection = capture
            capture.registerCallback(
                object : MediaProjection.Callback() {
                    override fun onStop() {
                        stopSelf()
                    }

                    override fun onCapturedContentResize(
                        width: Int,
                        height: Int,
                    ) {
                        resize = width to height
                    }
                },
                Handler(Looper.getMainLooper()),
            )
            running.set(true)
            current.active = true
            Thread({ encode(capture, current) }, "screen-encoder").start()
        } catch (_: Exception) {
            stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun encode(
        capture: MediaProjection,
        stream: VideoStream.Request,
    ) {
        var encoder: MediaCodec? = null
        var surface: Surface? = null
        var display: VirtualDisplay? = null
        try {
            val bounds = getSystemService(WindowManager::class.java).maximumWindowMetrics.bounds
            var source = bounds.width() to bounds.height()
            var quality = 0
            var configuration = byteArrayOf()
            val info = MediaCodec.BufferInfo()

            fun configure() {
                display?.surface = null
                encoder?.stop()
                encoder?.release()
                surface?.release()
                quality = stream.quality
                val factor = minOf(1.0, (if (quality == 1) 480.0 else 720.0) / minOf(source.first, source.second))
                val width = ((source.first * factor).toInt() / 2 * 2).coerceAtLeast(2)
                val height = ((source.second * factor).toInt() / 2 * 2).coerceAtLeast(2)
                stream.width = width
                stream.height = height
                val fps =
                    when (quality) {
                        1 -> 10
                        3 -> 60
                        else -> 30
                    }
                val format =
                    MediaFormat.createVideoFormat("video/avc", width, height).apply {
                        setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
                        setInteger(
                            MediaFormat.KEY_BIT_RATE,
                            when (quality) {
                                1 -> 400000
                                3 -> 4000000
                                else -> 1500000
                            },
                        )
                        setInteger(MediaFormat.KEY_FRAME_RATE, fps)
                        setFloat(MediaFormat.KEY_MAX_FPS_TO_ENCODER, fps.toFloat())
                        setLong(MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, 500000)
                        setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
                        setInteger(MediaFormat.KEY_PROFILE, MediaCodecInfo.CodecProfileLevel.AVCProfileBaseline)
                        setInteger(MediaFormat.KEY_MAX_B_FRAMES, 0)
                    }
                val codec = MediaCodec.createEncoderByType("video/avc")
                encoder = codec
                codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                surface = codec.createInputSurface()
                codec.start()
                val density = resources.displayMetrics.densityDpi
                if (display == null) {
                    display =
                        capture.createVirtualDisplay(
                            "Remote screen", width, height, density,
                            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, surface, null, null,
                        )
                } else {
                    display?.resize(width, height, density)
                    display?.surface = surface
                }
                configuration = byteArrayOf()
                stream.reset()
            }
            configure()
            while (running.get() && VideoStream.request === stream && stream.allowed() &&
                !getSystemService(KeyguardManager::class.java).isKeyguardLocked
            ) {
                resize?.let {
                    if (it.first > 0 && it.second > 0 && it != source) {
                        source = it
                        quality = 0
                    }
                    resize = null
                }
                if (stream.quality != quality) configure()
                val codec = checkNotNull(encoder)
                if (stream.keyframe) {
                    stream.keyframe = false
                    codec.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0) })
                }
                val index = codec.dequeueOutputBuffer(info, 20000)
                if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    val format = codec.outputFormat
                    configuration =
                        listOf("csd-0", "csd-1").flatMap { name ->
                            format.getByteBuffer(name)?.let { b -> ByteArray(b.remaining()).also { b.get(it) }.toList() } ?: emptyList()
                        }.toByteArray()
                } else if (index >= 0) {
                    val bytes = ByteArray(info.size)
                    codec.getOutputBuffer(index)?.apply {
                        position(info.offset)
                        get(bytes)
                    }
                    codec.releaseOutputBuffer(index, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
                        configuration = bytes
                    } else if (bytes.isNotEmpty()) {
                        val key = info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0
                        stream.offer(if (key) configuration + bytes else bytes, key, info.presentationTimeUs, source.first, source.second)
                    }
                }
            }
        } catch (_: Exception) {
            // Still frames remain available. A new projection requires fresh system consent.
        } finally {
            stream.active = false
            runCatching { display?.release() }
            runCatching { encoder?.stop() }
            runCatching { encoder?.release() }
            surface?.release()
            Handler(Looper.getMainLooper()).post { stopSelf() }
        }
    }

    override fun onDestroy() {
        running.set(false)
        VideoStream.ended(request)
        projection?.stop()
        projection = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
}
