"""add_asset_pricing_mode

Revision ID: bb22cc33dd44
Revises: aa11bb22cc33
Create Date: 2026-07-09 10:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'bb22cc33dd44'
down_revision: Union[str, Sequence[str], None] = 'aa11bb22cc33'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # market | manual. Manual assets (unlisted bonds, Singapore Savings Bonds)
    # are excluded from yfinance fetches and valued from user-recorded prices.
    op.add_column(
        'assets',
        sa.Column('pricing_mode', sa.String(), server_default='market', nullable=False),
        schema='finance_tracker'
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('assets', 'pricing_mode', schema='finance_tracker')
