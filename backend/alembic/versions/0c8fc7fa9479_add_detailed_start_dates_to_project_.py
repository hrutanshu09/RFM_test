"""add detailed start dates to project timelines

Revision ID: 0c8fc7fa9479
Revises: c902b3e54d54
Create Date: 2026-02-25 11:11:18.095195

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0c8fc7fa9479'
down_revision: Union[str, Sequence[str], None] = 'c902b3e54d54'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


from alembic import op
import sqlalchemy as sa

def upgrade():
    # Adding the new start date fields
    op.add_column('project_timelines', sa.Column('planned_start_date', sa.Date(), nullable=True))
    op.add_column('project_timelines', sa.Column('actual_start_date', sa.Date(), nullable=True))
    
    # Optional: If you want to migrate existing 'start_date' data to 'planned_start_date'
    # op.execute("UPDATE project_timelines SET planned_start_date = start_date")

def downgrade():
    op.drop_column('project_timelines', 'actual_start_date')
    op.drop_column('project_timelines', 'planned_start_date')
