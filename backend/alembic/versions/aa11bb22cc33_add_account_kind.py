"""add_account_kind

Revision ID: aa11bb22cc33
Revises: d8e9f0a1b2c3
Create Date: 2026-07-09 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'aa11bb22cc33'
down_revision: Union[str, Sequence[str], None] = 'd8e9f0a1b2c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # asset | liability. Stored as VARCHAR (native_enum=False in the model);
    # all pre-existing accounts are assets.
    op.add_column(
        'financial_accounts',
        sa.Column('kind', sa.String(), server_default='asset', nullable=False),
        schema='finance_tracker'
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('financial_accounts', 'kind', schema='finance_tracker')
