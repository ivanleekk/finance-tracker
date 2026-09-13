"""merge fx and card anniversary heads

Revision ID: 405757fbb34e
Revises: 67df3546a72a, 9de9dad096e1
Create Date: 2026-09-13 15:01:12.488702

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '405757fbb34e'
down_revision: Union[str, Sequence[str], None] = ('67df3546a72a', '9de9dad096e1')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
