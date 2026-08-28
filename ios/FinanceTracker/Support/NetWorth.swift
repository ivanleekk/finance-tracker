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
/// The accounts worth offering when someone is *starting* something — logging a
/// transaction, funding a trade, picking a default.
///
/// Swift port of the web's `selectableAccounts` in `lib/networth.ts`.
///
/// Archived accounts are closed, so putting one in a picker invites new activity
/// on an account the user has finished with. They are deliberately still
/// included everywhere else: they keep their balances, so totals do not move
/// when an account is archived, and they still label the history attached to
/// them. A closed account has been zeroed and contributes nothing to a total
/// anyway; one that still holds money genuinely should be counted.
func selectableAccounts(_ accounts: [AccountResponse]) -> [AccountResponse] {
    accounts.filter { $0.isArchived != true }
}

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
    /// Money other people owe the household. An asset, but not a spendable one.
    var receivables: Double = 0

    var net: Double { totalAssets - liabilities }
}

/// Outstanding debts either way, from the ledger's counterparty balances.
///
/// These sit in no `FinancialAccount`, which is the whole reason they need
/// passing in: without them a split bill takes the full amount out of the bank
/// and puts nothing back, so net worth reports money you are still owed as money
/// that simply evaporated.
struct OwedTotals {
    var owedToYou: Double = 0
    var youOwe: Double = 0

    static let none = OwedTotals()
}

func summarizeAccounts(
    _ accounts: [NetWorthAccountInput],
    owed: OwedTotals = .none
) -> AccountTotals {
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

    // A receivable is a real asset — someone owing you $80 is $80 you have a
    // claim on — but it is deliberately kept out of `liquidNow`, for the same
    // reason property is: you cannot spend it this week, and treating it as
    // spendable is how a runway starts lying. A payable is a real debt.
    totals.receivables = owed.owedToYou.isFinite ? owed.owedToYou : 0
    totals.totalAssets += totals.receivables
    totals.liabilities += owed.youOwe.isFinite ? owed.youOwe : 0

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
func netWorthBreakdown(
    accounts: [NetWorthAccountInput],
    portfolioValue: Double,
    owed: OwedTotals = .none
) -> NetWorthBreakdown {
    let totals = summarizeAccounts(accounts, owed: owed)
    // Anything not liquid/retirement/property/owed (e.g. market_liquid accounts).
    // Receivables are subtracted out and given their own slice rather than left
    // to fall into "Other Assets", where a debt someone owes you would be
    // indistinguishable from an account you forgot to classify.
    let other = totals.totalAssets - totals.liquidNow - totals.retirement
        - totals.property - totals.receivables

    let slices = [
        NetWorthSlice(key: "cash", label: "Cash", value: totals.liquidNow),
        NetWorthSlice(key: "investments", label: "Investments", value: portfolioValue),
        NetWorthSlice(key: "retirement", label: "Retirement & Locked", value: totals.retirement),
        NetWorthSlice(key: "property", label: "Property", value: totals.property),
        NetWorthSlice(key: "owed", label: "Owed to You", value: totals.receivables),
        NetWorthSlice(key: "other", label: "Other Assets", value: other),
    ].filter { $0.value > 0.01 }

    return NetWorthBreakdown(
        slices: slices,
        liabilities: totals.liabilities,
        sliceTotal: slices.reduce(0) { $0 + $1.value }
    )
}
