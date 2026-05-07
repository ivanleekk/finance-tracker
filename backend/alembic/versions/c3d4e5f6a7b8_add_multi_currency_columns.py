"""Add multi-currency columns

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-05-08 03:10:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Transactions table
    op.add_column('transactions', sa.Column('currency', sa.String(), nullable=True), schema='finance_tracker')
    op.add_column('transactions', sa.Column('exchange_rate', sa.Float(), nullable=True), schema='finance_tracker')
    
    # Account Balance table
    op.add_column('account_balances', sa.Column('balance_home_currency', sa.Numeric(), nullable=True), schema='finance_tracker')
    
    # Portfolio Snapshot table
    op.add_column('portfolio_snapshots', sa.Column('average_cost_basis_home_currency', sa.Numeric(), nullable=True), schema='finance_tracker')


def downgrade() -> None:
    op.drop_column('portfolio_snapshots', 'average_cost_basis_home_currency', schema='finance_tracker')
    op.drop_column('account_balances', 'balance_home_currency', schema='finance_tracker')
    op.drop_column('transactions', 'exchange_rate', schema='finance_tracker')
    op.drop_column('transactions', 'currency', schema='finance_tracker')
