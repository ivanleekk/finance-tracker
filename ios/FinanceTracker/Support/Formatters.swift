import Foundation

extension Double {
    /// "S$12,345.67" style currency string using the given ISO code.
    func currency(_ code: String) -> String {
        formatted(.currency(code: code).precision(.fractionLength(2)))
    }

    /// Compact currency for dashboards: "S$12.3K".
    /// (.currency's .notation is iOS 18+, so compose symbol + compact number for iOS 17.)
    func compactCurrency(_ code: String) -> String {
        Self.symbol(for: code) + formatted(.number.notation(.compactName).precision(.fractionLength(0...1)))
    }

    private static var symbolCache: [String: String] = [:]

    private static func symbol(for code: String) -> String {
        if let cached = symbolCache[code] { return cached }
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = code
        let symbol = formatter.currencySymbol ?? code
        symbolCache[code] = symbol
        return symbol
    }

    /// "+4.2%" with sign, from a fraction (0.042).
    var signedPercent: String {
        formatted(.percent.sign(strategy: .always()).precision(.fractionLength(1...2)))
    }
}

extension Date {
    var shortDay: String {
        formatted(.dateTime.day().month(.abbreviated))
    }

    var monthYear: String {
        formatted(.dateTime.month(.wide).year())
    }

    /// "yyyy-MM-dd" in UTC, for backend `date`-typed fields. Pydantic's `date`
    /// rejects a datetime with a non-zero time, and DatePicker carries the current
    /// time-of-day — so date-only bodies must send a bare date string. UTC matches
    /// how DateParser reads date-only values back, so seeded dates round-trip.
    var apiDateOnly: String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: self)
    }
}
