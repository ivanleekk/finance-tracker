import Charts
import SwiftUI

// The "Top categories" card and the pieces only it uses: the donut, the
// filterable chip list, and the month/year period picker. Split out of
// TransactionsView.swift, where it was the single largest thing in the file.

struct CategoryOption: Identifiable, Hashable {
    let id: String
    let name: String
}

struct CategorySpend: Identifiable {
    let id: String
    let name: String
    let amount: Double
}

/// Spending-by-category donut + filterable chip list + top-4 bars. Native counterpart of the
/// web Transactions "Top categories" card, including its category filter and pie chart.
struct CategoryBreakdownCard: View {
    let breakdown: (all: [CategorySpend], top: [CategorySpend], total: Double)
    let pieSlices: [CategorySpend]
    let categoryOptions: [CategoryOption]
    let hiddenCategoryIds: Set<String>
    @Binding var showFilter: Bool
    @Binding var period: CategoryPeriod
    @Binding var customStart: Date?
    @Binding var customEnd: Date?
    let baseCurrency: String
    /// Stable per-category colour from the parent; nil for buckets that aren't a real category
    /// (the "Other" rollup slice, "Uncategorized").
    let colorForCategory: (String) -> Color?
    let onToggle: (String) -> Void
    let onReset: () -> Void

    /// Neutral fallback matching the web's `OTHER_SLICE_COLOR`.
    private static let otherSliceColor = Color.secondary.opacity(0.4)

    private func color(_ id: String) -> Color { colorForCategory(id) ?? Self.otherSliceColor }

    private var topMax: Double { max(breakdown.top.map(\.amount).max() ?? 1, 1) }

    /// Cumulative angle the touch landed on; resolved to a slice by `ChartStyle.sliceIndex`.
    ///
    /// Two states, not one: Swift Charts clears its own binding the instant the finger
    /// lifts, so `live` is what it writes and `picked` is what the view reads.
    @State private var liveAngle: Double?
    @State private var pickedAngle: Double?

    private var selected: Int? {
        ChartStyle.sliceIndex(atAngleValue: pickedAngle, in: pieSlices.map(\.amount))
    }

    /// Bound non-optional dates for the two DatePickers; picking a date is what turns the
    /// corresponding open-ended bound into a real one.
    private var startBinding: Binding<Date> {
        Binding(get: { customStart ?? Date() }, set: { customStart = $0 })
    }
    private var endBinding: Binding<Date> {
        Binding(get: { customEnd ?? Date() }, set: { customEnd = $0 })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Picker("Period", selection: $period) {
                    ForEach(CategoryPeriod.allCases) { option in
                        Text(option.label).tag(option)
                    }
                }
                .pickerStyle(.menu)
                .font(.caption)
                Spacer()
                Button {
                    showFilter.toggle()
                } label: {
                    Label(
                        hiddenCategoryIds.isEmpty ? "Filter" : "Filter (\(hiddenCategoryIds.count) hidden)",
                        systemImage: "line.3.horizontal.decrease.circle"
                    )
                    .font(.caption.weight(.semibold))
                }
            }

            if period == .specificMonth {
                MonthYearPicker(anchor: $customStart)
            }

            if period == .custom {
                VStack(spacing: 4) {
                    DatePicker("From", selection: startBinding, displayedComponents: .date)
                    DatePicker("To", selection: endBinding, displayedComponents: .date)
                }
                .font(.caption)
            }

            if showFilter {
                CategoryFilterChips(
                    options: categoryOptions,
                    hiddenCategoryIds: hiddenCategoryIds,
                    colorForCategory: colorForCategory,
                    onToggle: onToggle,
                    onReset: onReset
                )
            }

