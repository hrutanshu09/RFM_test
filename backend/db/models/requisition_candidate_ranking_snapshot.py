from sqlalchemy import Column, Integer, String, Text, Float, TIMESTAMP, ForeignKey
from sqlalchemy.sql import func

from db.base import Base


class RequisitionCandidateRankingSnapshot(Base):
    __tablename__ = "requisition_candidate_rankings"

    id = Column(Integer, primary_key=True)
    req_id = Column(Integer, ForeignKey("requisitions.req_id", ondelete="CASCADE"), nullable=False, index=True)
    run_id = Column(String(64), nullable=False, index=True)
    rank_position = Column(Integer, nullable=False)

    profile_id = Column(Integer, ForeignKey("candidate_profiles.profile_id", ondelete="SET NULL"), nullable=True, index=True)
    resume_id = Column(Integer, ForeignKey("candidate_resumes.resume_id", ondelete="SET NULL"), nullable=True, index=True)

    candidate_name = Column(String(255), nullable=False)
    overall_score = Column(Integer, nullable=False, server_default="0")
    skill_score = Column(Integer, nullable=False, server_default="0")
    experience_score = Column(Integer, nullable=False, server_default="0")
    jd_context_score = Column(Integer, nullable=False, server_default="0")
    experience_years_detected = Column(Float, nullable=True)
    experience_fit = Column(String(32), nullable=True)

    skills_json = Column(Text, nullable=False)
    jd_breakdown_json = Column(Text, nullable=False)
    jd_parsed_json = Column(Text, nullable=True)

    created_at = Column(TIMESTAMP, server_default=func.now(), nullable=False)
