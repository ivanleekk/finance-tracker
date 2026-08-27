pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    // Resolves the Java 17 toolchain the build pins (see gradle.properties). Without a
    // resolver, `jvmToolchain(17)` only works on a machine that already has a 17 installed,
    // which is exactly the situation this pin exists to stop mattering.
    id("org.gradle.toolchains.foojay-resolver-convention") version "0.9.0"
}


dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "Waypoint"
include(":app")
