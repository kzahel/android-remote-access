plugins {
    id("com.android.application")
    kotlin("android")
    id("org.jlleitschuh.gradle.ktlint")
}
android {
    namespace = "dev.remoteaccess.app"
    compileSdk = 36
    defaultConfig {
        applicationId = "dev.remoteaccess.crypto.proof"
        minSdk = 30
        targetSdk = 36
        versionCode = 1
        versionName = "0.1-crypto-proof"
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
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
}
