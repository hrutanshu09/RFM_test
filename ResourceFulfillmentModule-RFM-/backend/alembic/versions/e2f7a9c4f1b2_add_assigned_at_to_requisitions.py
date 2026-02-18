"""add assigned_at to requisitions

Revision ID: e2f7a9c4f1b2
Revises: c3b21a7e8f15
Create Date: 2026-01-31 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "e2f7a9c4f1b2"
down_revision = "c3b21a7e8f15"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("requisitions", sa.Column("assigned_at", sa.TIMESTAMP(), nullable=True))


def downgrade() -> None:
    op.drop_column("requisitions", "assigned_at")
