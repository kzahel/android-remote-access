plugins {
    kotlin("jvm")
    id("org.jlleitschuh.gradle.ktlint")
}
kotlin {
    jvmToolchain(17)
    compilerOptions { allWarningsAsErrors.set(true) }
}
dependencies {
    testImplementation(kotlin("test-junit"))
    testImplementation("org.json:json:20250107")
}
tasks.test { systemProperty("vectors", rootProject.file("../protocol/vectors/session-v1.json").absolutePath) }
