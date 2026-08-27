"""
Rounding and coercion shared by anything that reports money.

Extracted when `card_service` needed the same two helpers `budget_service`
already had. Importing them from there would have meant reaching into another
module's private names — the only such import in `src/` — and copying them
would have put the rounding rule in two places, where it could drift.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

CENTS = Decimal("0.01")


def dec(value) -> Decimal:
    """Coerce to Decimal, treating a missing value as zero."""
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def money(value: Decimal) -> Decimal:
    """Round to cents, half-up — the way money is reported everywhere."""
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)
