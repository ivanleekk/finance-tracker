import SwiftUI

// The Dashboard's small list rows and figures: one account, one transaction, a
// breakdown cell, and the runway summary.

/// One account in a list — the Accounts tab and the Dashboard's preview both use it.
///
/// **Liabilities are shown as what they are: money owed.** The balance of a loan is stored
/// as a positive number, and rendering that as-is put `HDB Mortgage  $440,000.00` in the same
/// ink, sign and weight as real cash — while net worth quietly subtracted it. A household
/// with two loans read as if it had three-quarters of a million liquid. The figure is negated
/// and tinted red, and the caption says "Owed", matching what the web Accounts page has always
/// done (`isLiability ? -balanceHome : balanceHome`, in red, under its own "Loans &
/// liabilities" group).
struct AccountRow: View {
    let account: AccountResponse
    let latestBalance: BalanceResponse?
    /// The household's reporting currency, so the caption can name the account's own currency
    /// only when it differs. The amount is rendered in `account.currency` either way, and two
    /// accounts in different currencies otherwise render the same "$" with nothing to tell
    /// them apart.
    var baseCurrency: String?
    /// Whether to name the liquidity bucket. False on the Accounts tab, where the row already
    /// sits under a section header saying exactly that — the caption read "Liquid" under a
    /// "Liquid" header on every row, spending the only secondary line the row has on a word
    /// the reader just read.
    var showsLiquidity: Bool = true

    private var amount: Double {
        let balance = latestBalance?.balance ?? 0
        return account.isLiability ? -balance : balance
    }

    /// "Owed · USD", "Retirement", "Property · JPY" — whichever parts carry information here.
    private var caption: String {
        var parts: [String] = []
        if account.isLiability { parts.append("Owed") }
        if showsLiquidity { parts.append(account.liquidity.label) }
        if let baseCurrency, account.currency != baseCurrency { parts.append(account.currency) }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(account.name)
                        .font(.body)
                    if account.ownerUserId != nil {
                        Image(systemName: "lock.fill")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                if !caption.isEmpty {
                    Text(caption)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            Text(amount.currency(account.currency))
                .font(.body.monospacedDigit())
                .foregroundStyle(account.isLiability ? Color.red : .primary)
        }
    }
}

struct TransactionRow: View {
    let transaction: TransactionResponse
    let categoryName: String?
    let accountName: String?
    let baseCurrency: String

    private var isIncome: Bool { transaction.transactionType == .income }

    var body: some View {
        HStack {
            Image(systemName: transaction.transferId != nil
                  ? "arrow.left.arrow.right"
                  : (isIncome ? "arrow.down.circle.fill" : "arrow.up.circle.fill"))
                .foregroundStyle(transaction.transferId != nil ? .secondary : (isIncome ? Color.green : Color.red))
                .font(.title3)
            VStack(alignment: .leading, spacing: 2) {
                Text(transaction.description?.isEmpty == false
                     ? transaction.description!
                     : (categoryName ?? "Transaction"))
                Text([categoryName, accountName, transaction.date.shortDay]
                    .compactMap(\.self).joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                // The amount on the right stays the full sum, because that is
                // what left the account. This says how much of it wasn't yours,
                // which is otherwise invisible on a list of full amounts.
                if !transaction.splits.isEmpty {
                    let currency = transaction.currency ?? baseCurrency
                    let owed = transaction.splits.reduce(0.0) { $0 + $1.amount }
                    if transaction.splits.count == 1, let only = transaction.splits.first {
                        Text("\(owed.currency(currency)) owed by \(only.counterpartyName)")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    } else {
                        let names = transaction.splits.map(\.counterpartyName).joined(separator: ", ")
                        Text("\(owed.currency(currency)) split with \(names)")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                }
            }
            Spacer()
            Text((isIncome ? "+" : "−") + transaction.amount.currency(transaction.currency ?? baseCurrency))
                .font(.body.monospacedDigit())
                .foregroundStyle(isIncome ? .green : .primary)
        }
    }
}

/// Small labelled figure with a colour swatch matching its chart band.
struct BreakdownCell: View {
    let title: String
    let value: Double
    let color: Color
    let currency: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 5) {
                Circle()
                    .fill(color)
                    .frame(width: 7, height: 7)
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(value.currency(currency))
                .font(.subheadline.monospacedDigit().weight(.semibold))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Compact runway readout for the Dashboard, linking through to Budgets.
struct RunwaySummaryRow: View {
    let fund: EmergencyFundResponse
    let currency: String

    private var tint: Color {
        switch BudgetPresentation.runwayTone(fund) {
        case .critical: return .red
        case .low: return .orange
        case .ok: return .green
        case .unknown: return .secondary
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("Emergency fund runway")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(BudgetPresentation.runwayLabel(fund))
                .font(.title3.bold())
                .foregroundStyle(tint)
            if fund.monthsCovered == nil {
                Text("Log some expenses to measure your burn rate.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            } else {
                Text("\(fund.liquidTotal.currencyWhole(currency)) liquid against \(fund.averageMonthlyExpenses.currencyWhole(currency))/month")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}
