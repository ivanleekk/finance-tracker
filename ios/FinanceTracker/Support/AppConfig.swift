import Foundation

/// Build-configuration-derived app settings.
///
/// The API endpoint is baked in per configuration through the `API_BASE_URL` build
/// setting (surfaced via Info.plist → `$(API_BASE_URL)`). Debug (developer) builds
/// additionally expose a runtime override in the UI and honour it; Release builds do
/// not — the override UI is compiled out and `APIClient` ignores any stored value.
enum AppConfig {
    /// True only in Debug builds. Gates developer-only affordances like the API-server
    /// override so they never ship in a Release (production) build.
    static var isDebugBuild: Bool {
        #if DEBUG
        true
        #else
        false
        #endif
    }

    /// True for the Staging configuration (the "FinanceTracker Staging" scheme), which points
    /// at the staging stack instead of production. Read from the `APP_ENVIRONMENT` build
    /// setting via Info.plist, so it is a fact about the build, not a user preference.
    static var isStaging: Bool {
        Bundle.main.object(forInfoDictionaryKey: "APP_ENVIRONMENT") as? String == "staging"
    }

    /// Backend base URL baked into this build. Falls back to localhost if the build
    /// setting is empty or was left unresolved (e.g. `$(API_BASE_URL)` not substituted).
    static var defaultBaseURL: URL {
        if let raw = Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String,
           !raw.isEmpty, !raw.contains("$("),
           let url = URL(string: raw) {
            return url
        }
        return URL(string: "http://localhost:8000")!
    }
}
