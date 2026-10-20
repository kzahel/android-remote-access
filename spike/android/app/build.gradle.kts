plugins { id("com.android.application") }
android {
    namespace = "dev.remoteaccess.spike"
    compileSdk = 36
    defaultConfig {
        applicationId = "dev.remoteaccess.spike"
        minSdk = 30
        targetSdk = 36
        versionCode = 1
        versionName = "0.1-spike"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { buildConfig = true }
    lint { abortOnError = true }
}
dependencies {
    // Google's QR scanner UI, provided through Play services; needs no camera permission.
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
}
