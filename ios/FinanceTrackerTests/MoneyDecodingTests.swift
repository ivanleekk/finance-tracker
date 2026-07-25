import Foundation
import Testing
@testable import FinanceTracker

/// The backend (Pydantic) serialises `Decimal` fields as JSON *strings* ("5000.00") but
/// `float` fields as numbers. `@MoneyAmount` / `@OptionalMoneyAmount` must accept either,
/// or every Decimal-backed money field silently fails to decode. These wrappers are the
/// single most load-bearing decoding detail in the app, so they get direct coverage.
struct MoneyDecodingTests {

    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    private struct Holder: Codable {
        @MoneyAmount var amount: Double
    }
    private struct OptionalHolder: Codable {
        @OptionalMoneyAmount var amount: Double?
    }

    // MARK: MoneyAmount

    @Test func decodesNumericString() throws {
        let json = #"{"amount":"5000.00"}"#.data(using: .utf8)!
        let holder = try decoder.decode(Holder.self, from: json)
        #expect(abs(holder.amount - 5_000) < 0.0001)
    }

    @Test func decodesRawNumber() throws {
        let json = #"{"amount":1234.56}"#.data(using: .utf8)!
        let holder = try decoder.decode(Holder.self, from: json)
        #expect(abs(holder.amount - 1234.56) < 0.0001)
    }

    @Test func decodesNegativeString() throws {
        let json = #"{"amount":"-42.5"}"#.data(using: .utf8)!
        let holder = try decoder.decode(Holder.self, from: json)
        #expect(abs(holder.amount - -42.5) < 0.0001)
    }

    @Test func throwsOnNonNumericString() {
        let json = #"{"amount":"not-a-number"}"#.data(using: .utf8)!
        #expect(throws: (any Error).self) {
            _ = try decoder.decode(Holder.self, from: json)
        }
    }

    @Test func roundTripsThroughEncoderAsNumber() throws {
        let holder = Holder(amount: 99.9)
        let data = try encoder.encode(holder)
        let text = String(data: data, encoding: .utf8)!
        // Encoded as a bare number (not a string) so the backend accepts it too.
        #expect(text.contains("99.9"))
        #expect(!text.contains("\"99.9\""))
    }

    // MARK: OptionalMoneyAmount

    @Test func optionalDecodesExplicitNull() throws {
        let json = #"{"amount":null}"#.data(using: .utf8)!
        let holder = try decoder.decode(OptionalHolder.self, from: json)
        #expect(holder.amount == nil)
    }

    @Test func optionalDecodesMissingKeyAsNil() throws {
        // The KeyedDecodingContainer overload treats a missing key like an explicit null.
        let json = #"{}"#.data(using: .utf8)!
        let holder = try decoder.decode(OptionalHolder.self, from: json)
        #expect(holder.amount == nil)
    }

    @Test func optionalDecodesNumericString() throws {
        let json = #"{"amount":"250.75"}"#.data(using: .utf8)!
        let holder = try decoder.decode(OptionalHolder.self, from: json)
        #expect(abs((holder.amount ?? 0) - 250.75) < 0.0001)
    }

    @Test func optionalDecodesRawNumber() throws {
        let json = #"{"amount":10}"#.data(using: .utf8)!
        let holder = try decoder.decode(OptionalHolder.self, from: json)
        #expect(holder.amount == 10)
    }
}
