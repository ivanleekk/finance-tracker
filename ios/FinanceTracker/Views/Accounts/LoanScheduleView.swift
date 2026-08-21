import SwiftUI

/// A property netted against the loan secured on it. Shown at the top of the
/// Accounts list, because "what do I actually own" is the number a mortgaged
/// household wants — not the gross valuation and not the gross debt.
struct EquityRow: View {
    let row: LinkedEquityRow
    let currency: String

    private var ownedFraction: Double {
        guard let percent = row.equityPercent, percent.isFinite else { return 0 }
        return min(max(percent / 100, 0), 1)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(row.assetAccountName)
                    .font(.body)
                Spacer()
                Text("\(row.equity.currencyWhole(currency)) equity")
                    .font(.body.monospacedDigit())
            }

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(.red.opacity(0.25))
                    Capsule()
                        .fill(.green)
                        .frame(width: geo.size.width * ownedFraction)
                }
            }
            .frame(height: 6)

            HStack {
                Text(row.assetValue.currencyWhole(currency))
                Spacer()
                Text(row.loanAccountName.map { "\(row.loanBalance.currencyWhole(currency)) on \($0)" }
                    ?? "No loan linked")
                Spacer()
                if let percent = row.equityPercent, percent.isFinite {
                    Text(String(format: "%.1f%% owned", percent))
                }
            }
            .font(.caption2.monospacedDigit())
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
}

/// The full amortization table for one loan: every payment split into interest
/// and principal, plus the payoff date.
///
/// Loaded on demand — a 30-year mortgage is 360 rows, which is not worth
/// fetching with the accounts list.
struct LoanScheduleView: View {
    @Environment(QuickAddStore.self) private var quickAdd

    let account: AccountResponse

    @State private var schedule: LoanScheduleResponse?
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        List {
            if let schedule {
                Section {
                    LabeledContent("Monthly payment") {
                        Text(schedule.monthlyPayment.currency(schedule.currency))
                            .monospacedDigit()
                    }
                    LabeledContent("Paid off") {
                        // nil means the payment never clears the balance — say
                        // so rather than showing a blank.
                        Text(schedule.payoffDate.map { $0.formatted(.dateTime.month(.abbreviated).year()) }
                            ?? "Never at this payment")
                            .monospacedDigit()
                    }
                    LabeledContent("Balance today") {
                        Text(schedule.currentBalance.currency(schedule.currency))
                            .monospacedDigit()
                    }
                    LabeledContent("Interest remaining") {
                        Text(schedule.remainingInterest.currency(schedule.currency))
                            .monospacedDigit()
                            .foregroundStyle(.red)
                    }
                    LabeledContent("Total interest") {
                        Text(schedule.totalInterest.currency(schedule.currency))
                            .monospacedDigit()
                    }
                }

                Section("Payments") {
                    ForEach(schedule.schedule) { row in
                        VStack(alignment: .leading, spacing: 3) {
                            HStack {
                                Text(row.date.formatted(.dateTime.month(.abbreviated).year()))
                                    .font(.subheadline)
                                Spacer()
                                Text(row.payment.currency(schedule.currency))
                                    .font(.subheadline.monospacedDigit())
                            }
                            HStack(spacing: 12) {
                                Label(
                                    row.interest.currency(schedule.currency),
                                    systemImage: "percent"
                                )
                                .foregroundStyle(.red)
                                Label(
                                    row.principal.currency(schedule.currency),
                                    systemImage: "arrow.down.right"
                                )
                                .foregroundStyle(.green)
                                Spacer()
                                Text(row.balance.currency(schedule.currency))
                                    .foregroundStyle(.secondary)
                            }
                            .font(.caption2.monospacedDigit())
                        }
                        .padding(.vertical, 2)
                    }
                }
            }
        }
        .navigationTitle("Payoff Schedule")
        .navigationBarTitleDisplayMode(.inline)
        .overlay {
            if isLoading {
                LoadingSkeleton()
            } else if let errorMessage {
                ContentUnavailableView(
                    "No Schedule",
                    systemImage: "calendar.badge.exclamationmark",
                    description: Text(errorMessage)
                )
            }
        }
        .quickAddPull(quickAdd, onReload: load)
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            schedule = try await APIClient.shared.get("/accounts/\(account.id)/loan-schedule")
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
