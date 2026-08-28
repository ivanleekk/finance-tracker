"""an existing account's first balance is an opening balance too

Revision ID: 99b6418c7347
Revises: bc4ae7e4cd64
Create Date: 2026-08-28 10:05:39.686917

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '99b6418c7347'
down_revision: Union[str, Sequence[str], None] = 'bc4ae7e4cd64'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Clear `is_manual` on each account's earliest balance.

    `is_manual` marks a checkpoint that `propagate_balance_change` refuses to
    move through, which is right for a reconciliation — "I counted, and it was
    this much on this date" must not be silently overwritten by a transaction
    entered afterwards. Account creation posted the opening balance through the
    same endpoint, so every account planted a checkpoint at its creation date,
    and a transaction entered with an *earlier* date stopped dead against it.

    `add_account_balance` no longer marks the first balance manual, but that only
    helps accounts created since. This applies the same rule to the ones already
    here: an account's first balance has no history behind it to correct, so
    there is nothing for it to be a checkpoint against.

    Only the earliest row per account is touched. Second and later balances are
    real reconciliations and keep their flag.

    This does not move any figure — it changes what future edits are allowed to
    propagate through. An account whose numbers are *already* wrong because a
    backdated transaction was blocked needs a fresh balance entered to correct
    it; this migration cannot know what the right figure is.
    """
    op.execute(
        """
        UPDATE finance_tracker.account_balances b
           SET is_manual = false
          FROM (
                SELECT DISTINCT ON (account_id) id
                  FROM finance_tracker.account_balances
              ORDER BY account_id, date
               ) AS firsts
         WHERE b.id = firsts.id
           AND b.is_manual = true
        """
    )


def downgrade() -> None:
    # Restores the old *rule* — every first balance is a checkpoint — rather than
    # the exact prior rows. An account created after `add_account_balance` stopped
    # marking the first balance manual already had `false` there, and this sets it
    # to `true`. That is the pre-migration behaviour for such a row, which is what
    # a downgrade is for, but it is not a byte-for-byte undo.
    op.execute(
        """
        UPDATE finance_tracker.account_balances b
           SET is_manual = true
          FROM (
                SELECT DISTINCT ON (account_id) id
                  FROM finance_tracker.account_balances
              ORDER BY account_id, date
               ) AS firsts
         WHERE b.id = firsts.id
        """
    )
