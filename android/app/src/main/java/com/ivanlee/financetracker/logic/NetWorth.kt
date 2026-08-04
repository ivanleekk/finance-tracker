package com.ivanlee.financetracker.logic

import com.ivanlee.financetracker.data.model.BalanceResponse
import com.ivanlee.financetracker.data.model.LiquidityStatus

// Net worth aggregation across accounts of every kind. Kotlin port of
// frontend/src/lib/networth.ts (and ios/FinanceTracker/Support/NetWorth.swift) — keep the
// three in sync. Property (an illiquid asset) belongs in net worth but not in "liquid now":
// getting that wrong made a mortgaged household look permanently bankrupt (house missing) or
// absurdly cash-rich (house counted as spendable).

/** Latest home-currency balance from a history, or 0 for an empty history. */
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
) {
    val net: Double get() = totalAssets - liabilities
}

fun summarizeAccounts(accounts: List<NetWorthAccountInput>): AccountTotals {
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

    return AccountTotals(totalAssets, liabilities, liquidNow, retirement, property)
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
fun netWorthBreakdown(accounts: List<NetWorthAccountInput>, portfolioValue: Double): NetWorthBreakdown {
    val totals = summarizeAccounts(accounts)
    // Anything not liquid/retirement/property (e.g. market_liquid accounts).
    val other = totals.totalAssets - totals.liquidNow - totals.retirement - totals.property

    val slices = listOf(
        NetWorthSlice("cash", "Cash", totals.liquidNow),
        NetWorthSlice("investments", "Investments", portfolioValue),
        NetWorthSlice("retirement", "Retirement & Locked", totals.retirement),
        NetWorthSlice("property", "Property", totals.property),
        NetWorthSlice("other", "Other Assets", other),
    ).filter { it.value > 0.01 }

    return NetWorthBreakdown(
        slices = slices,
        liabilities = totals.liabilities,
        sliceTotal = slices.sumOf { it.value },
    )
}
