"""Add currency to trades

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-05-08 03:14:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Only add currency as exchange_rate already exists in the initial schema
    op.add_column('trades', sa.Column('currency', sa.String(), nullable=True), schema='finance_tracker')


def downgrade() -> None:
    op.drop_column('trades', 'currency', schema='finance_tracker')
