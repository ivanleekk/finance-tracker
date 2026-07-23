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
    /// under the current effective mode? Mirrors web `isVisibleInViewMode`.
    func isVisible(ownerUserId: String?, currentUserId: String?) -> Bool {
        let isPrivate = ownerUserId != nil
        let isMine = ownerUserId == currentUserId
        switch effectiveMode {
        case .blended: return !isPrivate || isMine
        case .household: return !isPrivate
        case .private: return isPrivate && isMine
        }
    }
}
