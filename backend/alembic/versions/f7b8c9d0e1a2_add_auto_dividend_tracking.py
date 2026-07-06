"""add_auto_dividend_tracking

Revision ID: f7b8c9d0e1a2
Revises: c428099cf186
Create Date: 2026-07-06 16:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f7b8c9d0e1a2'
down_revision: Union[str, Sequence[str], None] = 'c428099cf186'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # New columns to support automatic dividend tracking.
    # is_manual defaults to true so any pre-existing (hand-entered) dividends
    # are preserved as manual and never overwritten by the auto sync.
    op.add_column(
        'dividends',
        sa.Column('transaction_id', sa.UUID(as_uuid=True), nullable=True),
        schema='finance_tracker'
    )
    op.add_column(
        'dividends',
        sa.Column('amount_home_currency', sa.Numeric(), nullable=True),
        schema='finance_tracker'
    )
    op.add_column(
        'dividends',
        sa.Column('per_share_amount', sa.Numeric(), nullable=True),
        schema='finance_tracker'
    )
    op.add_column(
        'dividends',
        sa.Column('quantity', sa.Float(), nullable=True),
        schema='finance_tracker'
    )
    op.add_column(
        'dividends',
        sa.Column('is_manual', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        schema='finance_tracker'
    )
    op.create_foreign_key(
        'fk_dividends_transaction_id',
        'dividends', 'transactions',
        ['transaction_id'], ['id'],
        source_schema='finance_tracker', referent_schema='finance_tracker'
    )
    op.create_unique_constraint(
        'uq_dividend_sub_portfolio_asset_date',
        'dividends',
        ['sub_portfolio_id', 'asset_id', 'date'],
        schema='finance_tracker'
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('uq_dividend_sub_portfolio_asset_date', 'dividends', schema='finance_tracker', type_='unique')
    op.drop_constraint('fk_dividends_transaction_id', 'dividends', schema='finance_tracker', type_='foreignkey')
    op.drop_column('dividends', 'is_manual', schema='finance_tracker')
    op.drop_column('dividends', 'quantity', schema='finance_tracker')
    op.drop_column('dividends', 'per_share_amount', schema='finance_tracker')
    op.drop_column('dividends', 'amount_home_currency', schema='finance_tracker')
    op.drop_column('dividends', 'transaction_id', schema='finance_tracker')
