"""add_is_manual_to_account_balances

Revision ID: a1b2c3d4e5f6
Revises: 9f1a2b3c4d5e
Create Date: 2026-05-08 00:32:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '9f1a2b3c4d5e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add is_manual column to account_balances
    # We use server_default='true' to ensure existing records are marked as manual
    op.add_column(
        'account_balances', 
        sa.Column('is_manual', sa.Boolean(), server_default=sa.text('true'), nullable=False), 
        schema='finance_tracker'
    )


def downgrade() -> None:
    # Drop is_manual column from account_balances
    op.drop_column('account_balances', 'is_manual', schema='finance_tracker')
