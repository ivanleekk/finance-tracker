import Charts
import SwiftUI

/// Shared chart look for every Swift Charts view in the app.
///
/// Three rules, applied everywhere so the charts read as one system:
///
/// 1. **Composition colours are fixed, not themed.** A category's hue must not move
///    when the household picks a different accent, and Cash must be the same colour
///    in the Dashboard's area chart as in the Net Worth Split donut directly below it.
///    Single-series charts (one goal's curve, one account's balance) keep the theme
///    accent — with nothing to tell apart, the accent is free to carry the brand.
/// 2. **Fills are washes, not blocks.** A saturated area fill at full strength reads
///    loud and flattens everything else on the screen; each band is a vertical
///    gradient with a crisp 2pt edge line doing the definition instead.
/// 3. **Chrome recedes.** Hairline, *solid* gridlines one step off the surface (dashes
///    read as "projection" when they're just a grid), few ticks, axis labels in
///    secondary ink, no plot border.
enum ChartStyle {

    // MARK: Palette

    /// Fixed categorical palette, mirroring the web's `--chart-cat-1..5`, with its own
    /// dark-mode steps (a dark palette is chosen against the dark surface, never an
    /// automatic flip of the light one). Validated CVD-safe as an adjacent ordering in
    /// both modes — see the dataviz skill's palette validator.
    static let categorical: [Color] = [
        .chartDynamic(light: 0x2A78D6, dark: 0x3987E5),
        .chartDynamic(light: 0xEB6834, dark: 0xD95926),
        .chartDynamic(light: 0x1BAF7A, dark: 0x199E70),
        .chartDynamic(light: 0xEDA100, dark: 0xC98500),
        .chartDynamic(light: 0xE87BA4, dark: 0xD55181),
    ]

    /// Net-worth bucket → palette slot, keyed by `NetWorthSlice.key` rather than by the
    /// slice's index. The donut drops empty buckets, so an index would repaint the
    /// survivors: a household with no property would show "Other Assets" in property's
    /// colour. Colour follows the category, not its row.
    private static let netWorthSlots: [String: Int] = [
        "cash": 0, "investments": 1, "retirement": 2, "property": 3, "other": 4,
    ]

    static func netWorthColor(key: String) -> Color {
        categorical[netWorthSlots[key] ?? (abs(key.hashValue) % categorical.count)]
    }

    static var cash: Color { netWorthColor(key: "cash") }
    static var investments: Color { netWorthColor(key: "investments") }

    /// Gridlines and axis rules: one step off the surface, never competing with the data.
    static let grid: Color = .chartDynamic(light: 0xE4E3E1, dark: 0x3A3A3C)

    /// The card the charts sit on. Used as the *separator* between stacked bands —
    /// a 2pt gap in the surface colour, not a stroke around the marks.
    static let surface: Color = .chartDynamic(light: 0xFFFFFF, dark: 0x1C1C1E)

    // MARK: Marks

    static let lineWidth: CGFloat = 2
    static let separatorWidth: CGFloat = 2

