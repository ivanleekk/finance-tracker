package com.ivanlee.financetracker

import com.ivanlee.financetracker.data.model.BalanceResponse
import com.ivanlee.financetracker.data.model.LiquidityStatus
import com.ivanlee.financetracker.logic.NetWorthAccountInput
import com.ivanlee.financetracker.logic.latestBalanceHome
import com.ivanlee.financetracker.logic.netWorthBreakdown
import com.ivanlee.financetracker.logic.summarizeAccounts
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * Kotlin twin of iOS's `NetWorthTests` / web's `networth.test.ts`.
 *
 * Backs the Dashboard's net worth total and its Net Worth Split donut, so a mistake here
 * misstates money on the first screen a user sees.
 */
class NetWorthTest {

    private fun day(iso: String): Instant = LocalDate.parse(iso).atStartOfDay(ZoneOffset.UTC).toInstant()

    private fun balance(amount: Double, home: Double? = null, date: String = "2026-01-01") =
        BalanceResponse(
            id = "$date-$amount",
            accountId = "a",
            date = day(date),
            balance = amount,
            balanceHomeCurrency = home ?: amount,
            isManual = true,
        )

    private fun account(
        kind: String? = "asset",
        liquidity: LiquidityStatus = LiquidityStatus.LIQUID,
        history: List<BalanceResponse> = emptyList(),
    ) = NetWorthAccountInput(kind, liquidity, history)

    // ---- latestBalanceHome ---------------------------------------------------------------

    @Test
    fun `latestBalanceHome picks the newest checkpoint`() {
        val value = latestBalanceHome(
            listOf(
                balance(100.0, date = "2026-01-01"),
                balance(900.0, date = "2026-06-01"),
                balance(500.0, date = "2026-03-01"),
            )
        )
        assertEquals(900.0, value, 0.0)
    }

    @Test
    fun `latestBalanceHome returns zero for empty history`() {
        assertEquals(0.0, latestBalanceHome(emptyList()), 0.0)
    }

    // ---- summarizeAccounts ----------------------------------------------------------------

    @Test
    fun `summarizeAccounts counts property alongside the loan against it`() {
        val home = account(liquidity = LiquidityStatus.ILLIQUID, history = listOf(balance(500_000.0)))
        val mortgage = account(kind = "liability", history = listOf(balance(400_000.0)))
        val savings = account(history = listOf(balance(10_000.0)))

        val totals = summarizeAccounts(listOf(home, mortgage, savings))
        assertEquals(510_000.0, totals.totalAssets, 0.0)
        assertEquals(400_000.0, totals.liabilities, 0.0)
        assertEquals(110_000.0, totals.net, 0.0)
    }

    @Test
    fun `summarizeAccounts keeps property out of liquid now`() {
        val home = account(liquidity = LiquidityStatus.ILLIQUID, history = listOf(balance(500_000.0)))
        val savings = account(history = listOf(balance(10_000.0)))

        val totals = summarizeAccounts(listOf(home, savings))
        assertEquals(500_000.0, totals.property, 0.0)
        assertEquals(10_000.0, totals.liquidNow, 0.0)
    }

    @Test
    fun `summarizeAccounts groups time locked and retirement together`() {
        val cpf = account(liquidity = LiquidityStatus.TIME_LOCKED, history = listOf(balance(30_000.0)))
        val srs = account(liquidity = LiquidityStatus.RETIREMENT, history = listOf(balance(20_000.0)))
        assertEquals(50_000.0, summarizeAccounts(listOf(cpf, srs)).retirement, 0.0)
    }

    // ---- netWorthBreakdown ------------------------------------------------------------------

    @Test
    fun `buckets cash retirement and property and adds investments as their own slice`() {
        val savings = account(history = listOf(balance(10_000.0)))
        val cpf = account(liquidity = LiquidityStatus.TIME_LOCKED, history = listOf(balance(30_000.0)))
        val home = account(liquidity = LiquidityStatus.ILLIQUID, history = listOf(balance(500_000.0)))

        val breakdown = netWorthBreakdown(listOf(savings, cpf, home), portfolioValue = 20_000.0)

        assertEquals(listOf("cash", "investments", "retirement", "property"), breakdown.slices.map { it.key })
        assertEquals(listOf(10_000.0, 20_000.0, 30_000.0, 500_000.0), breakdown.slices.map { it.value })
        assertEquals(560_000.0, breakdown.sliceTotal, 0.0)
    }

    @Test
    fun `reports liabilities alongside the slices rather than as a negative wedge`() {
        val mortgage = account(kind = "liability", history = listOf(balance(400_000.0)))
        val home = account(liquidity = LiquidityStatus.ILLIQUID, history = listOf(balance(500_000.0)))

        val breakdown = netWorthBreakdown(listOf(mortgage, home), portfolioValue = 0.0)

        assertEquals(400_000.0, breakdown.liabilities, 0.0)
        assertFalse(breakdown.slices.any { it.key == "liabilities" })
    }

    @Test
    fun `drops a negative bucket instead of an impossible negative wedge`() {
        val overdrawn = account(history = listOf(balance(-12_000.0)))
        val home = account(liquidity = LiquidityStatus.ILLIQUID, history = listOf(balance(500_000.0)))

        val breakdown = netWorthBreakdown(listOf(overdrawn, home), portfolioValue = 0.0)

        assertEquals(listOf("property"), breakdown.slices.map { it.key })
        // sliceTotal is the denominator for each slice's %, so it must match the visible
        // slices — not gross assets, which the excluded negative cash bucket would
        // otherwise drag below the property total.
        assertEquals(500_000.0, breakdown.sliceTotal, 0.0)
    }

    @Test
    fun `buckets a market liquid account as other rather than dropping it`() {
        val brokerageCash = account(liquidity = LiquidityStatus.MARKET_LIQUID, history = listOf(balance(5_000.0)))
        val breakdown = netWorthBreakdown(listOf(brokerageCash), portfolioValue = 0.0)
        assertEquals(listOf("other"), breakdown.slices.map { it.key })
        assertEquals(listOf(5_000.0), breakdown.slices.map { it.value })
    }
}