            if breakdown.all.isEmpty {
                Text(hiddenCategoryIds.isEmpty ? "No expenses in this period." : "All categories are hidden.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            } else {
                Chart(Array(pieSlices.enumerated()), id: \.element.id) { index, slice in
                    SectorMark(
                        angle: .value("Amount", slice.amount),
                        // The picked wedge grows outward, so the shape says which one is
                        // being read before the label in the middle is looked at.
                        innerRadius: .ratio(0.55),
                        outerRadius: .ratio(selected == index ? 1.0 : 0.92),
                        angularInset: 1.5
                    )
                    .cornerRadius(3)
                    .foregroundStyle(color(slice.id))
                    .opacity(selected == nil || selected == index ? 1 : 0.3)
                }
                .chartAngleSelection(value: $liveAngle)
                .onChange(of: liveAngle) { _, new in
                    if let new { pickedAngle = new }
                }
                .chartLegend(.hidden)
                .frame(height: 140)
                .overlay {
                    VStack(spacing: 1) {
                        if let selected, pieSlices.indices.contains(selected) {
                            let slice = pieSlices[selected]
                            Text(slice.name)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            Text(slice.amount.compactCurrency(baseCurrency))
                                .font(.headline.monospacedDigit())
                        } else {
                            Text("Spent")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            Text(breakdown.total.compactCurrency(baseCurrency))
                                .font(.headline.monospacedDigit())
                        }
                    }
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .padding(.horizontal, 24)
                    .allowsHitTesting(false)
                }
                .animation(.snappy(duration: 0.22), value: selected)
                .sensoryFeedback(.selection, trigger: selected)

                VStack(spacing: 10) {
                    ForEach(breakdown.top) { cat in
                        let pct = breakdown.total > 0 ? cat.amount / breakdown.total * 100 : 0
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Circle().fill(color(cat.id)).frame(width: 8, height: 8)
                                Text(cat.name).font(.caption)
                                Spacer()
                                Text(cat.amount.currencyWhole(baseCurrency))
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.secondary)
                                Text("· \(Int(pct.rounded()))%")
                                    .font(.caption2.monospacedDigit())
                                    .foregroundStyle(.secondary)
                            }
                            GeometryReader { geo in
                                ZStack(alignment: .leading) {
                                    Capsule().fill(.quaternary)
                                    Capsule()
                                        .fill(color(cat.id))
                                        .frame(width: geo.size.width * (cat.amount / topMax))
                                }
                            }
                            .frame(height: 6)
                        }
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }
}

/// Month + year menus for the "Specific month" period.
///
/// SwiftUI has no month-granularity DatePicker, and a day picker would imply the day matters
/// (it doesn't — only year/month are read). Two menus keep the choice unambiguous and fit the
/// card's width on a phone.
private struct MonthYearPicker: View {
    @Binding var anchor: Date?

    private var calendar: Calendar { CategoryPeriod.utcCalendar }
    private var current: Date { anchor ?? Date() }

    /// A decade back plus the current year — spending history older than that is rare, and an
    /// unbounded year list makes the menu unusable.
    private var years: [Int] {
        let thisYear = calendar.component(.year, from: Date())
        return Array((thisYear - 10)...thisYear).reversed()
    }

    private static let monthNames: [String] = {
        let f = DateFormatter()
        f.locale = .current
        return f.standaloneMonthSymbols ?? f.monthSymbols
    }()

    private func set(month: Int? = nil, year: Int? = nil) {
        var components = DateComponents()
        components.year = year ?? calendar.component(.year, from: current)
        components.month = month ?? calendar.component(.month, from: current)
        components.day = 1
        anchor = calendar.date(from: components)
    }

    var body: some View {
        HStack(spacing: 8) {
            Picker("Month", selection: Binding(
                get: { calendar.component(.month, from: current) },
                set: { set(month: $0) }
            )) {
                ForEach(1...12, id: \.self) { month in
                    Text(Self.monthNames[month - 1]).tag(month)
                }
            }
            Picker("Year", selection: Binding(
                get: { calendar.component(.year, from: current) },
                set: { set(year: $0) }
            )) {
                ForEach(years, id: \.self) { year in
                    Text(String(year)).tag(year)
                }
            }
        }
        .pickerStyle(.menu)
        .font(.caption)
    }
}

/// Toggleable capsule chips — tapping one adds/removes that category from `hiddenCategoryIds`.
private struct CategoryFilterChips: View {
    let options: [CategoryOption]
    let hiddenCategoryIds: Set<String>
    let colorForCategory: (String) -> Color?
    let onToggle: (String) -> Void
    let onReset: () -> Void

    private let columns = [GridItem(.adaptive(minimum: 80), spacing: 8)]

    var body: some View {
        if options.isEmpty {
            Text("No expense categories in this period.")
                .font(.caption)
                .foregroundStyle(.secondary)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                LazyVGrid(columns: columns, alignment: .leading, spacing: 8) {
                    ForEach(options) { option in
                        let hidden = hiddenCategoryIds.contains(option.id)
                        Button {
                            onToggle(option.id)
                        } label: {
                            HStack(spacing: 5) {
                                if !hidden, let dot = colorForCategory(option.id) {
                                    Circle().fill(dot).frame(width: 7, height: 7)
                                }
                                Text(option.name)
                                    .font(.caption.weight(.medium))
                                    .lineLimit(1)
                                    .strikethrough(hidden)
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(hidden ? Color(.tertiarySystemGroupedBackground) : Color.accentColor.opacity(0.16))
                            .foregroundStyle(hidden ? .secondary : Color.accentColor)
                            .clipShape(Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
                // Clears every hidden category at once — re-toggling a dozen chips by hand to get
                // back to the full picture is the tedium this exists to remove.
                if !hiddenCategoryIds.isEmpty {
                    Button {
                        onReset()
                    } label: {
                        Label("Reset", systemImage: "arrow.counterclockwise")
                            .font(.caption.weight(.medium))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Color.accentColor)
                }
            }
        }
    }
}
