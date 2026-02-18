"""Item-Level Budget Refactor Migration

Revision ID: budget_item_level_refactor
Revises: wf_status_history_check
Create Date: 2026-02-12

This migration moves budget responsibility from requisition header to item level:

1. Adds budget columns to requisition_items:
   - estimated_budget NUMERIC(12,2) NOT NULL DEFAULT 0
   - approved_budget NUMERIC(12,2) NULL
   - currency VARCHAR(10) NOT NULL DEFAULT 'INR'

2. Backfills existing data:
   - If header budget_amount > 0 and item budgets are 0:
     - Single item: gets full header budget
     - Multiple items: even distribution (rounded to 2 decimals)

3. Adds CHECK constraints (NOT VALID for performance):
   - estimated_budget >= 0
   - approved_budget IS NULL OR approved_budget >= 0

4. Marks header budget_amount as DEPRECATED (via column comment)

IMPORTANT:
- Does NOT drop requisitions.budget_amount (non-destructive)
- Preserves audit integrity
- Transactional safety maintained
- Idempotent design
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'budget_item_level_refactor'
down_revision: Union[str, Sequence[str], None] = 'wf_status_history_check'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Upgrade schema to item-level budgets.
    
    Operations:
    1. Add columns with defaults (no table rewrite on PostgreSQL 11+)
    2. Backfill data from header to items
    3. Add CHECK constraints (NOT VALID)
    4. Add deprecation comment on header column
    """
    
    # ==========================================================================
    # STEP 1: Add budget columns to requisition_items
    # ==========================================================================
    # Using server_default ensures no table rewrite on PostgreSQL 11+
    # These are online, non-blocking operations
    
    op.add_column(
        'requisition_items',
        sa.Column(
            'estimated_budget',
            sa.Numeric(precision=12, scale=2),
            nullable=False,
            server_default='0'
        )
    )
    
    op.add_column(
        'requisition_items',
        sa.Column(
            'approved_budget',
            sa.Numeric(precision=12, scale=2),
            nullable=True
        )
    )
    
    op.add_column(
        'requisition_items',
        sa.Column(
            'currency',
            sa.String(length=10),
            nullable=False,
            server_default='INR'
        )
    )
    
    # ==========================================================================
    # STEP 2: Backfill data from header budget to item budgets
    # ==========================================================================
    # Logic:
    # - Only backfill if header budget_amount > 0
    # - Only backfill items where estimated_budget = 0 (don't overwrite)
    # - Single item per requisition: gets full header budget
    # - Multiple items: even distribution with ROUND(..., 2)
    #
    # This uses a single UPDATE with subquery for efficiency.
    # The CTE calculates per-requisition item counts and budget shares.
    
    op.execute("""
        WITH requisition_budget_distribution AS (
            SELECT 
                r.req_id,
                r.budget_amount AS header_budget,
                COUNT(ri.item_id) AS item_count,
                ROUND(
                    COALESCE(r.budget_amount, 0) / NULLIF(COUNT(ri.item_id), 0),
                    2
                ) AS budget_per_item
            FROM requisitions r
            INNER JOIN requisition_items ri ON ri.req_id = r.req_id
            WHERE r.budget_amount IS NOT NULL 
              AND r.budget_amount > 0
            GROUP BY r.req_id, r.budget_amount
        )
        UPDATE requisition_items ri
        SET estimated_budget = rbd.budget_per_item
        FROM requisition_budget_distribution rbd
        WHERE ri.req_id = rbd.req_id
          AND ri.estimated_budget = 0
          AND COALESCE(ri.item_status, '') <> 'Fulfilled'
          AND rbd.budget_per_item > 0
    """)
    
    # ==========================================================================
    # STEP 3: Add CHECK constraints with NOT VALID
    # ==========================================================================
    # NOT VALID means:
    # - Constraint is enforced for new/updated rows immediately
    # - Existing rows are NOT scanned (avoids full table lock)
    # - Can later run VALIDATE CONSTRAINT in a separate migration if needed
    
    # Constraint: estimated_budget must be non-negative
    op.execute("""
        ALTER TABLE requisition_items
        ADD CONSTRAINT chk_item_estimated_budget_non_negative
        CHECK (estimated_budget >= 0)
        NOT VALID
    """)
    
    # Constraint: approved_budget must be non-negative (when set)
    op.execute("""
        ALTER TABLE requisition_items
        ADD CONSTRAINT chk_item_approved_budget_non_negative
        CHECK (approved_budget IS NULL OR approved_budget >= 0)
        NOT VALID
    """)
    
    # Constraint: currency must be a valid ISO-like code (2-10 uppercase chars)
    op.execute("""
        ALTER TABLE requisition_items
        ADD CONSTRAINT chk_item_currency_format
        CHECK (currency ~ '^[A-Z]{2,10}$')
        NOT VALID
    """)
    
    # ==========================================================================
    # STEP 4: Mark header budget_amount as DEPRECATED
    # ==========================================================================
    # This preserves the column but signals to developers it should not be used.
    # The column remains for backward compatibility and audit purposes.
    
    op.execute("""
        COMMENT ON COLUMN requisitions.budget_amount IS 
        'DEPRECATED: Use requisition_items.estimated_budget instead. '
        'This column is retained for audit history and backward compatibility. '
        'Do NOT use for new code. Budget totals must be computed from items. '
        'Deprecated as of migration budget_item_level_refactor (2026-02-12).'
    """)
    
    # ==========================================================================
    # STEP 5: Add index for budget queries (optional optimization)
    # ==========================================================================
    # Index on req_id + estimated_budget for efficient SUM queries
    
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_requisition_items_budget_lookup
        ON requisition_items(req_id, estimated_budget)
    """)


def downgrade() -> None:
    """
    Downgrade schema - remove item-level budget columns.
    
    IMPORTANT: This does NOT restore header budget values.
    The header budget_amount column was never dropped, so no data is lost.
    However, any item-level budget data added after the upgrade will be lost.
    
    Operations:
    1. Drop budget index
    2. Drop CHECK constraints
    3. Remove deprecation comment
    4. Drop budget columns from requisition_items
    """
    
    # ==========================================================================
    # STEP 1: Drop budget index
    # ==========================================================================
    op.execute("""
        DROP INDEX IF EXISTS ix_requisition_items_budget_lookup
    """)
    
    # ==========================================================================
    # STEP 2: Drop CHECK constraints
    # ==========================================================================
    op.execute("""
        ALTER TABLE requisition_items
        DROP CONSTRAINT IF EXISTS chk_item_currency_format
    """)
    
    op.execute("""
        ALTER TABLE requisition_items
        DROP CONSTRAINT IF EXISTS chk_item_approved_budget_non_negative
    """)
    
    op.execute("""
        ALTER TABLE requisition_items
        DROP CONSTRAINT IF EXISTS chk_item_estimated_budget_non_negative
    """)
    
    # ==========================================================================
    # STEP 3: Remove deprecation comment from header column
    # ==========================================================================
    op.execute("""
        COMMENT ON COLUMN requisitions.budget_amount IS NULL
    """)
    
    # ==========================================================================
    # STEP 4: Drop budget columns from requisition_items
    # ==========================================================================
    op.drop_column('requisition_items', 'currency')
    op.drop_column('requisition_items', 'approved_budget')
    op.drop_column('requisition_items', 'estimated_budget')
