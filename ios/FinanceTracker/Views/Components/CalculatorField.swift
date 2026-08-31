import SwiftUI

/// A text field for money/quantity/rate entry with a +/−/×/÷ calculator accessory above the
/// keyboard, so the user can type an expression ("42.50/3") instead of doing the math elsewhere.
///
/// On losing focus the text normalizes to the evaluated result (`CalculatorInput`), which is
/// also why every existing `Double(text...)` parse at a call site's save/submit path should be
/// replaced with `CalculatorInput.evaluateArithmeticExpression` — it's a strict superset of the
/// old parse and catches the rare case where the field is submitted while still focused.
struct CalculatorField: View {
    let placeholder: String
    @Binding var text: String
    var keyboardType: UIKeyboardType = .decimalPad
    var allowsDecimal: Bool = true

    @FocusState private var isFocused: Bool

    var body: some View {
        TextField(placeholder, text: $text)
            .keyboardType(keyboardType)
            .focused($isFocused)
            .onChange(of: isFocused) { _, focused in
                if !focused {
                    text = CalculatorInput.normalizedDisplayText(text, allowsDecimal: allowsDecimal)
                }
            }
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    ForEach([CalculatorInput.Operator.add, .subtract, .multiply, .divide], id: \.self) { op in
                        Button(symbol(for: op)) {
                            text = CalculatorInput.inserting(op, into: text)
                        }
                    }
                    Spacer()
                    Button("Done") {
                        isFocused = false
                    }
                }
            }
    }

    private func symbol(for op: CalculatorInput.Operator) -> String {
        switch op {
        case .add: return "+"
        case .subtract: return "−"
        case .multiply: return "×"
        case .divide: return "÷"
        }
    }
}

extension CalculatorInput.Operator: Hashable {}
