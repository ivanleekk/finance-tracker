"""add property (illiquid) liquidity and loan/property terms to accounts

Lets a household record the house alongside the mortgage: an ``illiquid``
liquidity bucket for physical assets, loan terms so a liability amortizes
itself, an appreciation rate for property, and a self-link tying the two
together for home equity.

Revision ID: dd44ee55ff66
Revises: cc33dd44ee55
Create Date: 2026-07-25 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'dd44ee55ff66'
down_revision: Union[str, Sequence[str], None] = 'cc33dd44ee55'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Postgres 12+ allows ADD VALUE inside a transaction as long as the new
    # label isn't referenced in the same transaction — we only add columns here.
    op.execute(
        "ALTER TYPE finance_tracker.liquidity_status ADD VALUE IF NOT EXISTS 'illiquid'"
    )

    with op.batch_alter_table('financial_accounts', schema='finance_tracker') as batch:
        batch.add_column(sa.Column('original_principal', sa.Numeric(), nullable=True))
        batch.add_column(sa.Column('interest_rate_annual', sa.Numeric(), nullable=True))
        batch.add_column(sa.Column('loan_term_months', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('monthly_payment', sa.Numeric(), nullable=True))
        batch.add_column(sa.Column('loan_start_date', sa.Date(), nullable=True))
        batch.add_column(sa.Column('appreciation_rate_annual', sa.Numeric(), nullable=True))
        batch.add_column(sa.Column('linked_account_id', sa.UUID(as_uuid=True), nullable=True))

    op.create_foreign_key(
        'fk_financial_accounts_linked_account_id',
        'financial_accounts',
        'financial_accounts',
        ['linked_account_id'],
        ['id'],
        source_schema='finance_tracker',
        referent_schema='finance_tracker',
        ondelete='SET NULL',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        'fk_financial_accounts_linked_account_id',
        'financial_accounts',
        schema='finance_tracker',
        type_='foreignkey',
    )
    with op.batch_alter_table('financial_accounts', schema='finance_tracker') as batch:
        batch.drop_column('linked_account_id')
        batch.drop_column('appreciation_rate_annual')
        batch.drop_column('loan_start_date')
        batch.drop_column('monthly_payment')
        batch.drop_column('loan_term_months')
        batch.drop_column('interest_rate_annual')
        batch.drop_column('original_principal')

    # Postgres cannot drop a value from an enum type. Any account left on
    # 'illiquid' is moved back to 'liquid' so the label is unused, but the label
    # itself stays on the type.
    op.execute(
        "UPDATE finance_tracker.financial_accounts SET liquidity = 'liquid' "
        "WHERE liquidity = 'illiquid'"
    )
