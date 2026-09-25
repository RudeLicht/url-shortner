"""backfill missing urlstats rows

Revision ID: b31470f20533
Revises: 98bebec1c59f
Create Date: 2026-09-24 22:29:34.679936

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b31470f20533'
down_revision: Union[str, Sequence[str], None] = '98bebec1c59f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(
        sa.text(
            "INSERT INTO urls_stats (url_id, clicks) "
            "SELECT u.id, 0 FROM urls u "
            "WHERE NOT EXISTS (SELECT 1 FROM urls_stats s WHERE s.url_id = u.id)"
        )
    )


def downgrade() -> None:
    """Downgrade schema."""
    # No-op: there is no safe way to distinguish the rows backfilled by this
    # migration from urls_stats rows that already existed, and leaving
    # clicks=0 rows in place is harmless, so we don't attempt to remove them.
    pass
