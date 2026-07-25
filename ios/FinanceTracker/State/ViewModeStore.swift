import SwiftUI
import Observation

/// Global Private / Household / Blended switch, mirroring the web `ViewModeContext`.
///
/// The switch only matters once the active household actually has a second person — a
/// member beyond the owner, or a pending invite. Every user technically has their own
/// household, so household *count* is not the signal; a real second person has to be
/// involved. Until then everything is "blended" (show all of my own data) and the
/// switcher is hidden. Held at the app root and read from the environment.
@MainActor
@Observable
final class ViewModeStore {
    /// The user's chosen mode. Persisted; only takes effect once `hasSecondPerson`.
    var viewMode: ViewMode {
        didSet { UserDefaults.standard.set(viewMode.rawValue, forKey: Self.storageKey) }
    }

    /// True once someone besides the owner is a member of, or invited to, the active
    /// household. Controls whether the switcher renders and whether filtering applies.
    private(set) var hasSecondPerson = false

    // MARK: Private-vault lock (Face ID)

    /// The user's `require_face_id_for_vault` preference.
    private(set) var requireFaceId = false
    /// Cached at configure-time so `isVisible` (called every render) doesn't re-probe LAContext.
    private var biometricsAvailable = false
    /// Whether the vault has been unlocked this session. Only meaningful when `requireFaceId`.
    private(set) var vaultUnlocked = false

    /// The vault is locked — private items hidden regardless of view mode — only when the
    /// user requires Face ID, the device can actually authenticate, and they haven't unlocked
    /// yet. On a device with no biometrics/passcode we fail open so nobody is locked out.
    var isVaultLocked: Bool { requireFaceId && biometricsAvailable && !vaultUnlocked }

    /// True when the lock feature is active on this device (setting on + biometrics present),
    /// so UI can show a lock/unlock control whether currently locked or not.
    var vaultLockActive: Bool { requireFaceId && biometricsAvailable }

    private static let storageKey = "viewMode"

    init() {
        let saved = UserDefaults.standard.string(forKey: Self.storageKey)
            .flatMap(ViewMode.init(rawValue:))
        viewMode = saved ?? .blended
    }

    /// Solo households have no one to hide things from, so everything stays blended
    /// regardless of the persisted choice (matches web `effectiveViewMode`).
    var effectiveMode: ViewMode { hasSecondPerson ? viewMode : .blended }

    /// Update the second-person signal from already-fetched counts, so callers that
    /// just loaded members/invites (e.g. the Household screen) don't re-hit the network.
    func setComposition(memberCount: Int, pendingInviteCount: Int) {
        hasSecondPerson = memberCount > 1 || pendingInviteCount > 0
    }

    /// Re-evaluate whether the active household has a second person (members + invites).
    /// Call on launch, when the active household changes, and after invites change.
    func refresh(householdId: String?) async {
        guard let householdId else {
            hasSecondPerson = false
            return
        }
        do {
            async let membersReq: [HouseholdMemberUserResponse] =
                APIClient.shared.get("/users/householdmember/\(householdId)")
            async let invitesReq: [HouseholdInviteResponse] =
                APIClient.shared.get("/users/households/\(householdId)/invites")
            let (members, invites) = try await (membersReq, invitesReq)
            hasSecondPerson = members.count > 1 || !invites.isEmpty
        } catch {
            hasSecondPerson = false
        }
    }

    /// Given an item's owner (`nil` = shared) and the current user, should it be shown
    /// under the current effective mode? Mirrors web `isVisibleInViewMode`, plus the local
    /// vault lock: while the vault is locked, private items are hidden in every mode until
    /// the user authenticates (biometrics/passcode).
    func isVisible(ownerUserId: String?, currentUserId: String?) -> Bool {
        let isPrivate = ownerUserId != nil
        if isPrivate && isVaultLocked { return false }
        let isMine = ownerUserId == currentUserId
        switch effectiveMode {
        case .blended: return !isPrivate || isMine
        case .household: return !isPrivate
        case .private: return isPrivate && isMine
        }
    }

    /// Apply the user's Face ID preference (call on login and when the user record changes).
    /// A fresh configuration re-locks the vault so switching accounts always re-authenticates.
    func configureVault(requireFaceId: Bool) {
        configureVault(requireFaceId: requireFaceId, biometricsAvailable: requireFaceId && BiometricAuth.isAvailable)
    }

    /// Availability-injecting variant so the gating logic is testable without live biometrics.
    func configureVault(requireFaceId: Bool, biometricsAvailable: Bool) {
        self.requireFaceId = requireFaceId
        self.biometricsAvailable = biometricsAvailable
        vaultUnlocked = false
    }

    /// Prompt for biometrics/passcode; on success the vault stays unlocked for the session.
    /// Returns true when the vault ends up usable (already unlocked, not required, or success).
    func unlockVault() async -> Bool {
        guard isVaultLocked else { return true }
        let ok = await BiometricAuth.authenticate(reason: "Unlock your private financial data")
        if ok { vaultUnlocked = true }
        return ok
    }

    /// Re-lock the vault (e.g. when the app goes to the background, or a manual re-lock).
    func lockVault() {
        if requireFaceId { vaultUnlocked = false }
    }
}
