package dev.remoteaccess.app

import dev.remoteaccess.protocol.Crypto
import dev.remoteaccess.protocol.JcaIdentity
import org.json.JSONObject
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFails

class EnrollmentLinkTest {
    @Test fun validatesHttpsOriginAndFragmentWithoutNetwork() {
        val identity = Crypto.generate().let { JcaIdentity(it.private, it.public) }
        val invite =
            JSONObject().put("v", 1).put("origin", "https://yepcontrol.com")
                .put("id", "11".repeat(16)).put("secret", "22".repeat(32)).put("viewer", encoded(identity.publicKey))
                .put("expires", System.currentTimeMillis() / 1000 + 300).put("name", "Chrome on macOS")
        val fragment = encoded(invite.toString().toByteArray(Charsets.UTF_8))
        val link = "https://yepcontrol.com/enroll#$fragment"
        assertEquals("https://yepcontrol.com", Enrollment(link).origin)
        assertEquals("Chrome on macOS", Enrollment(link).name)
        for (bad in listOf(
            "https://other.example/enroll#$fragment",
            "http://yepcontrol.com/enroll#$fragment",
            "https://yepcontrol.com/enroll?secret=leak#$fragment",
            "https://yepcontrol.com/other#$fragment",
            "https://user@yepcontrol.com/enroll#$fragment",
            "https://yepcontrol.com/enroll",
            "ara-pair://enroll#$fragment",
        )) {
            assertFails { Enrollment(bad) }
        }
    }
}
