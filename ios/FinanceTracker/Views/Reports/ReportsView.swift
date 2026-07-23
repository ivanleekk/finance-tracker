import SwiftUI
import UIKit

/// Household financial report: net worth, portfolio, cash flow, dividends, goals —
/// the mobile counterpart of the web /reports page (GET /exports/household/{id}/report).
/// Also exports the denormalized CSV bundle (GET .../csv) via the share sheet.
/// Pushed from the More tab, so it uses the caller's NavigationStack.
struct ReportsView: View {
    @Environment(SessionStore.self) private var session

    @State private var report: HouseholdReportResponse?
    @State private var isLoading = true
    @State private var isExporting = false
    @State private var exportFile: ExportFile?
    @State private var errorMessage: String?

    private var baseCurrency: String {
        report?.baseCurrency ?? session.activeHousehold?.baseCurrency ?? "USD"
    }

    private func periodText(_ report: HouseholdReportResponse) -> String {
        let start = report.periodStart.formatted(date: .abbreviated, time: .omitted)
        let end = report.periodEnd.formatted(date: .abbreviated, time: .omitted)
        return "\(start) – \(end)"
    }

    var body: some View {
        List {
            if let report {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Net Worth")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Text(report.netWorth.currency(baseCurrency))
                            .font(.system(.title, design: .rounded, weight: .bold))
                    }
                    .padding(.vertical, 2)
                    LabeledContent("Assets", value: report.totalAssets.currency(baseCurrency))
                    LabeledContent("Liabilities", value: report.totalLiabilities.currency(baseCurrency))
                } footer: {
                    Text("As of the latest recorded balances.")
                }

                Section("Portfolio") {
                    LabeledContent("Value", value: report.portfolioValue.currency(baseCurrency))
                    LabeledContent("Cost Basis", value: report.portfolioCostBasis.currency(baseCurrency))
                    gainRow("Unrealized Gain", report.portfolioUnrealizedGain)
                }

                Section {
                    LabeledContent("Income", value: report.incomeTotal.currency(baseCurrency))
                    LabeledContent("Expenses", value: report.expenseTotal.currency(baseCurrency))
                    gainRow("Net Cash Flow", report.netCashflow)
                    ForEach(report.cashflowByCategory) { flow in
                        HStack {
                            Text(flow.category)
                            Text("(\(flow.transactionCount))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Spacer()
                            Text((flow.type == .income ? "+" : "−") + flow.totalHomeCurrency.currency(baseCurrency))
                                .font(.body.monospacedDigit())
                                .foregroundStyle(flow.type == .income ? .green : .primary)
                        }
                    }
                } header: {
                    Text("Cash Flow")
                } footer: {
                    Text(periodText(report))
                }

                Section("Dividends") {
                    LabeledContent("This Period", value: report.dividendsPeriodTotal.currency(baseCurrency))
                    LabeledContent("All Time", value: report.dividendsAllTimeTotal.currency(baseCurrency))
                }

                if !report.goals.isEmpty {
                    Section("Goals") {
                        ForEach(report.goals) { goal in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text(goal.name)
                                        .font(.subheadline.weight(.medium))
                                    if goal.isPrivate {
                                        Image(systemName: "lock.fill")
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Text(goal.currentValueHomeCurrency.currency(baseCurrency))
                                        .font(.subheadline.monospacedDigit())
                                }
                                if goal.targetAmount != nil {
                                    GoalProgressRow(
                                        currentValue: goal.currentValueHomeCurrency,
                                        targetAmount: goal.targetAmount,
                                        targetDate: goal.targetDate,
                                        accent: session.theme.primary.accent,
                                        baseCurrency: baseCurrency
                                    )
                                }
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }

                Section {
                    Button {
                        export()
                    } label: {
                        HStack {
                            Label("Export CSV (ZIP)", systemImage: "square.and.arrow.up")
                            Spacer()
                            if isExporting { ProgressView() }
                        }
                    }
                    .disabled(isExporting)
                } footer: {
                    Text("Downloads a ZIP of accounts, transactions, trades, holdings, goals and more as CSV.")
                }
            }
        }
        .navigationTitle("Reports")
        .navigationBarTitleDisplayMode(.inline)
        .overlay {
            if isLoading && report == nil {
                ProgressView()
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .sheet(item: $exportFile) { file in
            ShareSheet(items: [file.url])
        }
        .alert("Error", isPresented: .init(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    @ViewBuilder
    private func gainRow(_ title: String, _ value: Double) -> some View {
        LabeledContent(title) {
            Text((value >= 0 ? "+" : "") + value.currency(baseCurrency))
                .foregroundStyle(value >= 0 ? .green : .red)
                .monospacedDigit()
        }
    }

    private func load() async {
        guard let household = session.activeHousehold else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            report = try await APIClient.shared.get("/exports/household/\(household.id)/report")
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func export() {
        guard let household = session.activeHousehold else { return }
        isExporting = true
        Task {
            defer { isExporting = false }
            do {
                let data = try await APIClient.shared.getData("/exports/household/\(household.id)/csv")
                let name = "finance-tracker-\(household.name.replacingOccurrences(of: " ", with: "-")).zip"
                let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
                try data.write(to: url, options: .atomic)
                exportFile = ExportFile(url: url)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

/// A file ready to be shared (wrapper so `.sheet(item:)` can drive the share sheet).
private struct ExportFile: Identifiable {
    let id = UUID()
    let url: URL
}

/// Bridges UIKit's share sheet into SwiftUI.
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
