"""
Alembic migration: Add candidates and interviews tables.

Revision ID: add_candidates_interviews
Revises: budget_item_level_refactor
"""
from alembic import op
import sqlalchemy as sa

revision = 'add_candidates_interviews'
down_revision = 'budget_item_level_refactor'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---- Candidates table ----
    op.create_table(
        'candidates',
        sa.Column('candidate_id', sa.Integer(), primary_key=True),
        sa.Column('requisition_item_id', sa.Integer(),
                  sa.ForeignKey('requisition_items.item_id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('requisition_id', sa.Integer(),
                  sa.ForeignKey('requisitions.req_id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('full_name', sa.String(150), nullable=False),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('phone', sa.String(30), nullable=True),
        sa.Column('resume_path', sa.Text(), nullable=True),
        sa.Column('current_stage', sa.String(20), nullable=False,
                  server_default='Sourced'),
        sa.Column('added_by', sa.Integer(),
                  sa.ForeignKey('users.user_id', ondelete='SET NULL'),
                  nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        sa.CheckConstraint(
            "current_stage IN ('Sourced','Shortlisted','Interviewing','Offered','Hired','Rejected')",
            name='chk_candidate_stage',
        ),
    )
    op.create_index('ix_candidates_req_item', 'candidates', ['requisition_item_id'])
    op.create_index('ix_candidates_req_id', 'candidates', ['requisition_id'])
    op.create_index('ix_candidates_stage', 'candidates', ['current_stage'])

    # ---- Interviews table ----
    op.create_table(
        'interviews',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('candidate_id', sa.Integer(),
                  sa.ForeignKey('candidates.candidate_id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('round_number', sa.Integer(), nullable=False),
        sa.Column('interviewer_name', sa.String(150), nullable=False),
        sa.Column('scheduled_at', sa.TIMESTAMP(), nullable=False),
        sa.Column('status', sa.String(20), nullable=False,
                  server_default='Scheduled'),
        sa.Column('result', sa.String(20), nullable=True),
        sa.Column('feedback', sa.Text(), nullable=True),
        sa.Column('conducted_by', sa.Integer(),
                  sa.ForeignKey('users.user_id', ondelete='SET NULL'),
                  nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        sa.CheckConstraint(
            "status IN ('Scheduled','Completed','Cancelled')",
            name='chk_interview_status',
        ),
        sa.CheckConstraint(
            "result IS NULL OR result IN ('Pass','Fail','Hold')",
            name='chk_interview_result',
        ),
    )
    op.create_index('ix_interviews_candidate', 'interviews', ['candidate_id'])


def downgrade() -> None:
    op.drop_index('ix_interviews_candidate', table_name='interviews')
    op.drop_table('interviews')
    op.drop_index('ix_candidates_stage', table_name='candidates')
    op.drop_index('ix_candidates_req_id', table_name='candidates')
    op.drop_index('ix_candidates_req_item', table_name='candidates')
    op.drop_table('candidates')
