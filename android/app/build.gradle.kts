import java.net.URI

plugins {
    id("com.android.application")
    kotlin("android")
    id("com.google.devtools.ksp")
    id("org.jlleitschuh.gradle.ktlint")
    id("com.google.gms.google-services")
}
val sharingWebsite = providers.gradleProperty("sharingWebsite").orElse("https://android-remote.graehlarts.com").get()
val sharingUri = URI(sharingWebsite)
require(
    sharingUri.scheme == "https" && sharingUri.host != null && sharingUri.rawUserInfo == null &&
        sharingUri.rawQuery == null && sharingUri.rawFragment == null && sharingUri.rawPath.isNullOrEmpty(),
)

android {
    namespace = "dev.remoteaccess.app"
    compileSdk = 36
    buildFeatures { buildConfig = true }
    defaultConfig {
        applicationId = "dev.remoteaccess.host"
        minSdk = 30
        targetSdk = 36
        versionCode = 2
        versionName = "0.5.0"
        buildConfigField("String", "SHARING_WEBSITE", "\"$sharingWebsite\"")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
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
    // Reviewed Apache-2.0 QR encoder; generates public website links only.
    //noinspection NewerVersionAvailable
    implementation("com.google.zxing:core:3.5.3")
    // Unused-app restrictions and their system settings entry point.
    //noinspection GradleDependency
    implementation("androidx.core:core:1.16.0")
    // Room 2.7 supports the pinned Kotlin 2.0 toolchain.
    //noinspection GradleDependency
    implementation("androidx.room:room-runtime:2.7.2")
    // Predictive back support with the Kotlin 2.0 toolchain.
    //noinspection GradleDependency
    implementation("androidx.activity:activity:1.10.1")
    // Upgrade scanner transitive Fragment to the ActivityResult-compatible API.
    //noinspection GradleDependency
    implementation("androidx.fragment:fragment:1.8.6")
    //noinspection GradleDependency
    ksp("androidx.room:room-compiler:2.7.2")
    // Pinned to the reviewed installation-registration API and Kotlin 2.0 toolchain.
    //noinspection GradleDependency
    implementation(platform("com.google.firebase:firebase-bom:34.16.0"))
    implementation("com.google.firebase:firebase-messaging")
    // Keep the Kotlin 2.0-compatible worker API.
    //noinspection GradleDependency
    implementation("androidx.work:work-runtime:2.10.1")
    androidTestImplementation(kotlin("test"))
    // Match the Kotlin 2.0-compatible Room runtime used above.
    //noinspection GradleDependency
    androidTestImplementation("androidx.room:room-testing:2.7.2")
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
