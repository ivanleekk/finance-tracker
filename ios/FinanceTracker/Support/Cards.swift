import Foundation

/// Swift port of the web's `frontend/src/lib/cards.ts` — keep the two in sync.
///
/// The bar width and the pace marker are deliberately *not* here:
/// `CardLimitStatusRow` has the same `percentUsed` / `daysElapsed` / `daysTotal`
/// shape as a budget row, so `BudgetPresentation.barFraction` and
/// `.elapsedFraction` already read it. What is card-specific is the direction —
/// whether the number is a cap to stay under or a minimum to reach — and that
/// changes both the tone and the wording.

enum CardLimitTone: String {
    case over
    case atRisk
    case ok
}

/// One row of the limit "Resets" picker.
struct ResetOption: Hashable {
    let basis: LimitResetBasis
    let label: String
    /// False for the anniversary resets until the card has a date. The picker
    /// leaves those out (a menu row can't reliably be disabled) and shows the hint.
    let isAvailable: Bool
}

enum Cards {

    /// How a limit should read right now.
    ///
    /// A ceiling and a floor invert: reaching the number is the failure for a
    /// cap and the goal for a minimum, so `settled` means opposite things and
    /// only a ceiling can ever be `.over`. Both share `.atRisk`, which is the
    /// state worth showing — a warning after the cycle closes is useless.
    static func tone(for row: CardLimitStatusRow) -> CardLimitTone {
        if row.direction == .floor {
            return row.settled ? .ok : (row.projectedMissed ? .atRisk : .ok)
        }
        if row.settled { return .over }
        return row.projectedMissed ? .atRisk : .ok
    }

    /// The short status a person actually reads, e.g. "$240 left" or "$120 to go".
    ///
    /// This is the string that goes in the category picker at entry, which is
    /// the one moment the number can still change a decision.
    static func headroomLabel(
        for row: CardLimitStatusRow,
        formatAmount: (Double) -> String
    ) -> String {
        if row.direction == .floor {
            return row.settled ? "Minimum met" : "\(formatAmount(row.remaining)) to go"
        }
        return row.settled ? "Cap reached" : "\(formatAmount(row.remaining)) left"
    }

    /// The cycle window, worded for a header: "19 Aug – 18 Sep".
    ///
    /// A window crossing into another year says which years, or a card year
    /// reads "14 Sep – 13 Sep" — a window of either one day or one year.
    static func cycleLabel(start: Date, end: Date, locale: Locale = .current) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        let calendar = Calendar.current
        let crossesYear = calendar.component(.year, from: start) != calendar.component(.year, from: end)
        formatter.setLocalizedDateFormatFromTemplate(crossesYear ? "d MMM y" : "d MMM")
        return "\(formatter.string(from: start)) – \(formatter.string(from: end))"
    }

    /// A limit's own window, worded like the card's cycle — or nil when it is
    /// the card's cycle.
    ///
    /// The card header shows the statement cycle, which is right for most limits
    /// and wrong for the rest: a monthly minimum and an annual cap on the same
    /// category sit side by side, and reading both against the cycle makes the
    /// annual one look wildly over pace. Only the ones that differ are labelled.
    static func limitWindowLabel(
        for row: CardLimitStatusRow,
        status: CardStatusResponse,
        locale: Locale = .current
    ) -> String? {
        if row.periodStart == status.cycleStart && row.periodEnd == status.cycleEnd { return nil }
        return cycleLabel(start: row.periodStart, end: row.periodEnd, locale: locale)
    }

    /// Every limit each of a card's categories counts towards, keyed by category id.
    ///
    /// The status endpoint reports limits, but the picker is a list of
    /// *categories* — so this fans each limit back out over the categories
    /// counting towards it. A category can count towards several, so each gets a
    /// list in the status payload's order, which is most urgent first. A category
    /// with no limit gets no entry rather than an empty list, because
    /// "unmetered" and "nothing left" must not look the same.
    static func headroomByCategory(status: CardStatusResponse) -> [String: [CardLimitStatusRow]] {
        var out: [String: [CardLimitStatusRow]] = [:]
        for row in status.limits {
            for categoryId in row.categoryIds {
                out[categoryId, default: []].append(row)
            }
        }
        return out
    }

    /// Whether any limit counts this category. Read from the card's limits rather
    /// than the status, so Manage can say "unmetered" without a status fetch.
    static func isMetered(categoryId: String, limits: [CardLimitResponse]) -> Bool {
        limits.contains { $0.categoryIds.contains(categoryId) }
    }

    /// A card category's picker label: its name, then every limit it counts
    /// towards — "Dining · $300 to go · $11,000 left".
    static func pickerLabel(
        for category: CardCategoryResponse,
        headroom: [String: [CardLimitStatusRow]],
        formatAmount: (Double) -> String
    ) -> String {
        ([category.name] + (headroom[category.id] ?? []).map { headroomLabel(for: $0, formatAmount: formatAmount) })
            .joined(separator: " · ")
    }

    /// The card behind an account, with this cycle's headroom — or nil, which is
    /// the ordinary answer for an account that is not a card rather than an error.
    ///
    /// Shared by the transaction form and Quick Add so the two cannot drift into
    /// saying different things about the same card. Fetched on demand at both
    /// call sites, because most accounts are not cards and most households have
    /// none.
    static func load(
        householdId: String,
        accountId: String
    ) async -> (card: CardResponse, headroom: [String: [CardLimitStatusRow]])? {
        do {
            let cards: [CardResponse] = try await APIClient.shared.get("/cards/household/\(householdId)")
            guard let card = cards.first(where: { $0.financialAccountId == accountId }) else { return nil }
            // A missing meter makes the picker plainer, never the form unusable,
            // so the status is allowed to fail on its own.
            let status: CardStatusResponse? = try? await APIClient.shared.get("/cards/\(card.id)/status")
            return (card, status.map { headroomByCategory(status: $0) } ?? [:])
        } catch {
            return nil
        }
    }

    /// A limit with no categories pointing at it measures nothing.
    ///
    /// A setup mistake rather than a state worth rendering as a meter: the user
    /// made a cap and never said what counts towards it. Left alone it draws a
    /// perfectly plausible "0 of $1,000" bar and reads as "nothing spent yet",
    /// which is the one thing it must not be mistaken for.
    static func measuresNothing(_ row: CardLimitStatusRow) -> Bool {
        row.categoryNames.isEmpty
    }

    /// The limits worth interrupting someone about — burst, or on pace to be.
    ///
    /// Used for the Dashboard's exception row, which shows nothing at all when
    /// everything is fine.
    static func needingAttention(_ rows: [CardLimitStatusRow]) -> [CardLimitStatusRow] {
        rows.filter { tone(for: $0) != .ok }
    }

    static let anniversaryHint = "Set the card's anniversary first — under Edit card — to reset on the card year or card quarter."

    static func resetOptions(hasAnniversary: Bool) -> [ResetOption] {
        [
            ResetOption(basis: .cycle, label: "Each statement cycle", isAvailable: true),
            ResetOption(basis: .calendarMonth, label: "Each calendar month", isAvailable: true),
            ResetOption(basis: .quarter, label: "Each quarter", isAvailable: true),
            ResetOption(basis: .year, label: "Each year", isAvailable: true),
            ResetOption(basis: .cardYear, label: "Each card year", isAvailable: hasAnniversary),
            ResetOption(basis: .cardQuarter, label: "Each card quarter", isAvailable: hasAnniversary),
        ]
    }
}
