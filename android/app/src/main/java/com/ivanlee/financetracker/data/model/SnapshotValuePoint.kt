package com.ivanlee.financetracker.data.model

import java.time.Instant

/**
 * A per-date, per-sub-portfolio value point.
 *
 * Lets `equityCurve` and `valueHistory` work identically over raw [PortfolioSnapshotResponse]
 * rows (summed across assets client-side) or pre-aggregated [PortfolioTimeseriesPoint]s from
 * the `/timeseries` endpoint (already summed server-side) — same math, different source.
 */
interface SnapshotValuePoint {
    val date: Instant
    val subPortfolioId: String

    /**
     * Home-currency value, coerced to 0 if the underlying field was non-finite so nothing
     * downstream (deltas, percentages) turns NaN.
     */
    val value: Double
}
