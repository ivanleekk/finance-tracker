import Charts
import SwiftUI

// The Dashboard's two charts — the net-worth stacked area and the net-worth
// split donut — plus the point type they share.

/// A single stacked-area data point for the net-worth chart.
struct NetWorthBandPoint: Identifiable {
    /// The date, not a fresh `UUID`. A per-instance UUID gave every point a new identity
    /// each time the series was rebuilt, so Swift Charts could never match a mark to its
    /// previous self and rebuilt the whole plot from scratch on every redraw.
    var id: Date { date }
    let date: Date
    /// Cash-like accounts net of liabilities — negative for an overdrawn household.
    let cash: Double
    let investments: Double

    /// Cash occupies the band between zero and itself, so debt hangs *below* the axis
    /// instead of being stacked upwards as if it were an asset.
    var cashBottom: Double { min(cash, 0) }
    var cashTop: Double { max(cash, 0) }
    /// Investments always sit on the positive side, on top of whatever cash there is.
    var investmentsBottom: Double { max(cash, 0) }
    var investmentsTop: Double { max(cash, 0) + investments }
    var total: Double { cash + investments }
}

/// The Dashboard's net-worth composition over time: a cash band and an investments
/// band, with the net-worth line drawn over them.
///
/// The line isn't decoration — with liabilities pulling cash negative the two bands no
/// longer add up to what the reader is looking for, and the line is the only thing on
/// the chart that states net worth. It stays for the positive case too, so the shape
/// people learn to read doesn't change with their balance sheet.
struct NetWorthAreaChart: View {
    let bands: [NetWorthBandPoint]
    let currency: String
    /// Owned by the Dashboard, not this view: scrubbing re-reads the headline Net Worth
    /// figure and the Cash / Investments cells above and below the plot, which is a
    /// better place for the number than a tooltip drawn over the curve it came from.
    @Binding var scrubDate: Date?
    let readout: ChartScrubReadout?

    private var hasDebtBelowZero: Bool { bands.contains { $0.cash < 0 } }

    private var span: TimeInterval? {
        guard let first = bands.first?.date, let last = bands.last?.date else { return nil }
        return last.timeIntervalSince(first)
    }

    /// Points where each band actually has height. A band's edge line is only drawn
    /// where its fill exists — otherwise the investments line runs along the top of the
    /// *cash* fill for every month before the first trade, and the colours stop matching
    /// what they bound.
    private var cashPoints: [NetWorthBandPoint] { bands.filter { abs($0.cash) > 0.005 } }
    private var investmentPoints: [NetWorthBandPoint] { bands.filter { $0.investments > 0.005 } }

