"""add_created_at_to_snapshots

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-05-09 15:42:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('portfolio_snapshots', sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True), schema='finance_tracker')


def downgrade() -> None:
    op.drop_column('portfolio_snapshots', 'created_at', schema='finance_tracker')
