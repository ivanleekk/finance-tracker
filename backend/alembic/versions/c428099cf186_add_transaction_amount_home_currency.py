"""add transaction amount_home_currency

Revision ID: c428099cf186
Revises: de68ad645234
Create Date: 2026-05-11 19:10:48.533943

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c428099cf186'
down_revision: Union[str, Sequence[str], None] = 'de68ad645234'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('transactions', sa.Column('amount_home_currency', sa.Numeric(), nullable=True), schema='finance_tracker')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('transactions', 'amount_home_currency', schema='finance_tracker')
