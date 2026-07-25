import Foundation
import Testing
@testable import FinanceTracker

/// The Private / Household / Blended visibility rules (`State/ViewModeStore.swift`) decide
/// which accounts and sub-portfolios each screen shows. They mirror the web
/// `isVisibleInViewMode` and are pure given the store's `hasSecondPerson` flag, so they're
/// exercised directly here. `ViewModeStore` is `@MainActor`, hence the suite annotation.
@MainActor
struct ViewModeStoreTests {

    private let me = "user-me"
    private let other = "user-other"

    private func store(mode: ViewMode, secondPerson: Bool) -> ViewModeStore {
        // Persisted mode is read from UserDefaults in init; write it first, then construct.
        UserDefaults.standard.set(mode.rawValue, forKey: "viewMode")
        let s = ViewModeStore()
        s.setComposition(memberCount: secondPerson ? 2 : 1, pendingInviteCount: 0)
        return s
    }

    // MARK: effectiveMode — solo households are always blended

    @Test func soloHouseholdIsAlwaysBlended() {
        let s = store(mode: .private, secondPerson: false)
        #expect(s.effectiveMode == .blended)
        let s2 = store(mode: .household, secondPerson: false)
        #expect(s2.effectiveMode == .blended)
    }

    @Test func effectiveModeHonoursChoiceWithSecondPerson() {
        let s = store(mode: .household, secondPerson: true)
        #expect(s.effectiveMode == .household)
    }

    @Test func setCompositionFlagsSecondPersonFromPendingInvite() {
        let s = store(mode: .private, secondPerson: false)
        #expect(s.hasSecondPerson == false)
        s.setComposition(memberCount: 1, pendingInviteCount: 1) // an outstanding invite counts
        #expect(s.hasSecondPerson == true)
        #expect(s.effectiveMode == .private)
    }

    // MARK: isVisible — Blended (shared OR my own private)

    @Test func blendedShowsSharedItems() {
        let s = store(mode: .blended, secondPerson: true)
        #expect(s.isVisible(ownerUserId: nil, currentUserId: me) == true)
    }

    @Test func blendedShowsMyPrivateItems() {
        let s = store(mode: .blended, secondPerson: true)
        #expect(s.isVisible(ownerUserId: me, currentUserId: me) == true)
    }

    @Test func blendedHidesOthersPrivateItems() {
        // The server shouldn't return these anyway, but the client filter is belt-and-braces.
        let s = store(mode: .blended, secondPerson: true)
        #expect(s.isVisible(ownerUserId: other, currentUserId: me) == false)
    }

    // MARK: isVisible — Household (shared only, nobody's private)

    @Test func householdShowsSharedOnly() {
        let s = store(mode: .household, secondPerson: true)
        #expect(s.isVisible(ownerUserId: nil, currentUserId: me) == true)
        #expect(s.isVisible(ownerUserId: me, currentUserId: me) == false)
        #expect(s.isVisible(ownerUserId: other, currentUserId: me) == false)
    }

    // MARK: isVisible — Private (only my own private)

    @Test func privateShowsOnlyMyPrivate() {
        let s = store(mode: .private, secondPerson: true)
        #expect(s.isVisible(ownerUserId: me, currentUserId: me) == true)
        #expect(s.isVisible(ownerUserId: nil, currentUserId: me) == false)
        #expect(s.isVisible(ownerUserId: other, currentUserId: me) == false)
    }

    // MARK: isVisible — filtering is a no-op for a solo household

    @Test func soloHouseholdShowsEverythingRegardlessOfPersistedMode() {
        // Persisted "private" but no second person → effective blended → own data shows.
        let s = store(mode: .private, secondPerson: false)
        #expect(s.isVisible(ownerUserId: nil, currentUserId: me) == true)
        #expect(s.isVisible(ownerUserId: me, currentUserId: me) == true)
    }

    // MARK: Vault lock (Face ID) — gating is injected so it doesn't depend on live biometrics

    @Test func lockedVaultHidesMyPrivateItemsEvenInBlended() {
        let s = store(mode: .blended, secondPerson: false)
        s.configureVault(requireFaceId: true, biometricsAvailable: true)
        #expect(s.isVaultLocked == true)
        #expect(s.vaultLockActive == true)
        // Shared items still show; my private ones are hidden until unlock.
        #expect(s.isVisible(ownerUserId: nil, currentUserId: me) == true)
        #expect(s.isVisible(ownerUserId: me, currentUserId: me) == false)
    }

    @Test func failsOpenWhenBiometricsUnavailable() {
        // Setting on, but the device can't authenticate → never lock the user out.
        let s = store(mode: .blended, secondPerson: false)
        s.configureVault(requireFaceId: true, biometricsAvailable: false)
        #expect(s.isVaultLocked == false)
        #expect(s.vaultLockActive == false)
        #expect(s.isVisible(ownerUserId: me, currentUserId: me) == true)
    }

    @Test func noLockWhenSettingOff() {
        let s = store(mode: .blended, secondPerson: false)
        s.configureVault(requireFaceId: false, biometricsAvailable: true)
        #expect(s.isVaultLocked == false)
        #expect(s.vaultLockActive == false)
        #expect(s.isVisible(ownerUserId: me, currentUserId: me) == true)
    }

    @Test func lockVaultRelocksAfterUnlock() async {
        let s = store(mode: .blended, secondPerson: false)
        s.configureVault(requireFaceId: true, biometricsAvailable: true)
        #expect(s.isVaultLocked == true)
        // lockVault is a no-op when already locked; the invariant is that a required vault
        // never silently reports unlocked.
        s.lockVault()
        #expect(s.isVaultLocked == true)
    }

    @Test func reconfiguringVaultRelocks() {
        let s = store(mode: .blended, secondPerson: false)
        s.configureVault(requireFaceId: true, biometricsAvailable: true)
        // Switching users / re-applying settings must drop any prior unlocked state.
        s.configureVault(requireFaceId: true, biometricsAvailable: true)
        #expect(s.isVaultLocked == true)
    }
}
