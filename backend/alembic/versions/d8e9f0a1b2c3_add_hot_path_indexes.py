"""add_hot_path_indexes

Composite/FK indexes for the query patterns every page load hits:
household-scoped scans of trades, snapshots, accounts, sub-portfolios,
categories and dividends, plus account-scoped scans of transactions and
balances. Without these, each lookup is a sequential scan that grows with
total rows across ALL households.

Revision ID: d8e9f0a1b2c3
Revises: c7d8e9f0a1b2
Create Date: 2026-07-09 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd8e9f0a1b2c3'
down_revision: Union[str, Sequence[str], None] = 'c7d8e9f0a1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = 'finance_tracker'

INDEXES = [
    ('ix_trades_household_id_date', 'trades', ['household_id', 'date']),
    ('ix_trades_sub_portfolio_id', 'trades', ['sub_portfolio_id']),
    ('ix_portfolio_snapshots_household_id_date', 'portfolio_snapshots', ['household_id', 'date']),
    ('ix_transactions_account_id_date', 'transactions', ['account_id', 'date']),
    ('ix_account_balances_account_id_date', 'account_balances', ['account_id', 'date']),
    ('ix_financial_accounts_household_id', 'financial_accounts', ['household_id']),
    ('ix_sub_portfolios_household_id', 'sub_portfolios', ['household_id']),
    ('ix_categories_household_id', 'categories', ['household_id']),
    ('ix_dividends_household_id_date', 'dividends', ['household_id', 'date']),
    ('ix_household_members_household_id', 'household_members', ['household_id']),
    ('ix_household_members_user_id', 'household_members', ['user_id']),
    ('ix_household_invites_email_status', 'household_invites', ['email', 'status']),
    # exchange_rates(base, target, date) is already covered by its unique
    # constraint uq_exchange_rate_base_target_date.
]


def upgrade() -> None:
    for name, table, columns in INDEXES:
        op.create_index(name, table, columns, schema=SCHEMA, if_not_exists=True)


def downgrade() -> None:
    for name, table, _ in reversed(INDEXES):
        op.drop_index(name, table_name=table, schema=SCHEMA, if_exists=True)