    var body: some View {
        Chart {
            ForEach(bands) { point in
                AreaMark(
                    x: .value("Date", point.date),
                    yStart: .value("From", point.cashBottom),
                    yEnd: .value("To", point.cashTop),
                    series: .value("Band", "cash")
                )
                .foregroundStyle(ChartStyle.fill(ChartStyle.cash))
                .interpolationMethod(.monotone)

                AreaMark(
                    x: .value("Date", point.date),
                    yStart: .value("From", point.investmentsBottom),
                    yEnd: .value("To", point.investmentsTop),
                    series: .value("Band", "investments")
                )
                .foregroundStyle(ChartStyle.fill(ChartStyle.investments))
                .interpolationMethod(.monotone)
            }

            // The separator is drawn slightly wider than the cash edge line that lands on
            // top of it, so what's left is a hairline of surface colour either side of a
            // blue line: the house 2pt gap between touching fills, and the cash band's own
            // edge, in one stroke. A border around each band would be ink that isn't data.
            ForEach(cashPoints) { point in
                LineMark(
                    x: .value("Date", point.date),
                    y: .value("Cash", point.cashTop),
                    series: .value("Series", "separator")
                )
                .foregroundStyle(ChartStyle.surface)
                .lineStyle(StrokeStyle(lineWidth: ChartStyle.lineWidth + ChartStyle.separatorWidth))
                .interpolationMethod(.monotone)
            }

            ForEach(cashPoints) { point in
                LineMark(
                    x: .value("Date", point.date),
                    y: .value("Cash", point.cashTop),
                    series: .value("Series", "cash")
                )
                .foregroundStyle(ChartStyle.cash)
                .lineStyle(StrokeStyle(lineWidth: ChartStyle.lineWidth, lineCap: .round, lineJoin: .round))
                .interpolationMethod(.monotone)
            }

            ForEach(investmentPoints) { point in
                LineMark(
                    x: .value("Date", point.date),
                    y: .value("Investments", point.investmentsTop),
                    series: .value("Series", "investments")
                )
                .foregroundStyle(ChartStyle.investments)
                .lineStyle(StrokeStyle(lineWidth: ChartStyle.lineWidth, lineCap: .round, lineJoin: .round))
                .interpolationMethod(.monotone)
            }

            // "You are here": one marker on the topmost band, in that band's own colour,
            // with a 2pt ring in the surface colour so it stays legible on the line.
            if let last = bands.last {
                let onInvestments = last.investments > 0.005
                let markerY = onInvestments ? last.investmentsTop : last.cashTop
                let markerColor = onInvestments ? ChartStyle.investments : ChartStyle.cash
                PointMark(x: .value("Date", last.date), y: .value("Latest", markerY))
                    .symbolSize(60)
                    .foregroundStyle(markerColor)
                PointMark(x: .value("Date", last.date), y: .value("Latest", markerY))
                    .symbolSize(14)
                    .foregroundStyle(ChartStyle.surface)
            }

            // Only when debt pulls cash below zero, where the top of the stack is no
            // longer the number the reader came for. With cash positive the stack's own
            // top edge *is* net worth, and a second line over it is just doubled ink.
            if hasDebtBelowZero {
                ForEach(bands) { point in
                    LineMark(
                        x: .value("Date", point.date),
                        y: .value("Net worth", point.total),
                        series: .value("Series", "total")
                    )
                    .foregroundStyle(.primary.opacity(0.45))
                    .lineStyle(StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
                    .interpolationMethod(.monotone)
                }

                RuleMark(y: .value("Zero", 0))
                    .foregroundStyle(ChartStyle.grid)
                    .lineStyle(StrokeStyle(lineWidth: 1))
            }
        }
        .chartLegend(.hidden)
        .financeChartAxes(currency: currency, dateSpan: span)
        .chartScrub(selection: $scrubDate, readout: readout)
        .adaptiveChartHeight(compact: 180, regular: 300)
    }
}

/// Donut + legend for the Dashboard's Net Worth Split: gross asset composition,
/// with liabilities and the net total as plain rows below rather than wedges
/// (a donut can't render a negative slice). Native counterpart of the web
/// Dashboard's "Net Worth Split" card.
struct NetWorthSplitChart: View {
    let breakdown: NetWorthBreakdown
    /// The household's actual net worth (assets net of liabilities across
    /// *every* bucket, including one dropped from the donut for being
    /// negative) — deliberately not derived from `breakdown.sliceTotal`,
    /// which only covers the visible (positive) slices.
    let netWorth: Double
    let currency: String

    /// Keyed by bucket, not by position in the list: empty buckets are dropped before
    /// this renders, so an index would hand "Other Assets" the colour Property had on
    /// another household's screen. See `ChartStyle.netWorthColor`.
    private func color(_ slice: NetWorthSlice) -> Color { ChartStyle.netWorthColor(key: slice.key) }

    /// Cumulative angle the touch landed on. `chartAngleSelection` reports a position
    /// along the total, not a slice, so it's resolved through `ChartStyle.sliceIndex`.
    ///
    /// Two states, not one: Swift Charts clears its own binding the instant the finger
    /// lifts, so `live` is what it writes and `picked` is what the view reads. That also
    /// keeps the legend buttons working — they set `picked` directly, where the chart
    /// can't overwrite them.
    @State private var liveAngle: Double?
    @State private var pickedAngle: Double?

    private var selected: Int? {
        ChartStyle.sliceIndex(atAngleValue: pickedAngle, in: breakdown.slices.map(\.value))
    }

