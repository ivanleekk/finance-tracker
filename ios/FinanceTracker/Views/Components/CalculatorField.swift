import SwiftUI

/// A text field for money/quantity/rate entry with a +/−/×/÷ calculator accessory above the
/// keyboard, so the user can type an expression ("42.50/3") instead of doing the math elsewhere.
///
/// On losing focus the text normalizes to the evaluated result (`CalculatorInput`), which is
/// also why every existing `Double(text...)` parse at a call site's save/submit path should be
/// replaced with `CalculatorInput.evaluateArithmeticExpression` — it's a strict superset of the
/// old parse and catches the rare case where the field is submitted while still focused.
///
/// On a long form, put `.calculatorKeyboard()` on the `Form` — see `CalculatorKeyboardHost`.
/// Without it the field declares its own keyboard toolbar, which is fine on a form short
/// enough that the field never scrolls out of view.
struct CalculatorField: View {
    let placeholder: String
    @Binding var text: String
    var keyboardType: UIKeyboardType = .decimalPad
    var allowsDecimal: Bool = true

    @Environment(CalculatorKeyboard.self) private var hostedKeyboard: CalculatorKeyboard?
    @FocusState private var isFocused: Bool
    @State private var id = UUID()

    var body: some View {
        let field = TextField(placeholder, text: $text)
            .keyboardType(keyboardType)
            .focused($isFocused)
            .onChange(of: isFocused) { _, focused in
                if focused {
                    hostedKeyboard?.activate(id: id, text: $text)
                } else {
                    text = CalculatorInput.normalizedDisplayText(text, allowsDecimal: allowsDecimal)
                    hostedKeyboard?.deactivate(id: id)
                }
            }

        if hostedKeyboard != nil {
            field
        } else {
            field.toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    CalculatorKeyboardButtons(text: $text) { isFocused = false }
                }
            }
        }
    }
}

/// The row of operator buttons plus Done, shared by both ways of hosting the accessory.
private struct CalculatorKeyboardButtons: View {
    @Binding var text: String
    let done: () -> Void

    var body: some View {
        ForEach([CalculatorInput.Operator.add, .subtract, .multiply, .divide], id: \.self) { op in
            Button(symbol(for: op)) {
                text = CalculatorInput.inserting(op, into: text)
            }
        }
        Spacer()
        Button("Done", action: done)
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

/// Which calculator field on a hosted form currently has the keyboard.
@MainActor
@Observable
final class CalculatorKeyboard {
    fileprivate var activeId: UUID?
    fileprivate var text: Binding<String>?

    fileprivate func activate(id: UUID, text: Binding<String>) {
        activeId = id
        self.text = text
    }

    fileprivate func deactivate(id: UUID) {
        // Focus moving straight from one calculator field to another can deliver the new
        // field's focus before the old one's blur; only the current owner may clear it.
        guard activeId == id else { return }
        clear()
    }

    fileprivate func clear() {
        activeId = nil
        text = nil
    }
}

/// Owns the calculator accessory for a whole form, instead of each field owning its own.
///
/// A keyboard toolbar declared *inside* a Form row lives only as long as that row does, and a
/// Form is lazy: scroll the focused amount field far enough out of view and SwiftUI tears the
/// row down, the toolbar with it. The keyboard's accessory height changes, the scroll view's
/// inset changes, the content shifts, the row is rebuilt, the toolbar returns — and the form
/// yo-yos at the bottom for as long as the keyboard is up. Declared here, on the Form, the
/// toolbar doesn't depend on any row being alive.
///
/// It also reserves room for the accessory. On iOS 26 the keyboard toolbar floats above the
/// keyboard as glass buttons that the scroll view's keyboard inset doesn't include, so the
/// last rows of a long form (the merchant code, on Quick Add) ended up underneath them with no
/// way to scroll them clear.
///
/// Sheets inherit the environment, so a sheet presented from a hosted form must not use a
/// `CalculatorField` without its own `.calculatorKeyboard()` — the parent's toolbar is not on
/// the sheet's navigation bar.
private struct CalculatorKeyboardHost: ViewModifier {
    @State private var keyboard = CalculatorKeyboard()

    /// The floating accessory's height plus the gap iOS 26 leaves above the keyboard.
    private static let floatingAccessoryClearance: CGFloat = 60

    func body(content: Content) -> some View {
        content
            .contentMargins(.bottom, bottomClearance, for: .scrollContent)
            .toolbar {
                if let text = keyboard.text {
                    ToolbarItemGroup(placement: .keyboard) {
                        CalculatorKeyboardButtons(text: text) {
                            UIApplication.shared.sendAction(
                                #selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil
                            )
                        }
                    }
                }
            }
            // A field can't be relied on to report its own blur: if the keyboard goes away
            // (a scroll dismissing it) while the field's row is scrolled out and torn down,
            // its `onChange(of: isFocused)` never runs, and the accessory would be left
            // floating over the form with no keyboard under it.
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
                keyboard.clear()
            }
            .environment(keyboard)
    }

    private var bottomClearance: CGFloat {
        guard #available(iOS 26, *), keyboard.activeId != nil else { return 0 }
        return Self.floatingAccessoryClearance
    }
}

extension View {
    /// Host the calculator keyboard accessory for every `CalculatorField` in this form. Apply
    /// to the `Form` inside its `NavigationStack`.
    func calculatorKeyboard() -> some View {
        modifier(CalculatorKeyboardHost())
    }
}

extension CalculatorInput.Operator: Hashable {}
