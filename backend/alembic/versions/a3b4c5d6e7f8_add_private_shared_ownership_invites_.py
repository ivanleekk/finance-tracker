"""add_private_shared_ownership_invites_and_default_split

Revision ID: a3b4c5d6e7f8
Revises: f7b8c9d0e1a2
Create Date: 2026-07-07 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a3b4c5d6e7f8'
down_revision: Union[str, Sequence[str], None] = 'f7b8c9d0e1a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    sa.Enum('even', 'by_income', 'custom', name='split_mode', schema='finance_tracker').create(bind, checkfirst=True)
    sa.Enum('pending', 'accepted', 'revoked', name='household_invite_status', schema='finance_tracker').create(bind, checkfirst=True)

    # --- Private vs. shared ownership: NULL = shared with household, non-null = private to that user ---
    op.add_column(
        'financial_accounts',
        sa.Column('owner_user_id', sa.UUID(as_uuid=True), nullable=True),
        schema='finance_tracker'
    )
    op.create_foreign_key(
        'fk_financial_accounts_owner_user_id',
        'financial_accounts', 'users',
        ['owner_user_id'], ['id'],
        source_schema='finance_tracker', referent_schema='finance_tracker'
    )
    op.add_column(
        'sub_portfolios',
        sa.Column('owner_user_id', sa.UUID(as_uuid=True), nullable=True),
        schema='finance_tracker'
    )
    op.create_foreign_key(
        'fk_sub_portfolios_owner_user_id',
        'sub_portfolios', 'users',
        ['owner_user_id'], ['id'],
        source_schema='finance_tracker', referent_schema='finance_tracker'
    )

    # --- User-level privacy preferences (Settings > Private vault) ---
    op.add_column(
        'users',
        sa.Column('hide_private_from_household', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        schema='finance_tracker'
    )
    op.add_column(
        'users',
        sa.Column('require_face_id_for_vault', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        schema='finance_tracker'
    )
    op.add_column(
        'users',
        sa.Column('default_new_items_private', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        schema='finance_tracker'
    )

    # --- Household default expense split ---
    op.add_column(
        'households',
        sa.Column(
            'default_split_mode',
            postgresql.ENUM('even', 'by_income', 'custom', name='split_mode', schema='finance_tracker', create_type=False),
            server_default='even',
            nullable=True,
        ),
        schema='finance_tracker'
    )
    op.create_table(
        'household_split_shares',
        sa.Column('id', sa.UUID(as_uuid=True), primary_key=True, index=True),
        sa.Column('household_id', sa.UUID(as_uuid=True), sa.ForeignKey('finance_tracker.households.id'), nullable=True),
        sa.Column('user_id', sa.UUID(as_uuid=True), sa.ForeignKey('finance_tracker.users.id'), nullable=True),
        sa.Column('share_percent', sa.Numeric(), nullable=True),
        sa.UniqueConstraint('household_id', 'user_id', name='uq_household_split_share_household_user'),
        schema='finance_tracker'
    )

    # --- Household invites (pending member invitations by email) ---
    op.create_table(
        'household_invites',
        sa.Column('id', sa.UUID(as_uuid=True), primary_key=True, index=True),
        sa.Column('household_id', sa.UUID(as_uuid=True), sa.ForeignKey('finance_tracker.households.id'), nullable=True),
        sa.Column('email', sa.String(), nullable=False, index=True),
        sa.Column('role', postgresql.ENUM('owner', 'editor', 'viewer', name='household_role_type', schema='finance_tracker', create_type=False), nullable=True),
        sa.Column('invited_by_user_id', sa.UUID(as_uuid=True), sa.ForeignKey('finance_tracker.users.id'), nullable=True),
        sa.Column(
            'status',
            postgresql.ENUM('pending', 'accepted', 'revoked', name='household_invite_status', schema='finance_tracker', create_type=False),
            server_default='pending',
            nullable=True,
        ),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        schema='finance_tracker'
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('household_invites', schema='finance_tracker')
    op.execute('DROP TYPE IF EXISTS finance_tracker.household_invite_status')

    op.drop_table('household_split_shares', schema='finance_tracker')

    op.drop_column('households', 'default_split_mode', schema='finance_tracker')
    op.execute('DROP TYPE IF EXISTS finance_tracker.split_mode')

    op.drop_column('users', 'default_new_items_private', schema='finance_tracker')
    op.drop_column('users', 'require_face_id_for_vault', schema='finance_tracker')
    op.drop_column('users', 'hide_private_from_household', schema='finance_tracker')

    op.drop_constraint('fk_sub_portfolios_owner_user_id', 'sub_portfolios', schema='finance_tracker', type_='foreignkey')
    op.drop_column('sub_portfolios', 'owner_user_id', schema='finance_tracker')

    op.drop_constraint('fk_financial_accounts_owner_user_id', 'financial_accounts', schema='finance_tracker', type_='foreignkey')
    op.drop_column('financial_accounts', 'owner_user_id', schema='finance_tracker')