    var body: some View {
        VStack(spacing: 16) {
            Chart(Array(breakdown.slices.enumerated()), id: \.element.id) { index, slice in
                SectorMark(
                    angle: .value("Value", slice.value),
                    // The picked wedge grows outward — the shape itself says which one
                    // is being read, before the label in the middle is even looked at.
                    innerRadius: .ratio(0.62),
                    outerRadius: .ratio(selected == index ? 1.0 : 0.92),
                    angularInset: 1.5
                )
                .cornerRadius(3)
                .foregroundStyle(color(slice))
                .opacity(selected == nil || selected == index ? 1 : 0.3)
            }
            .chartAngleSelection(value: $liveAngle)
            .onChange(of: liveAngle) { _, new in
                if let new { pickedAngle = new }
            }
            .chartLegend(.hidden)
            .frame(height: 150)
            .overlay { donutCenter }
            .animation(.snappy(duration: 0.22), value: selected)
            .sensoryFeedback(.selection, trigger: selected)

            VStack(spacing: 8) {
                ForEach(Array(breakdown.slices.enumerated()), id: \.element.id) { index, slice in
                    // Tapping the legend selects the same wedge: a 30°-wide sector is a
                    // poor touch target, and this row is the accessible way to hit it.
                    Button {
                        pickedAngle = selected == index ? nil : midAngleValue(of: index)
                    } label: {
                        HStack(spacing: 8) {
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .fill(color(slice))
                                .frame(width: 11, height: 11)
                            // Each label states its own colour: the borderless button
                            // style below tints its whole label with the accent, and an
                            // inherited `.foregroundStyle` on the stack doesn't beat it.
                            Text(slice.label)
                                .font(.caption)
                                .foregroundStyle(.primary)
                            Spacer()
                            Text(slice.value.currencyWhole(currency))
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.primary)
                            Text("\(Int((slice.value / breakdown.sliceTotal * 100).rounded()))%")
                                .font(.caption2.monospacedDigit())
                                .foregroundStyle(.secondary)
                                .frame(width: 36, alignment: .trailing)
                        }
                        .contentShape(Rectangle())
                        .opacity(selected == nil || selected == index ? 1 : 0.4)
                    }
                    // `.borderless`, not `.plain`: inside a List row SwiftUI only
                    // hit-tests several buttons independently for the borderless style —
                    // with `.plain` the row swallows the tap and nothing selects. The
                    // style tints its whole label with the accent and wins over any
                    // `.foregroundStyle` inside it, so the tint itself is what has to be
                    // neutralised — this is a legend, not a link.
                    .buttonStyle(.borderless)
                    .tint(.primary)
                }

                if breakdown.liabilities > 0 {
                    Divider()
                    HStack {
                        Text("− Liabilities")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Text(breakdown.liabilities.currencyWhole(currency))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.red)
                    }
                }
                HStack {
                    Text("Net worth")
                        .font(.caption.weight(.semibold))
                    Spacer()
                    Text(netWorth.currencyWhole(currency))
                        .font(.caption.monospacedDigit().weight(.semibold))
                }
            }
        }
        .padding(.vertical, 4)
    }
}

extension NetWorthSplitChart {
    /// The hole in the middle earns its keep: net worth at rest, the picked bucket while
    /// one is selected. Same slot, so nothing on the card moves when a wedge is tapped.
    @ViewBuilder
    fileprivate var donutCenter: some View {
        VStack(spacing: 1) {
            if let selected, breakdown.slices.indices.contains(selected) {
                let slice = breakdown.slices[selected]
                Text(slice.label)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text(slice.value.compactCurrency(currency))
                    .font(.headline.monospacedDigit())
                Text("\(Int((slice.value / breakdown.sliceTotal * 100).rounded()))%")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
            } else {
                Text("Net worth")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text(netWorth.compactCurrency(currency))
                    .font(.headline.monospacedDigit())
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .padding(.horizontal, 30)
        .allowsHitTesting(false)
    }

    /// The cumulative angle at the middle of a slice — what the legend hands the chart to
    /// select that wedge, since the selection is expressed as a position along the total.
    fileprivate func midAngleValue(of index: Int) -> Double {
        let values = breakdown.slices.map(\.value)
        let before = values.prefix(index).reduce(0, +)
        return before + (values[index] / 2)
    }
}
