package com.ivanlee.financetracker

import com.ivanlee.financetracker.logic.CalculatorInput
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CalculatorInputTest {
    @Test
    fun plainNumber() {
        assertEquals(42.5, CalculatorInput.evaluateArithmeticExpression("42.5")!!, 0.0001)
    }

    @Test
    fun commaStrippedPlainNumber() {
        assertEquals(1234.5, CalculatorInput.evaluateArithmeticExpression("1,234.50")!!, 0.0001)
    }

    @Test
    fun addition() {
        assertEquals(97.75, CalculatorInput.evaluateArithmeticExpression("85+12.75")!!, 0.0001)
    }

    @Test
    fun divisionSplit() {
        assertEquals(14.16666, CalculatorInput.evaluateArithmeticExpression("42.5/3")!!, 0.0001)
    }

    @Test
    fun precedenceMultiplyBeforeAdd() {
        assertEquals(14.0, CalculatorInput.evaluateArithmeticExpression("2+3*4")!!, 0.0001)
    }

    @Test
    fun precedenceDivideBeforeSubtract() {
        assertEquals(8.0, CalculatorInput.evaluateArithmeticExpression("10-4/2")!!, 0.0001)
    }

    @Test
    fun leftToRightSamePrecedence() {
        assertEquals(1.0, CalculatorInput.evaluateArithmeticExpression("10/2/5")!!, 0.0001)
    }

    @Test
    fun leadingUnaryMinus() {
        assertEquals(-2.0, CalculatorInput.evaluateArithmeticExpression("-5+3")!!, 0.0001)
    }

    @Test
    fun subtractingNegative() {
        assertEquals(8.0, CalculatorInput.evaluateArithmeticExpression("5--3")!!, 0.0001)
    }

    @Test
    fun unicodeOperatorGlyphs() {
        assertEquals(42.0, CalculatorInput.evaluateArithmeticExpression("6×7")!!, 0.0001)
        assertEquals(3.0, CalculatorInput.evaluateArithmeticExpression("6÷2")!!, 0.0001)
    }

    @Test
    fun divideByZeroIsInvalid() {
        assertNull(CalculatorInput.evaluateArithmeticExpression("5/0"))
    }

    @Test
    fun trailingOperatorIsInvalid() {
        assertNull(CalculatorInput.evaluateArithmeticExpression("5+"))
    }

    @Test
    fun consecutiveOperatorsAreInvalid() {
        assertNull(CalculatorInput.evaluateArithmeticExpression("5+*3"))
    }

    @Test
    fun emptyIsInvalid() {
        assertNull(CalculatorInput.evaluateArithmeticExpression(""))
        assertNull(CalculatorInput.evaluateArithmeticExpression("   "))
    }

    @Test
    fun garbageIsInvalid() {
        assertNull(CalculatorInput.evaluateArithmeticExpression("abc"))
    }

    @Test
    fun insertingReplacesTrailingOperator() {
        assertEquals("5+", CalculatorInput.inserting(CalculatorInput.Operator.ADD, "5+"))
        assertEquals("5*", CalculatorInput.inserting(CalculatorInput.Operator.MULTIPLY, "5+"))
    }

    @Test
    fun insertingAppendsAfterOperand() {
        assertEquals("5+", CalculatorInput.inserting(CalculatorInput.Operator.ADD, "5"))
    }

    @Test
    fun insertingMinusOnEmptyStartsNegative() {
        assertEquals("-", CalculatorInput.inserting(CalculatorInput.Operator.SUBTRACT, ""))
    }

    @Test
    fun insertingPlusOnEmptyIsIgnored() {
        assertEquals("", CalculatorInput.inserting(CalculatorInput.Operator.ADD, ""))
        assertEquals("", CalculatorInput.inserting(CalculatorInput.Operator.MULTIPLY, ""))
        assertEquals("", CalculatorInput.inserting(CalculatorInput.Operator.DIVIDE, ""))
    }

    @Test
    fun normalizedDisplayTextTrimsTrailingZeros() {
        assertEquals("15.5", CalculatorInput.normalizedDisplayText("12.50+3", allowsDecimal = true))
    }

    @Test
    fun normalizedDisplayTextRoundsWhenIntegerOnly() {
        assertEquals("12", CalculatorInput.normalizedDisplayText("11.6+0.1", allowsDecimal = false))
    }

    @Test
    fun normalizedDisplayTextLeavesInvalidTextUnchanged() {
        assertEquals("5+", CalculatorInput.normalizedDisplayText("5+", allowsDecimal = true))
    }
}
