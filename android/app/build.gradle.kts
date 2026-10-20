plugins {
    id("com.android.application")
    kotlin("android")
    id("org.jlleitschuh.gradle.ktlint")
}
android {
    namespace = "dev.remoteaccess.app"
    compileSdk = 36
    defaultConfig {
        applicationId = "dev.remoteaccess.host"
        minSdk = 30
        targetSdk = 36
        versionCode = 1
        versionName = "0.2-pairing-relay"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    sourceSets["androidTest"].assets.srcDir("../../protocol/vectors")
    lint {
        abortOnError = true
        warningsAsErrors = true
    }
}
kotlin { compilerOptions { allWarningsAsErrors.set(true) } }
dependencies {
    androidTestImplementation(kotlin("test"))
    implementation(project(":protocol"))
    // Keep the established 4.x API with the pinned Kotlin 2.0 toolchain.
    //noinspection NewerVersionAvailable
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.4.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
}
