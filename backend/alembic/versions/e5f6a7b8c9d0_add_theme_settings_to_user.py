"""Add theme settings to user

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-05-08 03:49:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add columns to users table
    op.add_column('users', sa.Column('theme_mode', sa.String(), nullable=False, server_default='system'), schema='finance_tracker')
    op.add_column('users', sa.Column('primary_color', sa.String(), nullable=False, server_default='sky'), schema='finance_tracker')
    op.add_column('users', sa.Column('secondary_color', sa.String(), nullable=False, server_default='fuchsia'), schema='finance_tracker')
    op.add_column('users', sa.Column('base_color', sa.String(), nullable=False, server_default='mauve'), schema='finance_tracker')


def downgrade() -> None:
    op.drop_column('users', 'base_color', schema='finance_tracker')
    op.drop_column('users', 'secondary_color', schema='finance_tracker')
    op.drop_column('users', 'primary_color', schema='finance_tracker')
    op.drop_column('users', 'theme_mode', schema='finance_tracker')
