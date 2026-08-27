import SwiftUI

// What the Dashboard shows, derived from what it loaded: the visibility key the
// view re-derives on, and the rollups themselves. Pure computation, split out of
// DashboardView.swift so the view reads as a view.

/// The view-mode inputs a derivation depends on. Its `Equatable` conformance is what lets
/// `.onChange` re-derive on a mode flip or a vault unlock without a refetch.
struct DashboardVisibilityKey: Equatable {
    let mode: ViewMode
    let vaultLocked: Bool
    let userId: String?
}

/// The Dashboard's aggregates, derived from one load in a single pass.
///
/// A plain value type rather than a pile of computed properties on the view: SwiftUI
/// re-evaluates `body` far more often than the data changes (once per frame while the chart
/// is being scrubbed), and every one of those evaluations used to re-walk the household's
/// whole balance and snapshot history.
struct DashboardDerived {
    var accounts: [AccountResponse] = []
    var latestBalanceByAccount: [String: BalanceResponse] = [:]
    var currentCash: Double = 0
    var latestHoldings: [PortfolioSnapshotResponse] = []
    var topHoldings: [PortfolioSnapshotResponse] = []
    var currentPortfolioValue: Double = 0
    var hasVisibleSnapshots = false
    var breakdown = NetWorthBreakdown(slices: [], liabilities: 0, sliceTotal: 0)
    var bands: [NetWorthBandPoint] = []
    var recentTransactions: [TransactionResponse] = []
    /// Outstanding debts either way, netted for the headline.
    var owedTotals = OwedTotals.none

    /// Net worth = liquid accounts (net of liabilities) + investments + what people owe
    /// you, less what you owe them. Debts either way belong here: a receivable is a claim
    /// you hold, a payable is one held against you. Kept in step with the split donut,
    /// which draws its own "Owed to You" slice from the same figures — a headline that
    /// ignored them while the chart showed them would be worse than neither.
    var netWorth: Double { currentCash + currentPortfolioValue + owedTotals.owedToYou - owedTotals.youOwe }

    init() {}

    init(
        accounts allAccounts: [AccountResponse],
        balances allBalances: [BalanceResponse],
        transactions allTransactions: [TransactionResponse],
        snapshots allSnapshots: [PortfolioSnapshotResponse],
        timeseries allTimeseries: [PortfolioTimeseriesPoint],
        subPortfolios: [SubPortfolioResponse],
        owed: [CounterpartyBalanceResponse] = [],
        isVisible: (String?) -> Bool
    ) {
        let owedTotalsRaw = Reimbursements.totals(owed)
        owedTotals = OwedTotals(owedToYou: owedTotalsRaw.owedToYou, youOwe: owedTotalsRaw.youOwe)
        accounts = allAccounts.filter { isVisible($0.ownerUserId) }
        let visibleAccountIds = Set(accounts.map(\.id))
        let visibleSubPortfolioIds = Set(
            subPortfolios.filter { isVisible($0.ownerUserId) }.map(\.id)
        )
        // Liability accounts (loans, mortgages) hold their outstanding balance as a
        // positive number; they count *against* net worth (mirrors web Dashboard).
        let liabilityIds = Set(allAccounts.filter { $0.kind == "liability" }.map(\.id))
        let visibleBalances = allBalances.filter { visibleAccountIds.contains($0.accountId) }
        let visibleSnapshots = allSnapshots.filter { visibleSubPortfolioIds.contains($0.subPortfolioId) }
        let visibleTimeseries = allTimeseries.filter { visibleSubPortfolioIds.contains($0.subPortfolioId) }
        hasVisibleSnapshots = !visibleSnapshots.isEmpty

        // One pass over the whole balance history instead of re-filtering it per
        // account row (`.filter { ... }.max { ... }` was O(accounts × balances)).
        for balance in visibleBalances {
            if let existing = latestBalanceByAccount[balance.accountId], existing.date >= balance.date { continue }
            latestBalanceByAccount[balance.accountId] = balance
        }
        currentCash = latestBalanceByAccount.reduce(0.0) { sum, entry in
            let value = entry.value.homeValue
            return sum + (liabilityIds.contains(entry.key) ? -value : value)
        }

        // Holdings on the most recent snapshot date only (mirrors PortfolioView).
        if let latest = visibleSnapshots.map(\.date).max() {
            latestHoldings = visibleSnapshots.filter { $0.date == latest && $0.quantity > 0 }
        }
        currentPortfolioValue = latestHoldings.reduce(0) { $0 + $1.currentValueHomeCurrency }
        topHoldings = Array(
            latestHoldings
                .sorted { $0.currentValueHomeCurrency > $1.currentValueHomeCurrency }
                .prefix(4)
        )

        let historyByAccount = Dictionary(grouping: visibleBalances, by: \.accountId)
        breakdown = netWorthBreakdown(
            accounts: accounts.map {
                NetWorthAccountInput(kind: $0.kind, liquidity: $0.liquidity, history: historyByAccount[$0.id] ?? [])
            },
            portfolioValue: currentPortfolioValue,
            owed: owedTotals
        )

        bands = netWorthBands(
            balancesByAccount: historyByAccount.mapValues { $0.sorted { $0.date < $1.date } },
            liabilityIds: liabilityIds,
            timeseries: visibleTimeseries
        )

        recentTransactions = Array(
            allTransactions
                .filter { visibleAccountIds.contains($0.accountId) }
                .sorted { $0.date > $1.date }
                .prefix(5)
        )
    }
}

