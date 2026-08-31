package com.ivanlee.financetracker.logic

/**
 * Parses and evaluates a short arithmetic expression typed into an amount field — e.g.
 * "42.50/3" or "85+12.75" — so `CalculatorField`'s +/-/x/div buttons produce a real value.
 *
 * Falls back to a plain number when there's no operator, which makes this a strict superset
 * of the old `text.replace(",", "").toDoubleOrNull()` parse: every call site that used to parse
 * a plain number keeps working unchanged. No parentheses — the numeric keyboards never expose
 * `(` `)` and the calculator buttons never insert them.
 *
 * iOS's `Support/CalculatorInput.swift` mirrors this token-for-token; keep them in sync.
 */
object CalculatorInput {
    enum class Operator(val symbol: Char) {
        ADD('+'),
        SUBTRACT('-'),
        MULTIPLY('*'),
        DIVIDE('/');

        companion object {
            fun fromChar(c: Char): Operator? = entries.firstOrNull { it.symbol == c }
        }
    }

    private sealed class Token {
        data class Number(val value: Double) : Token()
        data class Op(val operator: Operator) : Token()
    }

    /** Evaluates [raw] and returns the result, or null if it isn't a valid number/expression. */
    fun evaluateArithmeticExpression(raw: String): Double? {
        val normalized = normalize(raw)
        if (normalized.isEmpty()) return null

        val tokens = tokenize(normalized) ?: return null
        val first = (tokens.firstOrNull() as? Token.Number)?.value ?: return null

        // First pass: fold * and / left-to-right.
        val terms = mutableListOf(first)
        var i = 1
        while (i < tokens.size) {
            val opToken = tokens[i] as? Token.Op ?: return null
            i += 1
            val numToken = tokens.getOrNull(i) as? Token.Number ?: return null
            i += 1
            val value = numToken.value

            when (opToken.operator) {
                Operator.MULTIPLY -> terms[terms.lastIndex] *= value
                Operator.DIVIDE -> {
                    if (value == 0.0) return null
                    terms[terms.lastIndex] /= value
                }
                Operator.ADD -> terms.add(value)
                Operator.SUBTRACT -> terms.add(-value)
            }
        }

        return terms.sum()
    }

    /**
     * The text shown in the field after it loses focus: the evaluated result, rounded to an
     * integer when the field doesn't allow decimals (e.g. loan term in months), or the raw
     * text unchanged if it doesn't evaluate (lets the user keep editing an incomplete entry).
     */
    fun normalizedDisplayText(raw: String, allowsDecimal: Boolean): String {
        val value = evaluateArithmeticExpression(raw) ?: return raw
        return if (allowsDecimal) {
            var s = "%.6f".format(value)
            while (s.endsWith("0")) s = s.dropLast(1)
            if (s.endsWith(".")) s = s.dropLast(1)
            s
        } else {
            Math.round(value).toString()
        }
    }

    /**
     * Applies the operator-button tap rule: replace a trailing operator rather than stack two,
     * and don't insert +/x/div with nothing to their left. A leading "-" is allowed (negative
     * number entry). Shared by every `CalculatorField` so the behavior matches everywhere.
     */
    fun inserting(op: Operator, text: String): String {
        if (text.isEmpty()) {
            return if (op == Operator.SUBTRACT) op.symbol.toString() else text
        }
        val last = text.last()
        return if (Operator.fromChar(last) != null) {
            text.dropLast(1) + op.symbol
        } else {
            text + op.symbol
        }
    }

    private fun normalize(raw: String): String =
        raw.replace(",", "")
            .replace("×", "*")
            .replace("÷", "/")
            .replace("−", "-")
            .trim()

    private fun tokenize(s: String): List<Token>? {
        val tokens = mutableListOf<Token>()
        val numberBuffer = StringBuilder()
        var expectNumber = true

        fun flushNumber(): Boolean {
            if (numberBuffer.isEmpty()) return false
            val value = numberBuffer.toString().toDoubleOrNull() ?: return false
            tokens.add(Token.Number(value))
            numberBuffer.clear()
            return true
        }

        for (char in s) {
            when {
                char.isDigit() || char == '.' -> {
                    numberBuffer.append(char)
                    expectNumber = false
                }
                Operator.fromChar(char) != null -> {
                    val op = Operator.fromChar(char)!!
                    if (op == Operator.SUBTRACT && expectNumber) {
                        numberBuffer.append(char)
                        continue
                    }
                    if (!flushNumber()) return null
                    tokens.add(Token.Op(op))
                    expectNumber = true
                }
                else -> return null
            }
        }
        if (!flushNumber()) return null
        return tokens
    }
}
