"""requisition_progress_and_replacement_hardening

Revision ID: 46ee35aed147
Revises: f3f9db365575
Create Date: 2026-02-05 12:23:17.287658

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '46ee35aed147'
down_revision: Union[str, Sequence[str], None] = 'f3f9db365575'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade():

    # ==========================================================
    # 1️⃣ HEADER PROGRESS SUPPORT
    # ==========================================================

    op.add_column(
        "requisitions",
        sa.Column("total_items", sa.Integer(), nullable=False, server_default="0"),
    )

    op.add_column(
        "requisitions",
        sa.Column("active_items", sa.Integer(), nullable=False, server_default="0"),
    )

    op.add_column(
        "requisitions",
        sa.Column("fulfilled_items", sa.Integer(), nullable=False, server_default="0"),
    )

    # ==========================================================
    # 2️⃣ ENSURE REQUIRED COLUMNS EXIST
    # ==========================================================

    op.add_column(
        "requisition_items",
        sa.Column(
            "replacement_hire",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    op.add_column(
        "requisition_items",
        sa.Column("replaced_emp_id", sa.String(length=20), nullable=True),
    )

    op.add_column(
        "requisition_items",
        sa.Column("assigned_ta_id", sa.Integer(), nullable=True),
    )

    # ==========================================================
    # 3️⃣ REPLACEMENT HIRE INTEGRITY CHECK
    # ==========================================================

    op.create_check_constraint(
        "chk_replacement_logic",
        "requisition_items",
        """
        (
            replacement_hire = FALSE
            OR
            (replacement_hire = TRUE AND replaced_emp_id IS NOT NULL)
        )
        """,
    )

    # ==========================================================
    # 4️⃣ ASSIGNMENT FK + PERFORMANCE INDEXES
    # ==========================================================

    op.create_foreign_key(
        "fk_requisition_items_assigned_ta",
        "requisition_items",
        "users",
        ["assigned_ta_id"],
        ["user_id"],
        ondelete="SET NULL",
    )

    op.create_index(
        "idx_requisition_items_assigned_ta",
        "requisition_items",
        ["assigned_ta_id"],
    )

    op.execute("""
        CREATE INDEX idx_requisition_items_unassigned
        ON requisition_items (req_id)
        WHERE assigned_ta_id IS NULL;
    """)

    # ==========================================================
    # 5️⃣ STATUS INDEX
    # ==========================================================

    op.create_index(
        "idx_requisition_items_status",
        "requisition_items",
        ["item_status"],
    )


def downgrade():

    op.drop_index("idx_requisition_items_status", table_name="requisition_items")

    op.execute("DROP INDEX IF EXISTS idx_requisition_items_unassigned")

    op.drop_index(
        "idx_requisition_items_assigned_ta",
        table_name="requisition_items",
    )

    op.drop_constraint(
        "fk_requisition_items_assigned_ta",
        "requisition_items",
        type_="foreignkey",
    )

    op.drop_constraint(
        "chk_replacement_logic",
        "requisition_items",
        type_="check",
    )

    op.drop_column("requisition_items", "assigned_ta_id")
    op.drop_column("requisition_items", "replaced_emp_id")
    op.drop_column("requisition_items", "replacement_hire")

    op.drop_column("requisitions", "fulfilled_items")
    op.drop_column("requisitions", "active_items")
    op.drop_column("requisitions", "total_items")
