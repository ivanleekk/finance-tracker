"""every card needs a default category

Revision ID: beea2ea972a2
Revises: 99b6418c7347
Create Date: 2026-08-28 17:02:32.416526

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'beea2ea972a2'
down_revision: Union[str, Sequence[str], None] = '99b6418c7347'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Give every existing card a default category, and promote one where the
    categories exist but none is marked default.

    Untagged spend is resolved *to* the default when a cycle is totalled, so a
    card without one has nowhere to put it: the spend is computed and then
    dropped. Setting up a card, adding a cap and spending on it showed a meter
    reading zero — the opposite of what the feature is for.

    `create_card` now seeds this, so it is only the cards already out there that
    need it.
    """
    # 1. Cards with no categories at all.
    op.execute(
        """
        INSERT INTO finance_tracker.card_categories (id, card_id, name, is_default, sort_order)
        SELECT gen_random_uuid(), c.id, 'Everything else', true, 0
          FROM finance_tracker.cards c
         WHERE NOT EXISTS (
               SELECT 1 FROM finance_tracker.card_categories cc WHERE cc.card_id = c.id
           )
        """
    )
    # 2. Cards that have categories but no default — promote the lowest-sorted,
    #    which is the one a client lists first.
    op.execute(
        """
        UPDATE finance_tracker.card_categories
           SET is_default = true
         WHERE id IN (
               SELECT DISTINCT ON (cc.card_id) cc.id
                 FROM finance_tracker.card_categories cc
                WHERE NOT EXISTS (
                      SELECT 1 FROM finance_tracker.card_categories d
                       WHERE d.card_id = cc.card_id AND d.is_default
                  )
             ORDER BY cc.card_id, cc.sort_order, cc.name
           )
        """
    )


def downgrade() -> None:
    # Deliberately not reversed. Removing a card's only category would restore
    # the hole this closes, and the seeded row may by then hold transactions.
    pass
