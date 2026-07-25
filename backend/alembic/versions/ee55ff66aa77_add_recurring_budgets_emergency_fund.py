"""add recurring transactions, budgets and the emergency fund target

Three things a user had to do by hand: retype the salary and rent every month,
track category spending against a limit in their head, and work out how long
their cash would last.

Revision ID: ee55ff66aa77
Revises: dd44ee55ff66
Create Date: 2026-07-25 13:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ee55ff66aa77'
down_revision: Union[str, Sequence[str], None] = 'dd44ee55ff66'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'households',
        sa.Column(
            'emergency_fund_target_months',
            sa.Numeric(),
            nullable=False,
            server_default='6',
        ),
        schema='finance_tracker',
    )

    op.create_table(
        'recurring_transactions',
        sa.Column('id', sa.UUID(as_uuid=True), primary_key=True, index=True),
        sa.Column('household_id', sa.UUID(as_uuid=True), sa.ForeignKey('finance_tracker.households.id'), index=True),
        sa.Column('account_id', sa.UUID(as_uuid=True), sa.ForeignKey('finance_tracker.financial_accounts.id')),
        sa.Column('category_id', sa.UUID(as_uuid=True), sa.ForeignKey('finance_tracker.categories.id')),
        sa.Column('amount', sa.Numeric()),
        sa.Column('currency', sa.String(), nullable=True),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('frequency', sa.String(), nullable=False),
        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('end_date', sa.Date(), nullable=True),
        sa.Column('next_due_date', sa.Date(), nullable=False, index=True),
        sa.Column('last_posted_date', sa.Date(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('owner_user_id', sa.UUID(as_uuid=True), sa.ForeignKey('finance_tracker.users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        schema='finance_tracker',
    )

    op.create_table(
        'budgets',
        sa.Column('id', sa.UUID(as_uuid=True), primary_key=True, index=True),
        sa.Column('household_id', sa.UUID(as_uuid=True), sa.ForeignKey('finance_tracker.households.id'), index=True),
        sa.Column('category_id', sa.UUID(as_uuid=True), sa.ForeignKey('finance_tracker.categories.id')),
        sa.Column('amount', sa.Numeric()),
        sa.Column('period', sa.String(), nullable=False, server_default='monthly'),
        sa.Column('owner_user_id', sa.UUID(as_uuid=True), sa.ForeignKey('finance_tracker.users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('household_id', 'category_id', 'owner_user_id', name='uq_budget_household_category_owner'),
        schema='finance_tracker',
    )

    op.add_column(
        'transactions',
        sa.Column('recurring_transaction_id', sa.UUID(as_uuid=True), nullable=True),
        schema='finance_tracker',
    )
    op.create_index(
        'ix_finance_tracker_transactions_recurring_transaction_id',
        'transactions',
        ['recurring_transaction_id'],
        schema='finance_tracker',
    )
    op.create_foreign_key(
        'fk_transactions_recurring_transaction_id',
        'transactions',
        'recurring_transactions',
        ['recurring_transaction_id'],
        ['id'],
        source_schema='finance_tracker',
        referent_schema='finance_tracker',
        ondelete='SET NULL',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        'fk_transactions_recurring_transaction_id',
        'transactions',
        schema='finance_tracker',
        type_='foreignkey',
    )
    op.drop_index(
        'ix_finance_tracker_transactions_recurring_transaction_id',
        table_name='transactions',
        schema='finance_tracker',
    )
    op.drop_column('transactions', 'recurring_transaction_id', schema='finance_tracker')
    op.drop_table('budgets', schema='finance_tracker')
    op.drop_table('recurring_transactions', schema='finance_tracker')
    op.drop_column('households', 'emergency_fund_target_months', schema='finance_tracker')
