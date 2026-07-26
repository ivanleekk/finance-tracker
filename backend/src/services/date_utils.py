"""Calendar arithmetic shared by the loan schedule and the recurrence engine."""

from __future__ import annotations

from datetime import date


def add_months(start: date, months: int) -> date:
    """
    Add whole months, clamping to the end of shorter months.

    Always computed from ``start``, never by stepping month to month, so a rule
    anchored on the 31st gives Jan 31 → Feb 28 → Mar 31 instead of drifting down
    to the 28th forever.
    """
    total = start.month - 1 + months
    year = start.year + total // 12
    month = total % 12 + 1
    for day in range(start.day, 0, -1):
        try:
            return date(year, month, day)
        except ValueError:
            continue
    raise ValueError("unreachable: every month has a day 1")


def months_between(start: date, end: date) -> int:
    """Whole months elapsed from `start` to `end` (negative if end precedes start)."""
    months = (end.year - start.year) * 12 + (end.month - start.month)
    if end.day < start.day:
        months -= 1
    return months
