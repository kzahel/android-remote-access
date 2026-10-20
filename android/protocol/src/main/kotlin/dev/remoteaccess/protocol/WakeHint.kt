package dev.remoteaccess.protocol

/** Untrusted delivery metadata: only a hint to fetch authenticated pending authority. */
data class WakeHint(val requestId: String, val expires: Long, val pairingId: String? = null, val generation: String? = null) {
    companion object {
        fun parse(
            data: Map<String, String>,
            nowMillis: Long,
        ): WakeHint? {
            if (data["intent"] != "connect-v1") return null
            val requestId = data["requestId"] ?: return null
            if (!requestId.matches(Regex("[0-9a-f]{32}"))) return null
            val expires = data["expires"]?.toLongOrNull() ?: return null
            if (expires <= nowMillis / 1000 || expires > nowMillis / 1000 + 61) return null
            val pair = data["pairingId"]
            val generation = data["generation"]
            if ((pair != null || generation != null) &&
                (pair?.matches(Regex("[0-9a-f]{32}")) != true || generation?.matches(Regex("[0-9a-f]{32}")) != true)
            ) {
                return null
            }
            return WakeHint(requestId, expires, pair, generation)
        }
    }
}
