import SwiftUI

/// "My spend this month": the caller's own share of this calendar month's
/// spending, with investing/transfers/balance corrections/reimbursement
/// settlements left out. Native counterpart of the web Transactions page's
/// "My spend this month" card — distinct from the raw Activity total below
/// (every transaction) and from the Budgets total (mixes monthly/yearly
/// limits).
struct PersonalSpendCard: View {
    let spend: PersonalSpendResponse
    let baseCurrency: String

    /// nil when there's nothing to compare against — a household with no
    /// spending at this point last month shouldn't be told it's up or down
    /// some percentage of zero.
    private var deltaPercent: Double? {
        guard spend.previousTotal > 0 else { return nil }
        return (spend.total - spend.previousTotal) / spend.previousTotal * 100
    }

    /// Same adaptive-wrap idiom `CategoryFilterChips` uses for its chip row —
    /// a handful of variable-width labels that should wrap at any Dynamic
    /// Type size rather than clip or force a fixed column count.
    private let columns = [GridItem(.adaptive(minimum: 90), spacing: 8)]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("My spend this month")
                        .font(.subheadline.weight(.semibold))
                    Text("Your own share only — split bills, investing, transfers and reimbursement settlements are left out.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(spend.total.currencyWhole(baseCurrency))
                        .font(.title2.bold().monospacedDigit())
                    if let deltaPercent {
                        Text("\(deltaPercent >= 0 ? "+" : "")\(Int(deltaPercent.rounded()))% vs. last month")
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(deltaPercent >= 0 ? .red : .green)
                    }
                }
            }

            if !spend.categories.isEmpty {
                Divider()
                LazyVGrid(columns: columns, alignment: .leading, spacing: 6) {
                    ForEach(spend.categories.prefix(6)) { category in
                        HStack(spacing: 3) {
                            Text(category.categoryName)
                                .foregroundStyle(.secondary)
                            Text(category.amount.currencyWhole(baseCurrency))
                                .foregroundStyle(.primary)
                        }
                        .font(.caption2.monospacedDigit())
                        .lineLimit(1)
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }
}
