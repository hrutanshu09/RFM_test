"""add jd_file_key to requisitions

Revision ID: a7c8d9e0f1a2
Revises: f1a2b3c4d5e6
Create Date: 2026-02-03 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a7c8d9e0f1a2"
down_revision: Union[str, Sequence[str], None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("requisitions", sa.Column("jd_file_key", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("requisitions", "jd_file_key")
