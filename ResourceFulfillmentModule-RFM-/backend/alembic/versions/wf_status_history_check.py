"""Update requisition_status_history CHECK constraint to Workflow Spec v1.0.0

Revision ID: wf_status_history_check
Revises: wf_observability_indexes
Create Date: 2026-02-06

This migration:
1. Drops the LEGACY chk_requisition_status_values constraint from
   requisition_status_history (contained Pending Budget Approval,
   Approved & Unassigned, Closed — all legacy values).
2. Normalizes existing rows to spec v1.0.0 status values.
3. Replaces NULL old_status rows with 'Draft' (initial-creation artefacts).
4. Creates a new constraint that:
   - Requires old_status IS NOT NULL
   - Validates both old_status AND new_status against RequisitionStatus enum.
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "wf_status_history_check"
down_revision = "wf_observability_indexes"
branch_labels = None
depends_on = None

# Specification v1.0.0 status values
SPEC_STATUSES = [
    "Draft",
    "Pending_Budget",
    "Pending_HR",
    "Active",
    "Fulfilled",
    "Rejected",
    "Cancelled",
]


def upgrade() -> None:
    # ------------------------------------------------------------------
    # Step 0 — Drop old constraint
    # ------------------------------------------------------------------
    op.execute(
        "ALTER TABLE requisition_status_history "
        "DROP CONSTRAINT IF EXISTS chk_requisition_status_values"
    )

    # ------------------------------------------------------------------
    # Step 1 — Normalize legacy data in old_status and new_status
    # ------------------------------------------------------------------
    mapping = {
        "Pending Budget Approval": "Pending_Budget",
        "Pending HR Approval": "Pending_HR",
        "Approved & Unassigned": "Active",
        "Closed": "Cancelled",
        "Closed (Partially Fulfilled)": "Cancelled",
    }

    for col in ("old_status", "new_status"):
        for old_val, new_val in mapping.items():
            op.execute(
                f"UPDATE requisition_status_history "
                f"SET {col} = '{new_val}' "
                f"WHERE {col} = '{old_val}'"
            )

    # ------------------------------------------------------------------
    # Step 2 — Fix NULL old_status rows (legacy creation artefacts)
    # ------------------------------------------------------------------
    op.execute(
        "UPDATE requisition_status_history "
        "SET old_status = 'Draft' "
        "WHERE old_status IS NULL"
    )

    # ------------------------------------------------------------------
    # Step 3 — Create spec-compliant CHECK constraint
    # ------------------------------------------------------------------
    status_list = ", ".join([f"'{s}'" for s in SPEC_STATUSES])

    op.execute(
        "ALTER TABLE requisition_status_history "
        "ADD CONSTRAINT chk_requisition_status_values CHECK ("
        f"  old_status IS NOT NULL"
        f"  AND old_status IN ({status_list})"
        f"  AND (new_status IS NULL OR new_status IN ({status_list}))"
        ")"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE requisition_status_history "
        "DROP CONSTRAINT IF EXISTS chk_requisition_status_values"
    )
    # Restore legacy constraint (not enforced on old_status)
    op.execute(
        "ALTER TABLE requisition_status_history "
        "ADD CONSTRAINT chk_requisition_status_values CHECK ("
        "  new_status IS NULL OR new_status IN ("
        "    'Draft',"
        "    'Pending Budget Approval',"
        "    'Approved & Unassigned',"
        "    'Active',"
        "    'Fulfilled',"
        "    'Closed',"
        "    'Rejected'"
        "  )"
        ")"
    )
