"""add_cash_settlement_and_dividend_cash_credit

Revision ID: c7d8e9f0a1b2
Revises: a3b4c5d6e7f8
Create Date: 2026-07-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c7d8e9f0a1b2'
down_revision: Union[str, Sequence[str], None] = 'a3b4c5d6e7f8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Self-referential link pairing a stock trade with the companion cash
    # trade used when it's settled against sub-portfolio cash.
    op.add_column('trades', sa.Column('settlement_trade_id', sa.UUID(), nullable=True), schema='finance_tracker')
    op.create_foreign_key(
        'fk_trades_settlement_trade_id_trades',
        'trades',
        'trades',
        ['settlement_trade_id'],
        ['id'],
        source_schema='finance_tracker',
        referent_schema='finance_tracker',
        ondelete='SET NULL',
    )

    # Links a dividend to the cash trade that credits its payout into the
    # sub-portfolio's cash balance.
    op.add_column('dividends', sa.Column('cash_trade_id', sa.UUID(), nullable=True), schema='finance_tracker')
    op.create_foreign_key(
        'fk_dividends_cash_trade_id_trades',
        'dividends',
        'trades',
        ['cash_trade_id'],
        ['id'],
        source_schema='finance_tracker',
        referent_schema='finance_tracker',
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('fk_dividends_cash_trade_id_trades', 'dividends', schema='finance_tracker', type_='foreignkey')
    op.drop_column('dividends', 'cash_trade_id', schema='finance_tracker')

    op.drop_constraint('fk_trades_settlement_trade_id_trades', 'trades', schema='finance_tracker', type_='foreignkey')
    op.drop_column('trades', 'settlement_trade_id', schema='finance_tracker')
