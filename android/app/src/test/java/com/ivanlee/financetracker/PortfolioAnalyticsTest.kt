package com.ivanlee.financetracker

import com.ivanlee.financetracker.data.model.AssetResponse
import com.ivanlee.financetracker.data.model.PortfolioTimeseriesPoint
import com.ivanlee.financetracker.data.model.PortfolioSnapshotResponse
import com.ivanlee.financetracker.logic.GrowthBin
import com.ivanlee.financetracker.logic.GrowthRange
import com.ivanlee.financetracker.logic.allocationSlices
import com.ivanlee.financetracker.logic.equityCurve
import com.ivanlee.financetracker.logic.fxExposure
import com.ivanlee.financetracker.logic.growthBin
import com.ivanlee.financetracker.logic.periodChange
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * Kotlin twin of iOS's `PortfolioAnalyticsTests`.
 *
 * Every date is built explicitly in UTC so results never depend on the machine's timezone —
 * the bucketing rules under test are UTC by design, and a test that passed only in SGT would
 * be worse than no test.
 */
class PortfolioAnalyticsTest {

    private fun day(iso: String): Instant =
        LocalDate.parse(iso).atStartOfDay(ZoneOffset.UTC).toInstant()

    private fun point(date: String, sub: String, value: Double) =
        PortfolioTimeseriesPoint(day(date), sub, value)

    private fun holding(
        assetId: String,
        value: Double,
        sub: String = "s1",
    ) = PortfolioSnapshotResponse(
        id = "h-$assetId",
        householdId = "hh",
        subPortfolioId = sub,
        assetId = assetId,
        date = day("2026-07-01"),
        quantity = 1.0,
        price = value,
        exchangeRateUsed = 1.0,
        currentValueHomeCurrency = value,
        averageCostBasis = value,
        averageCostBasisHomeCurrency = value,
    )

    private fun asset(id: String, type: String, currency: String) =
        AssetResponse(id = id, ticker = id, name = id, type = type, currency = currency)

    // ---- Aggregation & scoping ----------------------------------------------------------

    @Test
    fun `equity curve sums across sub-portfolios per date`() {
        val curve = equityCurve(
            listOf(
                point("2026-07-01", "a", 100.0),
                point("2026-07-01", "b", 50.0),
                point("2026-07-02", "a", 120.0),
            ),
            now = day("2026-07-03"),
        )
        assertEquals(2, curve.size)
        assertEquals(150.0, curve[0].value, 1e-9)
        assertEquals(120.0, curve[1].value, 1e-9)
    }

    @Test
    fun `equity curve scoped to one sub-portfolio ignores the others`() {
        val curve = equityCurve(
            listOf(
                point("2026-07-01", "a", 100.0),
                point("2026-07-01", "b", 50.0),
            ),
            subPortfolioId = "b",
            now = day("2026-07-03"),
        )
        assertEquals(1, curve.size)
        assertEquals(50.0, curve[0].value, 1e-9)
    }

    @Test
    fun `range window drops points older than the cutoff`() {
        val curve = equityCurve(
            listOf(
                point("2026-01-01", "a", 10.0),
                point("2026-07-01", "a", 20.0),
            ),
            range = GrowthRange.ONE_MONTH,
            now = day("2026-07-15"),
        )
        assertEquals(1, curve.size)
        assertEquals(20.0, curve[0].value, 1e-9)
    }

    // ---- Binning ------------------------------------------------------------------------

    @Test
    fun `bin thresholds are a quarter and about eighteen months`() {
        assertEquals(GrowthBin.DAILY, growthBin(92.0))
        assertEquals(GrowthBin.WEEKLY, growthBin(93.0))
        assertEquals(GrowthBin.WEEKLY, growthBin(550.0))
        assertEquals(GrowthBin.MONTHLY, growthBin(551.0))
    }

    @Test
    fun `a bucket keeps its last value, not a sum`() {
        // Six months of month-ends: long enough to bin weekly, short enough to stay readable.
        val points = listOf(
            point("2026-01-05", "a", 100.0), // Monday
            point("2026-01-07", "a", 130.0), // same ISO week — this one should win
            point("2026-06-01", "a", 400.0),
        )
        val curve = equityCurve(points, now = day("2026-06-02"))
        // An equity curve is a running balance: adding the two January days would double-count.
        assertTrue(curve.none { it.value == 230.0 })
        assertEquals(130.0, curve.first().value, 1e-9)
    }

    // ---- Period change ------------------------------------------------------------------

    @Test
    fun `period change reports delta and fraction on a real base`() {
        val change = periodChange(
            equityCurve(
                listOf(point("2026-06-01", "a", 1000.0), point("2026-06-20", "a", 1100.0)),
                now = day("2026-06-21"),
            )
        )!!
        assertEquals(100.0, change.delta, 1e-9)
        assertEquals(0.1, change.fraction!!, 1e-9)
    }

    @Test
    fun `percentage is withheld when the window opened on a near-zero base`() {
        // $42 → $13,104 is a goal being funded, not a +31,100% return.
        val change = periodChange(
            equityCurve(
                listOf(point("2026-06-01", "a", 42.0), point("2026-06-20", "a", 13104.0)),
                now = day("2026-06-21"),
            )
        )!!
        assertEquals(13062.0, change.delta, 1e-9)
        assertNull(change.fraction)
    }

    @Test
    fun `period change needs two points`() {
        assertNull(periodChange(emptyList()))
        assertNull(periodChange(equityCurve(listOf(point("2026-06-01", "a", 1.0)), now = day("2026-06-02"))))
    }

    // ---- Allocation & FX ----------------------------------------------------------------

    @Test
    fun `allocation groups by asset type, largest first`() {
        val assets = mapOf(
            "x" to asset("x", "stock", "USD"),
            "y" to asset("y", "etf", "USD"),
            "z" to asset("z", "stock", "SGD"),
        )
        val slices = allocationSlices(
            listOf(holding("x", 100.0), holding("y", 300.0), holding("z", 100.0)),
            assets,
        )
        assertEquals(listOf("etf", "stock"), slices.map { it.type })
        assertEquals(60.0, slices[0].pct, 1e-9)
        assertEquals(40.0, slices[1].pct, 1e-9)
    }

    @Test
    fun `unknown assets fall into other rather than being dropped`() {
        val slices = allocationSlices(listOf(holding("ghost", 50.0)), emptyMap())
        assertEquals(1, slices.size)
        assertEquals("other", slices[0].type)
    }

    @Test
    fun `fx exposure is weighted by home-currency value`() {
        val assets = mapOf(
            "x" to asset("x", "stock", "USD"),
            "z" to asset("z", "stock", "SGD"),
        )
        val fx = fxExposure(listOf(holding("x", 750.0), holding("z", 250.0)), assets, "USD")
        assertEquals(listOf("USD", "SGD"), fx.map { it.currency })
        assertEquals(75.0, fx[0].pct, 1e-9)
    }

    @Test
    fun `empty holdings produce no slices instead of dividing by zero`() {
        assertTrue(allocationSlices(emptyList(), emptyMap()).isEmpty())
        assertTrue(fxExposure(emptyList(), emptyMap(), "USD").isEmpty())
    }

    @Test
    fun `allocation label title-cases a snake_case type`() {
        val slices = allocationSlices(
            listOf(holding("x", 10.0)),
            mapOf("x" to asset("x", "time_locked", "USD")),
        )
        assertEquals("Time Locked", slices[0].label)
    }
}
