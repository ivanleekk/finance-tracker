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
    static func cycleLabel(start: Date, end: Date, locale: Locale = .current) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.setLocalizedDateFormatFromTemplate("d MMM")
        return "\(formatter.string(from: start)) – \(formatter.string(from: end))"
    }

    /// Headroom for each of a card's categories, keyed by category id.
    ///
    /// The status endpoint reports limits, but the picker is a list of
    /// *categories* — and several categories can share one limit, so this fans
    /// the limit back out over the categories pointing at it. A category with no
    /// limit gets no entry rather than a zero, because "unmetered" and "nothing
    /// left" must not look the same.
    static func headroomByCategory(
        card: CardResponse,
        status: CardStatusResponse
    ) -> [String: CardLimitStatusRow] {
        let byLimit = Dictionary(
            status.limits.map { ($0.limitId, $0) },
            uniquingKeysWith: { first, _ in first }
        )
        var out: [String: CardLimitStatusRow] = [:]
        for category in card.categories {
            // An unmetered category has no limit id, which matches nothing here
            // and is skipped by the same lookup that skips a limit missing from
            // the payload — no separate guard needed.
            if let limitId = category.limitId, let row = byLimit[limitId] {
                out[category.id] = row
            }
        }
        return out
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
    ) async -> (card: CardResponse, headroom: [String: CardLimitStatusRow])? {
        do {
            let cards: [CardResponse] = try await APIClient.shared.get("/cards/household/\(householdId)")
            guard let card = cards.first(where: { $0.financialAccountId == accountId }) else { return nil }
            // A missing meter makes the picker plainer, never the form unusable,
            // so the status is allowed to fail on its own.
            let status: CardStatusResponse? = try? await APIClient.shared.get("/cards/\(card.id)/status")
            return (card, status.map { headroomByCategory(card: card, status: $0) } ?? [:])
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
}
