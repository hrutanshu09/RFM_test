from sqlalchemy import Column, Integer, String, TIMESTAMP, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func

from db.base import Base


class RequisitionCandidatePool(Base):
    __tablename__ = "requisition_candidate_pool"

    id = Column(Integer, primary_key=True)
    req_id = Column(Integer, ForeignKey("requisitions.req_id", ondelete="CASCADE"), nullable=False, index=True)
    profile_id = Column(Integer, ForeignKey("candidate_profiles.profile_id", ondelete="CASCADE"), nullable=False, index=True)
    resume_id = Column(Integer, ForeignKey("candidate_resumes.resume_id", ondelete="SET NULL"), nullable=True, index=True)
    status = Column(String(20), nullable=False, server_default="added")
    pipeline_stage = Column(String(32), nullable=True)
    requisition_item_id = Column(Integer, nullable=True)
    selected_by = Column(Integer, nullable=True)
    selected_at = Column(TIMESTAMP, nullable=True)
    stage_updated_at = Column(TIMESTAMP, nullable=True)
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now(), nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("req_id", "profile_id", name="uq_req_candidate_profile"),
    )
