import java.net.URI
import java.util.Properties

plugins {
    id("com.android.application")
    kotlin("android")
    id("com.google.devtools.ksp")
    id("org.jlleitschuh.gradle.ktlint")
    id("com.google.gms.google-services")
}

fun requireOrigin(value: String) {
    val uri = URI(value)
    require(
        uri.scheme == "https" && uri.host != null && uri.rawUserInfo == null &&
            uri.rawQuery == null && uri.rawFragment == null && uri.rawPath.isNullOrEmpty(),
    ) { "Expected an HTTPS origin without a trailing slash: $value" }
}
val sharingWebsite = providers.gradleProperty("sharingWebsite").orElse("https://yepcontrol.com").get()
requireOrigin(sharingWebsite)
// Optional local relay (e.g. `pnpm dev` over Tailscale); debug builds offer it as a Settings switch.
val localProperties =
    Properties().apply {
        rootProject.file("local.properties").takeIf { it.exists() }?.reader()?.use { load(it) }
    }
val devSharingWebsite =
    providers.gradleProperty("devSharingWebsite").orNull ?: localProperties.getProperty("devSharingWebsite", "")
if (devSharingWebsite.isNotEmpty()) requireOrigin(devSharingWebsite)

val releaseVersion = Properties().apply { rootProject.file("version.properties").reader().use { load(it) } }

android {
    namespace = "dev.remoteaccess.app"
    compileSdk = 36
    buildFeatures { buildConfig = true }
    defaultConfig {
        applicationId = "com.yepcontrol.app"
        minSdk = 30
        targetSdk = 36
        versionCode = releaseVersion.getProperty("VERSION_CODE").toInt()
        versionName = releaseVersion.getProperty("VERSION_NAME")
        buildConfigField("String", "SHARING_WEBSITE", "\"$sharingWebsite\"")
        buildConfigField("String", "DEV_SHARING_WEBSITE", "\"\"")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildTypes {
        getByName("debug") { buildConfigField("String", "DEV_SHARING_WEBSITE", "\"$devSharingWebsite\"") }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    sourceSets["androidTest"].assets.srcDir("../../protocol/vectors")
    sourceSets["androidTest"].assets.srcDir("$projectDir/schemas")
    lint {
        abortOnError = true
        warningsAsErrors = true
    }
}
ksp { arg("room.schemaLocation", "$projectDir/schemas") }
kotlin { compilerOptions { allWarningsAsErrors.set(true) } }
dependencies {
    // Native modal navigation drawer, with RTL and accessibility support.
    implementation("androidx.drawerlayout:drawerlayout:1.2.0")
    // Reviewed Apache-2.0 QR encoder; generates public website links only.
    //noinspection NewerVersionAvailable
    implementation("com.google.zxing:core:3.5.4")
    // Unused-app restrictions and their system settings entry point.
    //noinspection GradleDependency
    implementation("androidx.core:core:1.19.1")
    // Room 2.7 supports the pinned Kotlin 2.0 toolchain.
    //noinspection GradleDependency
    implementation("androidx.room:room-runtime:2.8.5")
    // Predictive back support with the Kotlin 2.0 toolchain.
    //noinspection GradleDependency
    implementation("androidx.activity:activity:1.10.1")
    // Upgrade scanner transitive Fragment to the ActivityResult-compatible API.
    //noinspection GradleDependency
    implementation("androidx.fragment:fragment:1.9.1")
    //noinspection GradleDependency
    ksp("androidx.room:room-compiler:2.8.5")
    // Pinned to the reviewed installation-registration API and Kotlin 2.0 toolchain.
    //noinspection GradleDependency
    implementation(platform("com.google.firebase:firebase-bom:34.16.0"))
    implementation("com.google.firebase:firebase-messaging")
    // Keep the Kotlin 2.0-compatible worker API.
    //noinspection GradleDependency
    implementation("androidx.work:work-runtime:2.12.0")
    androidTestImplementation(kotlin("test"))
    // Match the Kotlin 2.0-compatible Room runtime used above.
    //noinspection GradleDependency
    androidTestImplementation("androidx.room:room-testing:2.8.5")
    // Data channels only. Exact AAR/license review: docs/direct-transport.md.
    implementation("io.github.webrtc-sdk:android:150.7871.01")
    implementation(project(":protocol"))
    // Keep the established 4.x API with the pinned Kotlin 2.0 toolchain.
    //noinspection NewerVersionAvailable
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.4.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
}
