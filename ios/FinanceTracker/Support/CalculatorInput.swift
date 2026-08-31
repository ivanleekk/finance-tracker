import Foundation

/// Parses and evaluates a short arithmetic expression typed into an amount field — e.g.
/// "42.50/3" or "85+12.75" — so `CalculatorField`'s +/−/×/÷ buttons produce a real value.
///
/// Falls back to a plain number when there's no operator, which makes this a strict superset
/// of the old `Double(text.replacingOccurrences(of: ",", with: ""))` parse: every call site
/// that used to parse a plain number keeps working unchanged. No parentheses — the numeric
/// keyboards never expose `(` `)` and the calculator buttons never insert them.
///
/// Android's `logic/CalculatorInput.kt` mirrors this token-for-token; keep them in sync.
enum CalculatorInput {
    enum Operator: Character {
        case add = "+"
        case subtract = "-"
        case multiply = "*"
        case divide = "/"
    }

    /// Evaluates `raw` and returns the result, or nil if it isn't a valid number/expression.
    static func evaluateArithmeticExpression(_ raw: String) -> Double? {
        let normalized = normalize(raw)
        guard !normalized.isEmpty else { return nil }

        guard let tokens = tokenize(normalized) else { return nil }
        guard case let .number(first) = tokens.first else { return nil }

        // First pass: fold * and / left-to-right.
        var terms: [Double] = [first]
        var pendingOp: Operator?
        var i = 1
        while i < tokens.count {
            guard case let .op(op) = tokens[i] else { return nil }
            i += 1
            guard i < tokens.count, case let .number(value) = tokens[i] else { return nil }
            i += 1

            switch op {
            case .multiply:
                terms[terms.count - 1] *= value
            case .divide:
                guard value != 0 else { return nil }
                terms[terms.count - 1] /= value
            case .add, .subtract:
                terms.append(op == .subtract ? -value : value)
            }
            pendingOp = op
        }
        _ = pendingOp

        return terms.reduce(0, +)
    }

    /// The text shown in the field after it loses focus: the evaluated result, rounded to an
    /// integer when the field doesn't allow decimals (e.g. loan term in months), or the raw
    /// text unchanged if it doesn't evaluate (lets the user keep editing an incomplete entry).
    static func normalizedDisplayText(_ raw: String, allowsDecimal: Bool) -> String {
        guard let value = evaluateArithmeticExpression(raw) else { return raw }
        if allowsDecimal {
            // Trim trailing zeros/decimal point rather than fixing a precision, so "12.5" stays
            // "12.5" instead of becoming "12.500000".
            var s = String(format: "%.6f", value)
            while s.hasSuffix("0") { s.removeLast() }
            if s.hasSuffix(".") { s.removeLast() }
            return s
        } else {
            return String(Int(value.rounded()))
        }
    }

    /// Applies the operator-button tap rule: replace a trailing operator rather than stack two,
    /// and don't insert +/×/÷ with nothing to their left. A leading "-" is allowed (negative
    /// number entry). Shared by every `CalculatorField` so the behavior matches everywhere.
    static func inserting(_ op: Operator, into text: String) -> String {
        if text.isEmpty {
            return op == .subtract ? String(op.rawValue) : text
        }
        if let last = text.last, Operator(rawValue: last) != nil {
            return String(text.dropLast()) + String(op.rawValue)
        }
        return text + String(op.rawValue)
    }

    // MARK: - Tokenizing

    private enum Token {
        case number(Double)
        case op(Operator)
    }

    private static func normalize(_ raw: String) -> String {
        raw
            .replacingOccurrences(of: ",", with: "")
            .replacingOccurrences(of: "×", with: "*")
            .replacingOccurrences(of: "÷", with: "/")
            .replacingOccurrences(of: "−", with: "-")
            .trimmingCharacters(in: .whitespaces)
    }

    private static func tokenize(_ s: String) -> [Token]? {
        var tokens: [Token] = []
        var numberBuffer = ""
        var expectNumber = true

        func flushNumber() -> Bool {
            guard !numberBuffer.isEmpty else { return false }
            guard let value = Double(numberBuffer) else { return false }
            tokens.append(.number(value))
            numberBuffer = ""
            return true
        }

        for char in s {
            if char.isNumber || char == "." {
                numberBuffer.append(char)
                expectNumber = false
            } else if let op = Operator(rawValue: char) {
                if op == .subtract, expectNumber {
                    // Leading/unary minus: fold into the number buffer.
                    numberBuffer.append(char)
                    continue
                }
                guard flushNumber() else { return nil }
                tokens.append(.op(op))
                expectNumber = true
            } else {
                return nil
            }
        }
        guard flushNumber() else { return nil }
        return tokens
    }
}
