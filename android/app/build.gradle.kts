import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Local-only signing material (gitignored, see android/.gitignore). Absent on a machine
// that hasn't generated a keystore yet, in which case release builds stay unsigned rather
// than failing configuration.
val keystoreProperties = Properties().apply {
    val file = rootProject.file("keystore.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

android {
    namespace = "com.ivanlee.financetracker"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.ivanlee.financetracker"
        // 26 is the floor: java.time (used everywhere for backend date handling) and
        // EncryptedSharedPreferences both need it, and it avoids core library desugaring.
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables { useSupportLibrary = true }
    }

    signingConfigs {
        if (keystoreProperties.isNotEmpty()) {
            create("release") {
                storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        debug {
            // 10.0.2.2 is the emulator's alias for the host machine's loopback, so a
            // `docker compose up` backend on the Mac is reachable without any config.
            // A physical device on the LAN uses the in-app override (Settings ▸ API server).
            buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:8000\"")
            isDebuggable = true
        }
        release {
            buildConfigField("String", "API_BASE_URL", "\"https://financeapi.ivanleekaikiat.com\"")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            if (keystoreProperties.isNotEmpty()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
        // Opted in project-wide rather than per-file: these APIs are used by essentially
        // every screen (M3 top bars/sheets, the navigation suite, the snake_case JSON
        // naming strategy), so per-call-site annotations would be pure noise.
        freeCompilerArgs += listOf(
            "-opt-in=kotlin.RequiresOptIn",
            "-opt-in=kotlinx.serialization.ExperimentalSerializationApi",
            "-opt-in=androidx.compose.material3.ExperimentalMaterial3Api",
            "-opt-in=androidx.compose.foundation.ExperimentalFoundationApi",
            "-opt-in=androidx.compose.animation.ExperimentalAnimationApi",
            "-opt-in=androidx.compose.material3.adaptive.navigationsuite.ExperimentalMaterial3AdaptiveNavigationSuiteApi",
        )
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging {
        resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    }
}

// Pins the JDK the compilers *run on*, which is a different thing from the `jvmTarget`
// above (what they compile *for*). Kotlin 2.0.21 bundles an IntelliJ `JavaVersion.parse`
// that cannot read a four-part version string, so a host JDK like 26.0.2.1 fails the build
// with a bare "26.0.2.1" and no other explanation; AGP 8.7 does not support a JDK that new
// either. Pinning here means the build no longer depends on whatever `java` happens to be
// first on the developer's PATH.
kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material3.window.size)
    implementation(libs.androidx.compose.material3.adaptive.nav.suite)
    implementation(libs.androidx.compose.material.icons.extended)

    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.security.crypto)
    implementation(libs.androidx.biometric)

    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)

    debugImplementation(libs.androidx.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}
