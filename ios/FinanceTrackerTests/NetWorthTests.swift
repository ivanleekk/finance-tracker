import Foundation
import Testing
@testable import FinanceTracker

/// `Support/NetWorth.swift` backs the Dashboard's net worth total and its Net
/// Worth Split donut, so a mistake here misstates money on the first screen a
/// user sees. Mirrors `frontend/src/lib/networth.test.ts`.
struct NetWorthTests {

    // MARK: Fixtures

    private static let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }()

    private func day(_ year: Int, _ month: Int, _ day: Int) -> Date {
        Self.utc.date(from: DateComponents(year: year, month: month, day: day))!
    }

    private func balance(_ amount: Double, home: Double? = nil, date: Date? = nil) -> BalanceResponse {
        BalanceResponse(
            id: UUID().uuidString,
            accountId: "a",
            date: date ?? day(2026, 1, 1),
            balance: amount,
            balanceHomeCurrency: home ?? amount,
            isManual: true
        )
    }

    private func account(
        kind: String? = "asset",
        liquidity: LiquidityStatus = .liquid,
        history: [BalanceResponse] = []
    ) -> NetWorthAccountInput {
        NetWorthAccountInput(kind: kind, liquidity: liquidity, history: history)
    }

    // MARK: latestBalanceHome

    @Test func latestBalanceHomePicksTheNewestCheckpoint() {
        let value = latestBalanceHome([
            balance(100, date: day(2026, 1, 1)),
            balance(900, date: day(2026, 6, 1)),
            balance(500, date: day(2026, 3, 1)),
        ])
        #expect(value == 900)
    }

    @Test func latestBalanceHomeReturnsZeroForEmptyHistory() {
        #expect(latestBalanceHome([]) == 0)
    }

    // MARK: summarizeAccounts

    @Test func summarizeAccountsCountsPropertyAlongsideTheLoanAgainstIt() {
        let home = account(liquidity: .illiquid, history: [balance(500_000)])
        let mortgage = account(kind: "liability", history: [balance(400_000)])
        let savings = account(history: [balance(10_000)])

        let totals = summarizeAccounts([home, mortgage, savings])
        #expect(totals.totalAssets == 510_000)
        #expect(totals.liabilities == 400_000)
        #expect(totals.net == 110_000)
    }

    @Test func summarizeAccountsKeepsPropertyOutOfLiquidNow() {
        let home = account(liquidity: .illiquid, history: [balance(500_000)])
        let savings = account(history: [balance(10_000)])

        let totals = summarizeAccounts([home, savings])
        #expect(totals.property == 500_000)
        #expect(totals.liquidNow == 10_000)
    }

    @Test func summarizeAccountsGroupsTimeLockedAndRetirementTogether() {
        let cpf = account(liquidity: .timeLocked, history: [balance(30_000)])
        let srs = account(liquidity: .retirement, history: [balance(20_000)])
        #expect(summarizeAccounts([cpf, srs]).retirement == 50_000)
    }

    // MARK: netWorthBreakdown

    @Test func bucketsCashRetirementAndPropertyAndAddsInvestmentsAsTheirOwnSlice() {
        let savings = account(history: [balance(10_000)])
        let cpf = account(liquidity: .timeLocked, history: [balance(30_000)])
        let home = account(liquidity: .illiquid, history: [balance(500_000)])

        let breakdown = netWorthBreakdown(accounts: [savings, cpf, home], portfolioValue: 20_000)

        #expect(breakdown.slices.map(\.key) == ["cash", "investments", "retirement", "property"])
        #expect(breakdown.slices.map(\.value) == [10_000, 20_000, 30_000, 500_000])
        #expect(breakdown.sliceTotal == 560_000)
    }

    @Test func reportsLiabilitiesAlongsideTheSlicesRatherThanAsANegativeWedge() {
        let mortgage = account(kind: "liability", history: [balance(400_000)])
        let home = account(liquidity: .illiquid, history: [balance(500_000)])

        let breakdown = netWorthBreakdown(accounts: [mortgage, home], portfolioValue: 0)

        #expect(breakdown.liabilities == 400_000)
        #expect(breakdown.slices.contains { $0.key == "liabilities" } == false)
    }

    @Test func dropsANegativeBucketInsteadOfAnImpossibleNegativeWedge() {
        let overdrawn = account(history: [balance(-12_000)])
        let home = account(liquidity: .illiquid, history: [balance(500_000)])

        let breakdown = netWorthBreakdown(accounts: [overdrawn, home], portfolioValue: 0)

        #expect(breakdown.slices.map(\.key) == ["property"])
        // sliceTotal is the denominator for each slice's %, so it must match the
        // visible slices — not gross assets, which the excluded negative cash
        // bucket would otherwise drag below the property total.
        #expect(breakdown.sliceTotal == 500_000)
    }

    @Test func bucketsAMarketLiquidAccountAsOtherRatherThanDroppingIt() {
        let brokerageCash = account(liquidity: .marketLiquid, history: [balance(5_000)])
        let breakdown = netWorthBreakdown(accounts: [brokerageCash], portfolioValue: 0)
        #expect(breakdown.slices.map(\.key) == ["other"])
        #expect(breakdown.slices.map(\.value) == [5_000])
    }
}
