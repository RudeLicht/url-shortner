"""add owner_token_hash to urls

Revision ID: e3b38bb7e28c
Revises: b31470f20533
Create Date: 2026-09-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e3b38bb7e28c'
down_revision: Union[str, Sequence[str], None] = 'b31470f20533'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("urls", sa.Column("owner_token_hash", sa.String(length=64), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("urls") as batch_op:
        batch_op.drop_column("owner_token_hash")
