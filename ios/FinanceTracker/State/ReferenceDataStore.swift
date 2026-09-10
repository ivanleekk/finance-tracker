import Foundation
import Observation

/// The reference sets Quick Add fills its pickers from — accounts, categories,
/// sub-portfolios, assets and counterparties — held at the app root and loaded once
/// per household instead of once per sheet.
///
/// Quick Add used to fetch all five the moment it was presented. On a cold start those
/// requests queue behind the Dashboard's batch, so on anything slower than localhost the
/// sheet opened with an empty account picker for several seconds — indistinguishable from
/// "this household has no accounts", which is what made people close it and go to the
/// Accounts tab to wake the data up (#272). Fetching them when the household resolves
/// means the sheet almost always opens with its pickers already filled, and the second
/// open is free.
///
/// Accounts and categories are published **before** the portfolio sets are awaited: an
/// expense — the default mode, and the overwhelmingly common one — needs only those two,
/// and making it wait on `/portfolio/assets` buys it nothing.
@MainActor
@Observable
final class ReferenceDataStore {
    /// What the pickers can offer right now, and whether more is still coming.
    enum Status: Equatable {
        /// No household yet, so there is nothing to load.
        case idle
        /// In flight, and `accounts`/`categories` have not landed yet.
        case loading
        /// Accounts and categories are usable; the portfolio sets may still be in flight.
        case essentials
        case ready
        case failed(String)
    }

    private(set) var accounts: [AccountResponse] = []
    private(set) var categories: [CategoryResponse] = []
    private(set) var subPortfolios: [SubPortfolioResponse] = []
    private(set) var assets: [AssetResponse] = []
    private(set) var counterparties: [Counterparty] = []
    private(set) var status: Status = .idle

    /// Accounts and categories have landed at least once for this household.
    ///
    /// Not derived from `status` alone: a *refresh* that fails (or is still in flight)
    /// leaves the previous answer sitting in `accounts`/`categories`, and that answer is
    /// still the best one available. Reading the status instead made a failed refresh
    /// hide data the store was still holding, so Quick Add reopened with the pickers back
    /// on "Select" — the very symptom this store exists to prevent.
    private(set) var hasEssentials = false

    /// The last load ended in an error (some sets may still be usable).
    var isFailed: Bool {
        if case .failed = status { return true }
        return false
    }

    /// The message from the last failure, for the sheet's retry row.
    var failureMessage: String? {
        if case .failed(let message) = status { return message }
        return nil
    }

    /// The household the data above describes. A load for a different one replaces
    /// everything rather than merging — two households' accounts must never mix.
    private var loadedHouseholdId: String?
    private var inFlight: Task<Void, Never>?

    /// Fetch the reference sets for `householdId`, unless they are already loaded (or
    /// loading) for that same household. `force` re-fetches regardless — used after a
    /// change is logged, and by the retry button.
    func load(householdId: String?, force: Bool = false) async {
        guard let householdId else {
            inFlight?.cancel()
            inFlight = nil
            clear()
            status = .idle
            loadedHouseholdId = nil
            return
        }
        // Already loaded, or already on its way — either way, don't start a second one.
        // A previous failure is the exception: there is nothing to wait for there.
        if !force, householdId == loadedHouseholdId, !isFailed {
            await inFlight?.value
            return
        }
        inFlight?.cancel()
        if householdId != loadedHouseholdId { clear() }
        loadedHouseholdId = householdId
        status = .loading

        let task = Task { [weak self] in
            _ = await self?.fetch(householdId: householdId)
        }
        inFlight = task
        await task.value
    }

    private func fetch(householdId: String) async {
        do {
            async let accountsReq: [AccountResponse] =
                APIClient.shared.get("/accounts/household/\(householdId)")
            async let categoriesReq: [CategoryResponse] =
                APIClient.shared.get("/cashflow/categories/household/\(householdId)")
            async let subsReq: [SubPortfolioResponse] =
                APIClient.shared.get("/portfolio/subportfolios/household/\(householdId)")
            async let assetsReq: [AssetResponse] = APIClient.shared.get("/portfolio/assets")
            // Optional: nobody to split with is the ordinary case, and it must not stop
            // Quick Add opening.
            async let counterpartiesReq: [Counterparty]? = try? await APIClient.shared.get(
                "/cashflow/counterparties/household/\(householdId)"
            )

            let (fetchedAccounts, fetchedCategories) = try await (accountsReq, categoriesReq)
            guard !Task.isCancelled, loadedHouseholdId == householdId else { return }
            // Published before the portfolio sets are awaited, so the account and
            // category pickers fill as soon as their own requests land.
            applyEssentials(accounts: fetchedAccounts, categories: fetchedCategories)

            (subPortfolios, assets) = try await (subsReq, assetsReq)
            counterparties = await counterpartiesReq ?? []
            guard !Task.isCancelled, loadedHouseholdId == householdId else { return }
            apply(status: .ready)
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled, loadedHouseholdId == householdId else { return }
            // A failure part-way through leaves whatever did land usable rather than
            // blanking the pickers; the status still says something went wrong.
            apply(status: .failed(error.localizedDescription))
        }
    }

    /// Publish the first stage. Kept as its own step rather than inlined so the
    /// latch and the status can't drift apart, and so both are reachable from the tests
    /// without a backend.
    func applyEssentials(accounts: [AccountResponse], categories: [CategoryResponse]) {
        self.accounts = accounts
        self.categories = categories
        hasEssentials = true
        status = .essentials
    }

    /// Move the status without touching the data already published — which is the whole
    /// point on a failed refresh.
    func apply(status: Status) {
        self.status = status
    }

    private func clear() {
        hasEssentials = false
        accounts = []
        categories = []
        subPortfolios = []
        assets = []
        counterparties = []
    }

    // MARK: - Local edits
    //
    // Quick Add can create a category, an asset or a counterparty from inside the sheet.
    // Folding the new row in beats re-fetching: the sheet needs it selected immediately,
    // and a round trip is the thing this store exists to avoid.

    func add(category: CategoryResponse) {
        guard !categories.contains(where: { $0.id == category.id }) else { return }
        categories.append(category)
    }

    func add(asset: AssetResponse) {
        guard !assets.contains(where: { $0.id == asset.id }) else { return }
        assets.append(asset)
    }

    func setCounterparties(_ updated: [Counterparty]) {
        counterparties = updated
    }
}
