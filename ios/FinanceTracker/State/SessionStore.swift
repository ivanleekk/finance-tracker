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

    /// True while the guided first-run flow owns the screen. Set when a brand-new user
    /// signs up (backend `POST /users` doesn't create a household, so they'd otherwise land
    /// with nothing) and cleared when onboarding finishes. Keeps `OnboardingView` mounted
    /// even after step 1 creates the household — without this, `RootView` would swap in
    /// `MainTabView` the moment `households` becomes non-empty, mid-flow. See `needsOnboarding`.
    var isOnboarding = false

    /// Show the guided setup when there's no household to work in, or while the flow is
    /// explicitly active. Mirrors the web redirect to `/onboarding` for household-less users.
    var needsOnboarding: Bool { isOnboarding || households.isEmpty }
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

    /// Partial PUT /users; nil fields are omitted and left unchanged server-side.
    func updateUser(_ update: UserUpdate) async throws {
        user = try await APIClient.shared.put("/users", body: update)
    }

    /// Persist appearance choices via PUT /users; nil fields are left unchanged.
    func updateAppearance(
        themeMode: String? = nil,
        primaryColor: String? = nil,
        secondaryColor: String? = nil,
        baseColor: String? = nil
    ) async throws {
        try await updateUser(UserUpdate(
            themeMode: themeMode,
            primaryColor: primaryColor,
            secondaryColor: secondaryColor,
            baseColor: baseColor
        ))
    }

    /// Rename the active household / change its base reporting currency.
    func updateHousehold(id: String, name: String?, baseCurrency: String?) async throws {
        let updated: HouseholdResponse = try await APIClient.shared.put(
            "/users/households/\(id)",
            body: HouseholdUpdate(name: name, baseCurrency: baseCurrency)
        )
        if let index = households.firstIndex(where: { $0.id == id }) {
            households[index] = updated
        }
        if activeHousehold?.id == id {
            activeHousehold = updated
        }
    }

    /// Create a household, refresh the list, and switch to it as the active one.
    func createHousehold(name: String, baseCurrency: String, countryCode: String) async throws {
        let created: HouseholdResponse = try await APIClient.shared.post(
            "/users/households",
            body: HouseholdCreate(name: name, baseCurrency: baseCurrency, countryCode: countryCode)
        )
        households = try await APIClient.shared.get("/users/households")
        activeHousehold = households.first { $0.id == created.id } ?? created
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
        // A fresh signup has no household yet — hand off to the guided setup flow.
        if households.isEmpty { isOnboarding = true }
    }

    // MARK: - Onboarding (guided first-run; mirrors web /onboarding)

    /// Create a preset account and, when a starting balance is given, seed it. Used by the
    /// onboarding "Cash / Investment account" presets. `ownerUserId` follows the user's
    /// private-by-default choice. Errors are surfaced to the caller (the account may exist
    /// even if the balance post fails — same best-effort behaviour as web).
    func createPresetAccount(
        householdId: String,
        name: String,
        liquidity: LiquidityStatus,
        currency: String,
        ownerUserId: String?,
        startingBalance: Double
    ) async throws {
        let account: AccountResponse = try await APIClient.shared.post(
            "/accounts",
            body: AccountCreate(
                householdId: householdId, name: name, liquidity: liquidity,
                taxStatus: .taxable, kind: .asset, currency: currency, ownerUserId: ownerUserId
            )
        )
        let _: BalanceResponse = try await APIClient.shared.post(
            "/accounts/balances",
            body: BalanceCreate(
                accountId: account.id, date: Date().apiDateOnly,
                balance: startingBalance, isManual: true
            )
        )
    }

    /// Send a household invite (onboarding step 2 "invite a partner"). Editor role, matching web.
    func sendInvite(householdId: String, email: String) async throws {
        let _: HouseholdInviteResponse = try await APIClient.shared.post(
            "/users/households/\(householdId)/invites",
            body: HouseholdInviteCreate(email: email, role: .editor)
        )
    }

    /// Leave the guided flow and land in the app proper.
    func finishOnboarding() { isOnboarding = false }

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