    /// The vertical wash under an area mark: strongest where it meets its edge line,
    /// fading down so overlapping bands and the gridlines stay readable through it.
    static func fill(_ color: Color, top: Double = 0.55, bottom: Double = 0.12) -> LinearGradient {
        LinearGradient(
            colors: [color.opacity(top), color.opacity(bottom)],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    /// A single-series curve's wash — lighter than a composition band, since nothing
    /// sits on top of it and the line carries the shape.
    static func accentFill(_ color: Color) -> LinearGradient {
        fill(color, top: 0.28, bottom: 0.0)
    }
}

extension Color {
    /// A colour that resolves per appearance. Both steps are given explicitly rather
    /// than derived, so the dark palette stays the one that was validated.
    static func chartDynamic(light: UInt32, dark: UInt32) -> Color {
        Color(uiColor: UIColor { traits in
            UIColor(rgbHex: traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

private extension UIColor {
    convenience init(rgbHex hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}

extension ChartStyle {
    /// Date-label format picked from how much time the chart covers: years for a
    /// multi-year history, month+year for a year or so, day+month for a short window.
    /// A fixed format would print "2026" three times on a 1M chart, or "Jan 26" on
    /// every tick of a five-year one.
    static func dateLabelFormat(span: TimeInterval?) -> Date.FormatStyle {
        let days = (span ?? .greatestFiniteMagnitude) / 86_400
        if days > 550 { return .dateTime.year() }
        if days > 90 { return .dateTime.month(.abbreviated).year(.twoDigits) }
        return .dateTime.day().month(.abbreviated)
    }
}

extension View {
    /// The house axis treatment: compact-currency y labels on the trailing edge, a
    /// sparse date axis, hairline solid gridlines and no plot border.
    ///
    /// `dateSpan` is the time the data covers — pass `last.date - first.date` — and
    /// picks how the date labels are written.
    func financeChartAxes(
        currency: String,
        dateSpan: TimeInterval? = nil,
        yTickCount: Int = 4,
        // Three date ticks, not four: on a phone-width plot a fourth crowds the
        // trailing edge, where the y-axis gutter is.
        xTickCount: Int = 3,
        showsXAxis: Bool = true
    ) -> some View {
        let dateFormat = ChartStyle.dateLabelFormat(span: dateSpan)
        return self
            .chartYAxis {
                AxisMarks(position: .trailing, values: .automatic(desiredCount: yTickCount)) { value in
                    AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5))
                        .foregroundStyle(ChartStyle.grid)
                    AxisValueLabel {
                        if let v = value.as(Double.self) {
                            Text(v.compactCurrency(currency))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .chartXAxis {
                if showsXAxis {
                    AxisMarks(values: .automatic(desiredCount: xTickCount)) { value in
                        AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5))
                            .foregroundStyle(ChartStyle.grid)
                        // The newest label is centred on a tick at the plot's trailing
                        // edge, where the y-axis gutter starts; right-anchoring it keeps
                        // it from being truncated to "Jan…".
                        AxisValueLabel(anchor: value.index == value.count - 1 ? .topTrailing : .top) {
                            if let date = value.as(Date.self) {
                                Text(date, format: dateFormat)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .chartPlotStyle { plot in
                plot.border(Color.clear)
            }
    }
}

// MARK: - Scrubbing

/// One line of a scrub readout: what was read, in what colour, and — when the value
/// sits on a plotted line — where its dot belongs in data space.
struct ChartScrubEntry {
    let label: String
    let value: Double
    let color: Color
    /// Data-space y for the marker dot. `nil` for a derived figure (a total) that isn't
    /// itself a line on the chart, so there's nothing on the plot to point at.
    var markerY: Double?
}

/// What the finger is currently over on a time-series chart.
struct ChartScrubReadout: Equatable {
    let date: Date
    let entries: [ChartScrubEntry]

    /// Only the date matters for equality — it's what drives the haptic and the redraw,
    /// and the entries are a pure function of it.
    static func == (lhs: Self, rhs: Self) -> Bool { lhs.date == rhs.date }
}

extension ChartStyle {
    /// The datum nearest a scrub position. Curves are sampled (daily / weekly / monthly
    /// bins), so the finger lands *between* points far more often than on one, and
    /// snapping to the nearest is what makes the dot sit on the line instead of floating
    /// beside it.
    static func nearest<T>(
        to date: Date,
        in points: [T],
        by keyPath: KeyPath<T, Date>
    ) -> T? {
        points.min {
            abs($0[keyPath: keyPath].timeIntervalSince(date))
                < abs($1[keyPath: keyPath].timeIntervalSince(date))
        }
    }

    /// Which slice a donut's angle selection landed in. `chartAngleSelection` reports the
    /// *cumulative* angle value, not an identity, so resolving it means walking the same
    /// running total the sectors were laid out from — in the same order they were plotted.
    static func sliceIndex(
        atAngleValue value: Double?,
        in values: [Double]
    ) -> Int? {
        guard let value else { return nil }
        var running = 0.0
        for (index, slice) in values.enumerated() {
            running += slice
            if value <= running { return index }
        }
        return values.isEmpty ? nil : values.count - 1
    }
}

private struct ChartScrubModifier: ViewModifier {
    @Binding var selection: Date?
    let readout: ChartScrubReadout?

    /// What Swift Charts reports *while* the finger is down. It clears this the instant
    /// the finger lifts, which is wrong for a money chart: you look a date up in order to
    /// read it, and a number that vanishes on release can't be read at all. The live
    /// value is copied into `selection` and stays there until the next scrub or an
    /// explicit clear, so the binding the caller owns is the sticky one.
    @State private var live: Date?

    func body(content: Content) -> some View {
        content
            .chartXSelection(value: $live)
            .onChange(of: live) { _, new in
                if let new { selection = new }
            }
            .chartOverlay { proxy in
                GeometryReader { geo in
                    if let readout,
                       let anchor = proxy.plotFrame,
                       let dx = proxy.position(forX: readout.date) {
                        let plot = geo[anchor]
                        let x = plot.minX + dx

                        Rectangle()
                            .fill(.primary.opacity(0.25))
                            .frame(width: 1, height: plot.height)
                            .position(x: x, y: plot.midY)

                        ForEach(Array(readout.entries.enumerated()), id: \.offset) { _, entry in
                            if let markerY = entry.markerY,
                               let dy = proxy.position(forY: markerY) {
                                // Surface-coloured ring, the same trick the "you are
                                // here" marker uses: the dot has to stay legible sitting
                                // on top of its own line.
                                Circle()
                                    .fill(ChartStyle.surface)
                                    .frame(width: 14, height: 14)
                                    .overlay {
                                        Circle().fill(entry.color).frame(width: 9, height: 9)
                                    }
                                    .position(x: x, y: plot.minY + dy)
                            }
                        }
                    }
                }
                // The overlay is a readout, never a target — hit testing here would
                // swallow the very drag that's driving it.
                .allowsHitTesting(false)
            }
            // One detent per datum, the way a picker ticks. `.selection` and not
            // `.impact`: nothing was committed, the reading just moved.
            .sensoryFeedback(.selection, trigger: readout?.date)
    }
}

extension View {
    /// Make a time-series chart scrubbable: drag across it to read any point.
    ///
    /// The caller owns both halves — the `Date?` the gesture writes, and the readout it
    /// resolves from that date (usually via `ChartStyle.nearest`) — because only the
    /// call site knows which series it plotted and what they mean. This adds the
    /// gesture, the rule and dots on the plot, and the haptic; pair it with a
    /// `ChartScrubCaption` (or wire the readout into the screen's own headline figure).
    func chartScrub(
        selection: Binding<Date?>,
        readout: ChartScrubReadout?
    ) -> some View {
        modifier(ChartScrubModifier(selection: selection, readout: readout))
    }
}

/// The scrub reading, as a caption row beside its chart.
///
/// Deliberately *not* a floating tooltip: a bubble inside the plot covers the very data
/// the finger is asking about, and it has to be measured and clamped every frame to stay
/// on screen. The row also reserves its height when nothing is selected, so starting a
/// scrub never shifts the chart under the finger.
struct ChartScrubCaption: View {
    let readout: ChartScrubReadout?
    let currency: String
    /// The same binding passed to `chartScrub`, so the caption can clear the reading.
    /// The selection sticks after the finger lifts, which means it also needs a way out.
    @Binding var selection: Date?
    /// Shown when nothing is selected, as the gesture's only affordance — a chart that
    /// responds to a drag has no other way to say so.
    var hint: String = "Drag the chart to read any date"

    var body: some View {
        HStack(spacing: 10) {
            if let readout {
                Text(readout.date.scrubDay)
                    .foregroundStyle(.secondary)
                ForEach(Array(readout.entries.enumerated()), id: \.offset) { _, entry in
                    HStack(spacing: 4) {
                        Circle()
                            .fill(entry.color)
                            .frame(width: 6, height: 6)
                        Text(entry.value.currencyWhole(currency))
                            .monospacedDigit()
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(entry.label): \(entry.value.currencyWhole(currency))")
                }
                Spacer(minLength: 0)
                Button { selection = nil } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear chart reading")
            } else {
                Text(hint)
                    .foregroundStyle(.tertiary)
                Spacer(minLength: 0)
            }
        }
        .font(.caption.weight(.medium))
        .lineLimit(1)
        .minimumScaleFactor(0.75)
        .frame(height: 16)
    }
}
