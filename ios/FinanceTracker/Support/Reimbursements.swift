import Foundation

/// Splitting a bill, and reading back who owes whom.
///
/// The rule that matters: the amount on a transaction is the whole sum that left
/// the account, because that is what happened. Splitting it does not shrink it —
/// it records how much of it was somebody else's, so the budget charges you for
/// your share while the bank still shows the full payment.
///
/// A port of `frontend/src/lib/reimbursements.ts` and
/// `android/.../logic/Reimbursements.kt`; keep the three in step.
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
    /// What a proposed split works out to.
    ///
    /// Owing more than the bill is rejected rather than clamped: it is a typo,
    /// and silently correcting it would hide the mistake behind a plausible
    /// number.
    static func assessSplit(amount: Double?, owed: Double?) -> SplitAssessment {
        guard let amount, let owed, amount.isFinite, owed.isFinite else { return .incomplete }
        guard owed > 0, amount > 0 else { return .incomplete }
        guard owed <= amount else {
            return .invalid(reason: "They can't owe more than the bill.")
        }
        return .valid(yourShare: amount - owed, owed: owed)
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

    /// Whether a category belongs in a "where did my money go" breakdown.
    ///
    /// Paying someone back is cash leaving an account, so it is an expense row
    /// and shows up in the activity list — but it is not spending. The spending
    /// was charged when the bill was paid, and letting a repayment into the
    /// breakdown charges the same dinner twice, in the one view whose whole job
    /// is to say what you spent money on.
    static func countsAsSpending(_ categoryName: String?) -> Bool {
        categoryName != reimbursementCategoryName
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
