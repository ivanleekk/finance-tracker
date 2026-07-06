"""add_transaction_id_to_trades

Revision ID: 9f1a2b3c4d5e
Revises: 2ea5dd401ec6
Create Date: 2026-05-08 00:12:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9f1a2b3c4d5e'
down_revision: Union[str, Sequence[str], None] = '2ea5dd401ec6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add transaction_id column to trades
    op.add_column('trades', sa.Column('transaction_id', sa.UUID(), nullable=True), schema='finance_tracker')
    
    # Create foreign key constraint
    op.create_foreign_key(
        'fk_trades_transaction_id_transactions', 
        'trades', 
        'transactions', 
        ['transaction_id'], 
        ['id'], 
        source_schema='finance_tracker', 
        referent_schema='finance_tracker'
    )


def downgrade() -> None:
    # Drop foreign key constraint
    op.drop_constraint(
        'fk_trades_transaction_id_transactions', 
        'trades', 
        schema='finance_tracker', 
        type_='foreignkey'
    )
    
    # Drop transaction_id column from trades
    op.drop_column('trades', 'transaction_id', schema='finance_tracker')