/// One stacked-area band per date: cash forward-filled from account balances, investments
/// forward-filled from the portfolio timeseries, so the two sum to net worth on every date.
///
/// The series is **binned by span** the same way the Portfolio tab's growth chart is
/// (`growthBin(forSpanDays:)`): a household tracking daily for five years produces ~1,800
/// dates, and plotting all of them meant Swift Charts laying out thousands of marks on every
/// redraw for a plot 350 points wide — far more detail than a phone-width chart can show,
/// paid for on every frame of a scrub. Binning keeps the **last** value in each bucket,
/// matching `equityCurve`, because these are running balances rather than flows.
private func netWorthBands(
    balancesByAccount: [String: [BalanceResponse]],
    liabilityIds: Set<String>,
    timeseries: [PortfolioTimeseriesPoint]
) -> [NetWorthBandPoint] {
    let cal = bandCalendar
    let dates = Set(
        balancesByAccount.values.flatMap { $0 }.map { cal.startOfDay(for: $0.date) } +
        timeseries.map { cal.startOfDay(for: $0.date) }
    ).sorted()
    guard let first = dates.first, let last = dates.last else { return [] }

    let portfolioByDate = Dictionary(
        grouping: timeseries, by: { cal.startOfDay(for: $0.date) }
    ).mapValues { $0.reduce(0.0) { $0 + $1.value } }
    let snapshotDates = portfolioByDate.keys.sorted()

    // Bucket first, forward-fill second: the fill is O(dates × accounts), so thinning the
    // dates up front is what actually removes the work, not just the marks.
    let sampled = sampleDates(dates, from: first, to: last, calendar: cal)

    // Both series are read with a moving cursor rather than a `last { $0 <= date }` scan
    // per account per date, which was the other half of the cost.
    var cursors: [String: Int] = [:]
    var snapshotCursor = 0
    var lastPortfolio = 0.0

    return sampled.map { date in
        let cutoff = date.addingTimeInterval(86_399)
        var cash = 0.0
        for (accountId, history) in balancesByAccount {
            var index = cursors[accountId] ?? 0
            while index < history.count, history[index].date <= cutoff { index += 1 }
            cursors[accountId] = index
            guard index > 0 else { continue }
            let value = history[index - 1].homeValue
            cash += liabilityIds.contains(accountId) ? -value : value
        }
        while snapshotCursor < snapshotDates.count, snapshotDates[snapshotCursor] <= date {
            lastPortfolio = portfolioByDate[snapshotDates[snapshotCursor]] ?? 0
            snapshotCursor += 1
        }
        return NetWorthBandPoint(date: date, cash: cash, investments: lastPortfolio)
    }
}

/// The dates actually plotted: every one for a short history, one per week or per month for
/// a longer one. The final date is always kept — the newest reading is the one the "you are
/// here" marker points at and the one the headline figure has to agree with.
private func sampleDates(_ dates: [Date], from first: Date, to last: Date, calendar: Calendar) -> [Date] {
    let component: Calendar.Component
    switch growthBin(forSpanDays: last.timeIntervalSince(first) / 86_400) {
    case .daily: return dates
    case .weekly: component = .weekOfYear
    case .monthly: component = .month
    }
    var seenBuckets = Set<Date>()
    var sampled: [Date] = []
    // Walked newest-first so the value kept in each bucket is its *last* one, matching
    // `equityCurve`'s binning rule; reversed back to ascending at the end.
    for date in dates.reversed() {
        guard let bucket = calendar.dateInterval(of: component, for: date)?.start else { continue }
        if seenBuckets.insert(bucket).inserted { sampled.append(date) }
    }
    return sampled.reversed()
}

/// UTC, so a band can't slide into a neighbouring day depending on the device's timezone —
/// the same reason `PortfolioAnalytics` bins in UTC. Monday-first to match its weekly buckets.
private let bandCalendar: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    calendar.firstWeekday = 2
    return calendar
}()
