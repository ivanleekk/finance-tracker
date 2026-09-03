#!/usr/bin/env python
"""
Repair liability balance chains written before the sign fix.

Dry run by default — it prints what it would change and writes nothing. Pass
`--apply` once you are happy with the report.

    uv run python scripts/repair_liability_balances.py
    uv run python scripts/repair_liability_balances.py --apply

Scope it with `--household <uuid>` or `--account <uuid>`. Running it twice is
safe: a repaired account reads as already-correct on the second pass.
"""

import argparse
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.database import SessionLocal  # noqa: E402
from src.services.liability_repair import (  # noqa: E402
    ALREADY_CORRECT,
    BROKEN,
    NOTHING_TO_CHECK,
    UNRECOGNISED,
    apply_plan,
    liability_accounts,
    plan_account,
)

HEADINGS = {
    BROKEN: "Will repair",
    ALREADY_CORRECT: "Already correct",
    NOTHING_TO_CHECK: "Nothing to check",
    UNRECOGNISED: "Left alone — needs a human",
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write the changes (default: dry run)")
    parser.add_argument("--household", type=uuid.UUID, help="limit to one household")
    parser.add_argument("--account", type=uuid.UUID, help="limit to one account")
    parser.add_argument("--verbose", action="store_true", help="print every corrected row")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        accounts = liability_accounts(db, household_id=args.household, account_id=args.account)
        if not accounts:
            print("No liability accounts matched.")
            return 0

        plans = [(account, plan_account(db, account)) for account in accounts]
        for verdict in (BROKEN, UNRECOGNISED, ALREADY_CORRECT, NOTHING_TO_CHECK):
            group = [(a, p) for a, p in plans if p.verdict == verdict]
            if not group:
                continue
            print(f"\n{HEADINGS[verdict]} ({len(group)})")
            print("-" * 72)
            for account, plan in group:
                line = f"  {plan.name}  [{account.household_id}]"
                if plan.note:
                    line += f"\n      {plan.note}"
                if plan.fixes:
                    last = plan.fixes[-1]
                    rows = "row" if len(plan.fixes) == 1 else "rows"
                    line += (
                        f"\n      {len(plan.fixes)} {rows}; latest {last.on}: "
                        f"{last.old} -> {last.new} {plan.currency}"
                        f"\n      net worth {plan.net_worth_delta:+} {plan.currency}"
                    )
                    if args.verbose:
                        for fix in plan.fixes:
                            line += f"\n        {fix.on}  {fix.old} -> {fix.new}"
                print(line)

        broken = [(a, p) for a, p in plans if p.verdict == BROKEN]
        if not broken:
            print("\nNothing to repair.")
            return 0

        if not args.apply:
            print(f"\nDry run — {len(broken)} account(s) would change. Re-run with --apply to write.")
            return 0

        for account, plan in broken:
            apply_plan(db, account, plan)
        db.commit()
        print(f"\nRepaired {len(broken)} account(s).")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
