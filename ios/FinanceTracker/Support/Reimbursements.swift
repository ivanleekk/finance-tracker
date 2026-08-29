import Foundation

/// Splitting a bill among one or more named people, and reading back who owes whom.
///
/// The rule that matters: the amount on a transaction is the whole sum that left
/// the account, because that is what happened. Splitting it does not shrink it —
/// it records how much of it was somebody else's, so the budget charges you for
/// your share while the bank still shows the full payment.
///
/// A port of `frontend/src/lib/reimbursements.ts` and
/// `android/.../logic/Reimbursements.kt`; keep the three in step.

/// One person's share of a bill being split — a counterparty id and an amount.
struct SplitEntry: Equatable {
    var counterpartyId: String
    var amount: Double?
}

enum SplitAssessment: Equatable {
    /// Not enough entered yet to say anything.
    case incomplete
    /// Entered, but it cannot mean what it says.
    case invalid(reason: String)
    case valid(yourShare: Double, owed: Double)
}

extension SplitAssessment {
    var isInvalid: Bool {
        if case .invalid = self { return true }
        return false
    }
}

enum Reimbursements {
    /// What a proposed split works out to, across everyone in it.
    ///
    /// `owed` is the sum of every entry's amount. Owing more than the bill in
    /// total is rejected rather than clamped: it is a typo, and silently
    /// correcting it would hide the mistake behind a plausible number. The same
    /// rejection covers a single entry with no amount yet — a half-filled row is
    /// not a valid split.
    static func assessSplit(amount: Double?, entries: [SplitEntry]) -> SplitAssessment {
        guard let amount, amount.isFinite, amount > 0 else { return .incomplete }
        guard !entries.isEmpty else { return .incomplete }
        let hasIncompleteEntry = entries.contains { entry in
            guard let value = entry.amount, value.isFinite, value > 0 else { return true }
            return false
        }
        if hasIncompleteEntry { return .incomplete }
        let ids = entries.map(\.counterpartyId)
        if Set(ids).count != ids.count {
            return .invalid(reason: "The same person can't appear twice in one split.")
        }
        let owed = entries.reduce(0.0) { $0 + ($1.amount ?? 0) }
        guard owed <= amount else {
            return .invalid(reason: "They can't owe more than the bill, combined.")
        }
        return .valid(yourShare: amount - owed, owed: owed)
    }

    /// Given a bill amount, the amounts already typed for some people, and how
    /// many people are left to fill in, divide what's left evenly across the
    /// rest. Mirrors cashshare's `/add` semantics: specify some people's shares
    /// by hand, and everyone else splits the remainder equally.
    static func evenSplitRemainder(amount: Double, specified: [Double], remainingCount: Int) -> Double? {
        guard remainingCount > 0 else { return nil }
        let specifiedTotal = specified.reduce(0, +)
        let remainder = amount - specifiedTotal
        guard remainder > 0 else { return nil }
        return remainder / Double(remainingCount)
    }

    /// Parses a form field that may be blank or nonsense.
    static func parseMoney(_ raw: String) -> Double? {
        let trimmed = raw.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: "")
        guard !trimmed.isEmpty, let value = Double(trimmed), value.isFinite else { return nil }
        return value
    }

    /// The system category settling up is filed under. Matched by name, the same
    /// way the backend's `SYSTEM_CATEGORY_NAMES` exclusion is, because that is
    /// how the find-or-create sites identify it.
    static let reimbursementCategoryName = "Reimbursement"

    /// Whether a row belongs in a "where did my money go" breakdown.
    ///
    /// Two kinds of expense row are cash leaving an account without being
    /// spending, and both reach the activity list correctly — the money really
    /// did move — while neither belongs in the breakdown:
    ///
    /// - A **transfer** between your own accounts. You still have the money.
    ///   This is the same rule the budget and runway rollups apply server-side,
    ///   and the same one `HistoryGroups` applies to section totals; the
    ///   breakdown was the one place left out, so a big transfer could top it.
    /// - A **settlement**. The spending was charged when the bill was paid, so
    ///   counting the repayment charges the same dinner twice.
    ///
    /// Both are identified the way the rest of the app identifies them: a
    /// transfer by carrying a transfer id, a settlement by its system category.
    static func countsAsSpending(_ categoryName: String?, isTransfer: Bool) -> Bool {
        if isTransfer { return false }
        return categoryName != reimbursementCategoryName
    }

    /// Totals across everyone, for a summary line.
    ///
    /// The two directions are deliberately not netted. Someone can owe you for
    /// last night and be owed for last week; collapsing that to one number loses
    /// the fact that there are two things to settle.
    static func totals(_ balances: [CounterpartyBalanceResponse]) -> (owedToYou: Double, youOwe: Double) {
        var owedToYou = 0.0
        var youOwe = 0.0
        for row in balances {
            switch row.direction {
            case .owedToYou: owedToYou += row.amount
            case .youOwe: youOwe += row.amount
            }
        }
        return (owedToYou, youOwe)
    }
}
