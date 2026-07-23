import Foundation
import Observation
import SwiftUI

/// App-wide session: auth state, current user, households, active household.
/// Mirrors mobile's AuthContext + HouseholdContext.
@MainActor
@Observable
final class SessionStore {
    enum Phase {
        case loading
        case unauthenticated
        case authenticated
    }

    var phase: Phase = .loading
    var user: UserResponse?
    var households: [HouseholdResponse] = []
    var activeHousehold: HouseholdResponse? {
        didSet {
            UserDefaults.standard.set(activeHousehold?.id, forKey: Self.activeHouseholdKey)
        }
    }

    /// Resolved palettes for the logged-in user's saved choices.
    var theme: AppTheme { .from(user) }

    /// User's theme_mode preference; nil (= "system") follows the device.
    var preferredColorScheme: ColorScheme? {
        switch user?.themeMode {
        case "light": return .light
        case "dark": return .dark
        default: return nil
        }
    }

    /// Persist appearance choices via PUT /users; nil fields are left unchanged.
    func updateAppearance(
        themeMode: String? = nil,
        primaryColor: String? = nil,
        secondaryColor: String? = nil,
        baseColor: String? = nil
    ) async throws {
        user = try await APIClient.shared.put("/users", body: UserAppearanceUpdate(
            themeMode: themeMode,
            primaryColor: primaryColor,
            secondaryColor: secondaryColor,
            baseColor: baseColor
        ))
    }

    private static let activeHouseholdKey = "activeHouseholdId"
    private var sessionExpiryObserver: (any NSObjectProtocol)?

    init() {
        sessionExpiryObserver = NotificationCenter.default.addObserver(
            forName: .sessionExpired, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.forceLogout() }
        }
    }

    func bootstrap() async {
        guard Keychain.get(Keychain.accessTokenKey) != nil else {
            phase = .unauthenticated
            return
        }
        do {
            try await loadSession()
            phase = .authenticated
        } catch {
            phase = .unauthenticated
        }
    }

    func login(email: String, password: String) async throws {
        try await APIClient.shared.login(email: email, password: password)
        try await loadSession()
        phase = .authenticated
    }

    func signup(email: String, password: String, name: String) async throws {
        struct UserCreate: Encodable {
            let email: String
            let password: String
            let name: String
        }
        let _: UserResponse = try await APIClient.shared.post(
            "/users", body: UserCreate(email: email, password: password, name: name)
        )
        try await login(email: email, password: password)
    }

    func logout() {
        Keychain.clearTokens()
        forceLogout()
    }

    private func forceLogout() {
        user = nil
        households = []
        activeHousehold = nil
        phase = .unauthenticated
    }

    private func loadSession() async throws {
        user = try await APIClient.shared.get("/users")
        households = try await APIClient.shared.get("/users/households")
        let savedId = UserDefaults.standard.string(forKey: Self.activeHouseholdKey)
        activeHousehold = households.first { $0.id == savedId } ?? households.first
    }
}
