package dev.remoteaccess.app

import dev.remoteaccess.protocol.Crypto
import dev.remoteaccess.protocol.Identity
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.net.URI
import java.util.Base64
import java.util.concurrent.TimeUnit
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

internal fun encoded(value: ByteArray): String = Base64.getEncoder().encodeToString(value)

internal fun decoded(value: String): ByteArray = Base64.getDecoder().decode(value)

internal fun fields(vararg values: Any): ByteArray {
    require(values.none { it.toString().contains('\n') })
    return values.joinToString("\n").toByteArray(Charsets.UTF_8)
}

internal fun unhex(
    value: String,
    size: Int,
): ByteArray {
    require(value.matches(Regex("[0-9a-f]{${size * 2}}")))
    return value.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
}

internal fun grantBytes(
    origin: String,
    grant: JSONObject,
): ByteArray =
    fields(
        "ara/pair/grant/v1",
        origin,
        grant.getString("id"),
        grant.getString("viewer"),
        grant.getString("phone"),
        grant.getLong("expires"),
    )

internal val http =
    OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .callTimeout(20, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .build()

internal fun request(
    origin: String,
    id: String,
    action: String = "",
    body: JSONObject? = null,
    seen: String? = null,
): JSONObject {
    val url = "$origin/api/pair/$id" + if (action.isEmpty()) "" else "/$action"
    val request = Request.Builder().url(url)
    // The relay holds this poll until the pairing state differs from `seen`.
    if (seen != null) request.header("Pair-Wait", seen)
    if (body != null) request.post(body.toString().toRequestBody("application/json".toMediaType()))
    return http.newCall(request.build()).execute().use {
        check(it.isSuccessful) { "Pairing expired, revoked, or unavailable" }
        val source = it.body ?: error("Missing reply")
        require(source.contentLength() <= 8192)
        val buffer = ByteArray(8193)
        var size = 0
        val stream = source.byteStream()
        while (size < buffer.size) {
            val count = stream.read(buffer, size, buffer.size - size)
            if (count < 0) break
            size += count
        }
        require(size <= 8192)
        JSONObject(buffer.copyOf(size).toString(Charsets.UTF_8))
    }
}

internal fun validDeviceName(name: String) = name == name.trim() && name.length in 1..40 && name.none { it.isISOControl() }

internal class Enrollment(uri: String) {
    private val invite: JSONObject
    val origin: String

    /** Device-chosen label; shown to the owner as a convenience, never as proof of identity. */
    val name: String?

    init {
        require(uri.startsWith("ara-pair://enroll#") && uri.length < 4096)
        invite = JSONObject(decoded(uri.substring(18)).toString(Charsets.UTF_8))
        require(invite.getInt("v") == 1)
        origin = invite.getString("origin")
        val url = URI(origin)
        require(
            url.scheme == "https" && url.host != null && url.rawUserInfo == null &&
                url.rawQuery == null && url.rawFragment == null && url.rawPath.isEmpty(),
        )
        name = if (invite.has("name")) invite.getString("name") else null
        require(name == null || validDeviceName(name))
        unhex(invite.getString("id"), 16)
        unhex(invite.getString("secret"), 32)
        Crypto.publicKey(decoded(invite.getString("viewer")))
        checkTime()
    }

    private fun checkTime() {
        val remaining = invite.getLong("expires") * 1000 - System.currentTimeMillis()
        require(remaining in 1..301000) { "Pairing code expired" }
    }

    fun grant(
        identity: Identity,
        cancelled: () -> Boolean = { false },
    ): JSONObject {
        checkTime()
        val id = invite.getString("id")
        val grant =
            JSONObject().put(
                "id",
                id,
            ).put("viewer", invite.getString("viewer")).put("phone", encoded(identity.publicKey)).put("expires", invite.getLong("expires"))
        val data = grantBytes(origin, grant)
        val mac =
            Mac.getInstance("HmacSHA256").run {
                init(SecretKeySpec(unhex(invite.getString("secret"), 32), "HmacSHA256"))
                doFinal(data).joinToString("") { "%02x".format(it) }
            }
        grant.put("phoneSignature", encoded(identity.sign(data))).put("mac", mac)
        request(origin, id, "offer", grant)
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(90)
        var seen = "offered"
        while (System.nanoTime() < deadline) {
            checkTime()
            check(!cancelled()) { "Cancelled" }
            val asked = System.nanoTime()
            val reply = request(origin, id, seen = seen)
            seen = reply.getString("state")
            if (seen == "paired") {
                val accepted = reply.getJSONObject("grant")
                require(grantBytes(origin, accepted).contentEquals(data))
                Crypto.verify(decoded(grant.getString("viewer")), data, decoded(accepted.getString("viewerSignature")))
                return accepted.put("origin", origin)
            }
            // A relay without held polls answers at once; keep the earlier pace.
            if (System.nanoTime() - asked < TimeUnit.MILLISECONDS.toNanos(500)) Thread.sleep(750)
        }
        error("Device did not confirm. Create a fresh code.")
    }
}
