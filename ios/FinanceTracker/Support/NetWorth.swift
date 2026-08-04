import Foundation

// Net worth aggregation across accounts of every kind — Swift port of
// `frontend/src/lib/networth.ts`. Property (an illiquid asset) belongs in net
// worth but not in "liquid now": getting that wrong made a mortgaged household
// look permanently bankrupt (house missing) or absurdly cash-rich (house
// counted as spendable).

/// Latest home-currency balance from a history, or 0 for an empty history.
func latestBalanceHome(_ history: [BalanceResponse]) -> Double {
    history.max(by: { $0.date < $1.date })?.homeValue ?? 0
}

/// The minimal account shape `summarizeAccounts`/`netWorthBreakdown` need —
/// kind + liquidity bucket + full balance history, mirroring web's `AccountLike`.
struct NetWorthAccountInput {
    let kind: String?
    let liquidity: LiquidityStatus
    let history: [BalanceResponse]
}

struct AccountTotals {
    var totalAssets: Double = 0
    var liabilities: Double = 0
    var liquidNow: Double = 0
    var retirement: Double = 0
    var property: Double = 0

    var net: Double { totalAssets - liabilities }
}

func summarizeAccounts(_ accounts: [NetWorthAccountInput]) -> AccountTotals {
    var totals = AccountTotals()
    for account in accounts {
        let balance = latestBalanceHome(account.history)

        // Liabilities store their outstanding balance as a positive number and
        // are subtracted, never added.
        if account.kind == "liability" {
            totals.liabilities += balance
            continue
        }

        totals.totalAssets += balance
        switch account.liquidity {
        case .liquid: totals.liquidNow += balance
        case .timeLocked, .retirement: totals.retirement += balance
        case .illiquid: totals.property += balance
        case .marketLiquid: break
        }
    }
    return totals
}

/// One wedge of the Net Worth Split donut: a bucket name and its home-currency value.
struct NetWorthSlice: Identifiable {
    let key: String
    let label: String
    let value: Double
    var id: String { key }
}

struct NetWorthBreakdown {
    let slices: [NetWorthSlice]
    let liabilities: Double
    /// Sum of the visible (positive) slices — the right denominator for each
    /// slice's share. Not the same as gross assets when a bucket (e.g. cash,
    /// for an overdrawn household) is negative and therefore excluded below.
    let sliceTotal: Double
}

/// Composition of net worth for the Dashboard split chart: cash-like accounts
/// bucketed by liquidity, plus portfolio holdings (tracked separately from
/// `AccountResponse`, so there's no overlap with `accounts`). Liabilities are
/// returned alongside rather than as a slice — a donut can't render a negative
/// wedge, and net worth is "these assets, minus that debt," not one blended
/// bucket. A negative bucket (e.g. overdrawn cash) is dropped the same way —
/// it still reduces net worth, just not through a wedge.
func netWorthBreakdown(accounts: [NetWorthAccountInput], portfolioValue: Double) -> NetWorthBreakdown {
    let totals = summarizeAccounts(accounts)
    // Anything not liquid/retirement/property (e.g. market_liquid accounts).
    let other = totals.totalAssets - totals.liquidNow - totals.retirement - totals.property

    let slices = [
        NetWorthSlice(key: "cash", label: "Cash", value: totals.liquidNow),
        NetWorthSlice(key: "investments", label: "Investments", value: portfolioValue),
        NetWorthSlice(key: "retirement", label: "Retirement & Locked", value: totals.retirement),
        NetWorthSlice(key: "property", label: "Property", value: totals.property),
        NetWorthSlice(key: "other", label: "Other Assets", value: other),
    ].filter { $0.value > 0.01 }

    return NetWorthBreakdown(
        slices: slices,
        liabilities: totals.liabilities,
        sliceTotal: slices.reduce(0) { $0 + $1.value }
    )
}
