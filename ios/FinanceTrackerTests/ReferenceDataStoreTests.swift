import Foundation
import Testing
@testable import FinanceTracker

/// `ReferenceDataStore` (`State/ReferenceDataStore.swift`) is what stops Quick Add opening
/// with an empty account picker on a cold start (#272). Its fetching half needs a backend
/// and isn't exercised here; what is exercised is the part that decides whether the
/// pickers have something to show and how a locally-created row folds in — the two places
/// the empty-picker bug can come back.
@MainActor
struct ReferenceDataStoreTests {

    private func category(_ id: String, name: String = "Dining") -> CategoryResponse {
        CategoryResponse(id: id, householdId: "hh", name: name, type: .expense, isSystem: false)
    }

    private func asset(_ id: String, ticker: String = "VOO") -> AssetResponse {
        AssetResponse(id: id, ticker: ticker, name: ticker, type: "stock", currency: "USD", pricingMode: nil)
    }

    // MARK: hasEssentials

    @Test func startsWithNothingToShow() {
        let store = ReferenceDataStore()
        #expect(store.status == .idle)
        #expect(!store.hasEssentials)
        #expect(!store.isFailed)
        #expect(store.failureMessage == nil)
    }

    /// No household means nothing to load — and that is `.idle`, not a failure, so the
    /// sheet shows neither a spinner nor an error.
    @Test func noHouseholdClearsToIdle() async {
        let store = ReferenceDataStore()
        await store.load(householdId: nil)
        #expect(store.status == .idle)
        #expect(store.accounts.isEmpty)
        #expect(!store.hasEssentials)
    }

    // MARK: failure reporting

    @Test func failureExposesItsMessage() {
        let store = ReferenceDataStore()
        store.apply(status: .failed("Could not connect to the server."))
        #expect(store.isFailed)
        #expect(store.failureMessage == "Could not connect to the server.")
    }

    /// The regression this store was written to prevent, in miniature: a *refresh* that
    /// fails must not take the previously-loaded pickers down with it. `hasEssentials`
    /// therefore records that accounts and categories have arrived, rather than being read
    /// back off the current status.
    @Test func failedRefreshKeepsWhatAlreadyLanded() {
        let store = ReferenceDataStore()
        store.applyEssentials(accounts: [], categories: [category("c1")])
        #expect(store.hasEssentials)
        store.apply(status: .failed("offline"))
        #expect(store.hasEssentials)
        #expect(store.categories.count == 1)
    }

    // MARK: local edits

    @Test func addsCategoryCreatedInTheSheet() {
        let store = ReferenceDataStore()
        store.add(category: category("c1"))
        #expect(store.categories.map(\.id) == ["c1"])
    }

    /// Quick Add folds a newly-created row in *and* the next refresh returns it from the
    /// server, so adding the same id twice must not double it up in the picker.
    @Test func doesNotDuplicateAnExistingRow() {
        let store = ReferenceDataStore()
        store.add(category: category("c1"))
        store.add(category: category("c1", name: "Dining (renamed)"))
        #expect(store.categories.count == 1)

        store.add(asset: asset("a1"))
        store.add(asset: asset("a1"))
        #expect(store.assets.count == 1)
    }
}
