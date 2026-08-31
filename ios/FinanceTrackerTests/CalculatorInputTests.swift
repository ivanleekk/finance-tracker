import Testing
@testable import FinanceTracker

struct CalculatorInputTests {
    @Test func plainNumber() {
        #expect(CalculatorInput.evaluateArithmeticExpression("42.5") == 42.5)
    }

    @Test func commaStrippedPlainNumber() {
        #expect(CalculatorInput.evaluateArithmeticExpression("1,234.50") == 1234.5)
    }

    @Test func addition() {
        #expect(CalculatorInput.evaluateArithmeticExpression("85+12.75") == 97.75)
    }

    @Test func divisionSplit() {
        #expect(CalculatorInput.evaluateArithmeticExpression("42.5/3") != nil)
        #expect(abs(CalculatorInput.evaluateArithmeticExpression("42.5/3")! - 14.1666666) < 0.0001)
    }

    @Test func precedenceMultiplyBeforeAdd() {
        #expect(CalculatorInput.evaluateArithmeticExpression("2+3*4") == 14)
    }

    @Test func precedenceDivideBeforeSubtract() {
        #expect(CalculatorInput.evaluateArithmeticExpression("10-4/2") == 8)
    }

    @Test func leftToRightSamePrecedence() {
        #expect(CalculatorInput.evaluateArithmeticExpression("10/2/5") == 1)
    }

    @Test func leadingUnaryMinus() {
        #expect(CalculatorInput.evaluateArithmeticExpression("-5+3") == -2)
    }

    @Test func subtractingNegative() {
        #expect(CalculatorInput.evaluateArithmeticExpression("5--3") == 8)
    }

    @Test func unicodeOperatorGlyphs() {
        #expect(CalculatorInput.evaluateArithmeticExpression("6×7") == 42)
        #expect(CalculatorInput.evaluateArithmeticExpression("6÷2") == 3)
    }

    @Test func divideByZeroIsInvalid() {
        #expect(CalculatorInput.evaluateArithmeticExpression("5/0") == nil)
    }

    @Test func trailingOperatorIsInvalid() {
        #expect(CalculatorInput.evaluateArithmeticExpression("5+") == nil)
    }

    @Test func consecutiveOperatorsAreInvalid() {
        #expect(CalculatorInput.evaluateArithmeticExpression("5+*3") == nil)
    }

    @Test func emptyIsInvalid() {
        #expect(CalculatorInput.evaluateArithmeticExpression("") == nil)
        #expect(CalculatorInput.evaluateArithmeticExpression("   ") == nil)
    }

    @Test func garbageIsInvalid() {
        #expect(CalculatorInput.evaluateArithmeticExpression("abc") == nil)
    }

    @Test func insertingReplacesTrailingOperator() {
        #expect(CalculatorInput.inserting(.add, into: "5+") == "5+")
        #expect(CalculatorInput.inserting(.multiply, into: "5+") == "5*")
    }

    @Test func insertingAppendsAfterOperand() {
        #expect(CalculatorInput.inserting(.add, into: "5") == "5+")
    }

    @Test func insertingMinusOnEmptyStartsNegative() {
        #expect(CalculatorInput.inserting(.subtract, into: "") == "-")
    }

    @Test func insertingPlusOnEmptyIsIgnored() {
        #expect(CalculatorInput.inserting(.add, into: "") == "")
        #expect(CalculatorInput.inserting(.multiply, into: "") == "")
        #expect(CalculatorInput.inserting(.divide, into: "") == "")
    }

    @Test func normalizedDisplayTextTrimsTrailingZeros() {
        #expect(CalculatorInput.normalizedDisplayText("12.50+3", allowsDecimal: true) == "15.5")
    }

    @Test func normalizedDisplayTextRoundsWhenIntegerOnly() {
        #expect(CalculatorInput.normalizedDisplayText("11.6+0.1", allowsDecimal: false) == "12")
    }

    @Test func normalizedDisplayTextLeavesInvalidTextUnchanged() {
        #expect(CalculatorInput.normalizedDisplayText("5+", allowsDecimal: true) == "5+")
    }
}
