"""add_scheduled_dividends

Revision ID: cc33dd44ee55
Revises: bb22cc33dd44
Create Date: 2026-07-09 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'cc33dd44ee55'
down_revision: Union[str, Sequence[str], None] = 'bb22cc33dd44'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'scheduled_dividends',
        sa.Column('id', sa.UUID(as_uuid=True), primary_key=True, index=True),
        sa.Column('household_id', sa.UUID(as_uuid=True), sa.ForeignKey('finance_tracker.households.id'), index=True),
        sa.Column('sub_portfolio_id', sa.UUID(as_uuid=True), sa.ForeignKey('finance_tracker.sub_portfolios.id')),
        sa.Column('asset_id', sa.UUID(as_uuid=True), sa.ForeignKey('finance_tracker.assets.id')),
        sa.Column('account_id', sa.UUID(as_uuid=True), sa.ForeignKey('finance_tracker.financial_accounts.id')),
        sa.Column('date', sa.Date()),
        sa.Column('amount', sa.Numeric()),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('dividend_id', sa.UUID(as_uuid=True), sa.ForeignKey('finance_tracker.dividends.id', ondelete='SET NULL'), nullable=True),
        sa.Column('materialized_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        schema='finance_tracker',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('scheduled_dividends', schema='finance_tracker')
