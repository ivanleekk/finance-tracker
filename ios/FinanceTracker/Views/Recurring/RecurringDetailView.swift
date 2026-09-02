import SwiftUI

/// One recurring rule: its schedule, what it has actually posted, and the
/// transactions it produced.
///
/// Tapping a rule used to open the edit form directly, which answered "how do I
/// change this" and nothing else. The question a rule actually raises is whether
/// it is still doing what you set it up to do — `next_due_date` says it is
/// scheduled, only the history says it has ever fired.
struct RecurringDetailView: View {
    @Environment(SessionStore.self) private var session
    @Environment(QuickAddStore.self) private var quickAdd
    @Environment(\.dismiss) private var dismiss

    let rule: RecurringTransactionResponse
    let category: CategoryResponse?
    let accountName: String?
    let accounts: [AccountResponse]
    let categories: [CategoryResponse]
    /// Reload the list behind us — the rule may have been paused, edited or deleted.
    let onChanged: () async -> Void

    @State private var history: [TransactionResponse] = []
    @State private var isLoading = true
    @State private var isEditing = false
    @State private var isDeleting = false
    @State private var pendingDelete = false
    @State private var errorMessage: String?

    private var currency: String {
        rule.currency ?? session.activeHousehold?.baseCurrency ?? "USD"
    }

    private var baseCurrency: String { session.activeHousehold?.baseCurrency ?? "USD" }

    private var isIncome: Bool { category?.type == .income }

    private var health: BudgetPresentation.RuleHealth {
        BudgetPresentation.health(of: rule)
    }

    var body: some View {
        List {
            Section {
                LabeledContent("Amount") {
                    Text((isIncome ? "+" : "−") + rule.amount.currencyWhole(currency))
                        .monospacedDigit()
                        .foregroundStyle(isIncome ? .green : .primary)
                }
                LabeledContent("Every") { Text(rule.frequency.label) }
                LabeledContent("Category") { Text(category?.name ?? "—") }
                LabeledContent("Account") { Text(accountName ?? "—") }
            } header: {
                Text("Schedule")
            } footer: {
                // The state the row's one-line label had to compress.
                switch health {
                case .ended:
                    Text("This rule is past its end date, so it won't post again. Delete it, or extend the end date to restart it.")
                case .overdue:
                    Text("Its next date has passed. Rules post overnight — use “Post due now” on the Recurring screen if you don't want to wait.")
                case .paused:
                    Text("Paused. It keeps everything it already posted and starts again when you resume it.")
                case .healthy:
                    Text("Posts automatically overnight.")
                }
            }

            if !rule.standingSplits.isEmpty {
                Section {
                    ForEach(rule.standingSplits) { split in
                        LabeledContent(split.counterpartyName) {
                            Text(split.amount.currencyWhole(currency)).monospacedDigit()
                        }
                    }
                    LabeledContent("Your share") {
                        Text(
                            (rule.amount - rule.standingSplits.reduce(0.0) { $0 + $1.amount })
                                .currencyWhole(currency)
                        )
                        .monospacedDigit()
                        .fontWeight(.semibold)
                    }
                } header: {
                    Text("Shared")
                } footer: {
                    Text("Claimed back on every occurrence. The full amount still leaves the account — only your share counts towards budgets.")
                }
            }

            Section("Track record") {
                LabeledContent(health == .ended ? "Ended" : "Next") {
                    Text(health == .ended
                         ? (rule.endDate?.shortDay ?? "—")
                         : rule.nextDueDate.shortDay)
                        .monospacedDigit()
                }
                LabeledContent("Started") {
                    Text(rule.startDate.shortDay).monospacedDigit()
                }
                LabeledContent("Posted") {
                    // "Never" rather than "0 times": one is a fact about the
                    // rule, the other reads like a broken counter.
                    Text(rule.timesPosted == 0 ? "Never" : "\(rule.timesPosted)×")
                        .monospacedDigit()
                }
                if rule.timesPosted > 0 {
                    LabeledContent("Total to date") {
                        Text(rule.totalPosted.currencyWhole(baseCurrency)).monospacedDigit()
                    }
                }
            }

            Section {
                if isLoading && history.isEmpty {
                    HStack { ProgressView(); Text("Loading…").foregroundStyle(.secondary) }
                } else if history.isEmpty {
                    Text(rule.timesPosted == 0
                         ? "Nothing posted yet. The first one lands on \(rule.nextDueDate.shortDay)."
                         : "The transactions this rule posted are no longer visible in this view mode.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(history) { txn in
                        HStack {
                            Text(txn.date.shortDay)
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                                .frame(width: 64, alignment: .leading)
                            Text(txn.description ?? category?.name ?? "—")
                                .lineLimit(1)
                            Spacer()
                            Text((isIncome ? "+" : "−") + txn.amount.currencyWhole(txn.currency ?? currency))
                                .font(.subheadline.monospacedDigit())
                                .foregroundStyle(isIncome ? .green : .primary)
                        }
                    }
                }
            } header: {
                Text("History")
            } footer: {
                if history.count >= Self.historyLimit {
                    Text("Showing the most recent \(Self.historyLimit).")
                }
            }

            Section {
                Button {
                    Task { await setActive(!rule.isActive) }
                } label: {
                    Label(rule.isActive ? "Pause" : "Resume",
                          systemImage: rule.isActive ? "pause" : "play")
                }
                Button(role: .destructive) {
                    pendingDelete = true
                } label: {
                    Label("Delete", systemImage: "trash")
                }
                // `.destructive` reddens the label but leaves the symbol on the
                // list's accent tint, so the row reads half-destructive.
                .tint(.red)
                .disabled(isDeleting)
            }

            if let errorMessage {
                Section {
                    Label(errorMessage, systemImage: "exclamationmark.triangle")
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }
        }
        .navigationTitle(rule.description ?? category?.name ?? "Recurring")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Edit") { isEditing = true }
            }
        }
        .sheet(isPresented: $isEditing) {
            RecurringFormView(
                accounts: accounts,
                categories: categories.filter { !$0.isSystem },
                existing: rule
            ) {
                await onChanged()
                // The rule handed to this screen is a value copy, so an edit
                // leaves it stale. Pop rather than show numbers that no longer
                // match what was just saved.
                dismiss()
            }
        }
        .alert("Delete this recurring transaction?", isPresented: $pendingDelete) {
            Button("Delete", role: .destructive) { Task { await delete() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Transactions it already posted stay in your history — only future occurrences stop.")
        }
        .quickAddPull(quickAdd, onReload: load)
        .task { await load() }
    }

    /// Enough to show a pattern without pulling years of a weekly rule's history
    /// onto a phone. The footer says so when it bites.
    private static let historyLimit = 50

    private func load() async {
        guard let household = session.activeHousehold else { return }
        isLoading = true
        defer { isLoading = false }
        // The rule's own postings, not the household's history filtered on the
        // client — that download is the whole reason the endpoint takes a filter.
        history = (try? await APIClient.shared.get(
            "/cashflow/transactions/household/\(household.id)"
            + "?recurring_transaction_id=\(rule.id)&limit=\(Self.historyLimit)"
        )) ?? []
    }

    private func setActive(_ isActive: Bool) async {
        do {
            let _: RecurringTransactionResponse = try await APIClient.shared.put(
                "/cashflow/recurring/\(rule.id)",
                body: RecurringTransactionUpdate(isActive: isActive)
            )
            await onChanged()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func delete() async {
        isDeleting = true
        defer { isDeleting = false }
        do {
            try await APIClient.shared.delete("/cashflow/recurring/\(rule.id)")
            await onChanged()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
