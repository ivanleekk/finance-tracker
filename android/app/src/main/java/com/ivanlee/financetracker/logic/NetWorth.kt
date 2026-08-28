package com.ivanlee.financetracker.logic

import com.ivanlee.financetracker.data.model.AccountResponse
import com.ivanlee.financetracker.data.model.BalanceResponse
import com.ivanlee.financetracker.data.model.LiquidityStatus

// Net worth aggregation across accounts of every kind. Kotlin port of
// frontend/src/lib/networth.ts (and ios/FinanceTracker/Support/NetWorth.swift) — keep the
// three in sync. Property (an illiquid asset) belongs in net worth but not in "liquid now":
// getting that wrong made a mortgaged household look permanently bankrupt (house missing) or
// absurdly cash-rich (house counted as spendable).

/** Latest home-currency balance from a history, or 0 for an empty history. */
/**
 * The accounts worth offering when someone is *starting* something — logging a
 * transaction, funding a trade, picking a default.
 *
 * Kotlin port of the web's `selectableAccounts` in `lib/networth.ts` and iOS's in
 * `Support/NetWorth.swift`.
 *
 * Archived accounts are closed, so putting one in a picker invites new activity
 * on an account the user has finished with. They are deliberately still included
 * everywhere else: they keep their balances, so totals do not move when an
 * account is archived, and they still label the history attached to them. A
 * closed account has been zeroed and contributes nothing to a total anyway; one
 * that still holds money genuinely should be counted.
 */
fun selectableAccounts(accounts: List<AccountResponse>): List<AccountResponse> =
    accounts.filter { it.isArchived != true }

fun latestBalanceHome(history: List<BalanceResponse>): Double =
    history.maxByOrNull { it.date }?.homeValue ?: 0.0

/**
 * The minimal account shape [summarizeAccounts]/[netWorthBreakdown] need — kind + liquidity
 * bucket + full balance history, mirroring web's `AccountLike`.
 */
data class NetWorthAccountInput(
    val kind: String?,
    val liquidity: LiquidityStatus,
    val history: List<BalanceResponse>,
)

data class AccountTotals(
    val totalAssets: Double = 0.0,
    val liabilities: Double = 0.0,
    val liquidNow: Double = 0.0,
    val retirement: Double = 0.0,
    val property: Double = 0.0,
    /** Money other people owe the household. An asset, but not a spendable one. */
    val receivables: Double = 0.0,
) {
    val net: Double get() = totalAssets - liabilities
}

/**
 * Outstanding debts either way, from the ledger's counterparty balances.
 *
 * These sit in no `FinancialAccount`, which is the whole reason they need passing in: without
 * them a split bill takes the full amount out of the bank and puts nothing back, so net worth
 * reports money you are still owed as money that simply evaporated.
 */
data class OwedTotals(val owedToYou: Double = 0.0, val youOwe: Double = 0.0) {
    companion object {
        val NONE = OwedTotals()
    }
}

fun summarizeAccounts(
    accounts: List<NetWorthAccountInput>,
    owed: OwedTotals = OwedTotals.NONE,
): AccountTotals {
    var totalAssets = 0.0
    var liabilities = 0.0
    var liquidNow = 0.0
    var retirement = 0.0
    var property = 0.0

    for (account in accounts) {
        val balance = latestBalanceHome(account.history)

        // Liabilities store their outstanding balance as a positive number and are
        // subtracted, never added.
        if (account.kind == "liability") {
            liabilities += balance
            continue
        }

        totalAssets += balance
        when (account.liquidity) {
            LiquidityStatus.LIQUID -> liquidNow += balance
            LiquidityStatus.TIME_LOCKED, LiquidityStatus.RETIREMENT -> retirement += balance
            LiquidityStatus.ILLIQUID -> property += balance
            LiquidityStatus.MARKET_LIQUID -> Unit
        }
    }

    // A receivable is a real asset — someone owing you $80 is $80 you have a claim on — but it
    // is deliberately kept out of `liquidNow`, for the same reason property is: you cannot
    // spend it this week, and treating it as spendable is how a runway starts lying. A payable
    // is a real debt.
    val receivables = if (owed.owedToYou.isFinite()) owed.owedToYou else 0.0
    val payables = if (owed.youOwe.isFinite()) owed.youOwe else 0.0

    return AccountTotals(
        totalAssets = totalAssets + receivables,
        liabilities = liabilities + payables,
        liquidNow = liquidNow,
        retirement = retirement,
        property = property,
        receivables = receivables,
    )
}

/** One wedge of the Net Worth Split donut: a bucket name and its home-currency value. */
data class NetWorthSlice(val key: String, val label: String, val value: Double)

data class NetWorthBreakdown(
    val slices: List<NetWorthSlice>,
    val liabilities: Double,
    /**
     * Sum of the visible (positive) slices — the right denominator for each slice's share.
     * Not the same as gross assets when a bucket (e.g. cash, for an overdrawn household) is
     * negative and therefore excluded below.
     */
    val sliceTotal: Double,
)

/**
 * Composition of net worth for the Dashboard split chart: cash-like accounts bucketed by
 * liquidity, plus portfolio holdings (tracked separately from `AccountResponse`, so there's
 * no overlap with [accounts]). Liabilities are returned alongside rather than as a slice — a
 * donut can't render a negative wedge, and net worth is "these assets, minus that debt," not
 * one blended bucket. A negative bucket (e.g. overdrawn cash) is dropped the same way — it
 * still reduces net worth, just not through a wedge.
 */
fun netWorthBreakdown(
    accounts: List<NetWorthAccountInput>,
    portfolioValue: Double,
    owed: OwedTotals = OwedTotals.NONE,
): NetWorthBreakdown {
    val totals = summarizeAccounts(accounts, owed)
    // Anything not liquid/retirement/property/owed (e.g. market_liquid accounts). Receivables
    // are subtracted out and given their own slice rather than left to fall into "Other
    // Assets", where a debt someone owes you would be indistinguishable from an account you
    // forgot to classify.
    val other = totals.totalAssets - totals.liquidNow - totals.retirement -
        totals.property - totals.receivables

    val slices = listOf(
        NetWorthSlice("cash", "Cash", totals.liquidNow),
        NetWorthSlice("investments", "Investments", portfolioValue),
        NetWorthSlice("retirement", "Retirement & Locked", totals.retirement),
        NetWorthSlice("property", "Property", totals.property),
        NetWorthSlice("owed", "Owed to You", totals.receivables),
        NetWorthSlice("other", "Other Assets", other),
    ).filter { it.value > 0.01 }

    return NetWorthBreakdown(
        slices = slices,
        liabilities = totals.liabilities,
        sliceTotal = slices.sumOf { it.value },
    )
}
