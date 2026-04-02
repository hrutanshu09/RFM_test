from sqlalchemy import Column, Integer, String, Text, TIMESTAMP, ForeignKey
from sqlalchemy.sql import func

from db.base import Base


class CandidateIntakeSubmission(Base):
    __tablename__ = "candidate_intake_submissions"

    submission_id = Column(Integer, primary_key=True)
    full_name = Column(String(150), nullable=False)
    email = Column(String(255), nullable=False, index=True)
    phone = Column(String(30), nullable=True)

    profile_id = Column(Integer, ForeignKey("candidate_profiles.profile_id", ondelete="SET NULL"), nullable=True, index=True)
    resume_id = Column(Integer, ForeignKey("candidate_resumes.resume_id", ondelete="SET NULL"), nullable=True, index=True)

    resume_file_key = Column(Text, nullable=False)
    resume_original_filename = Column(String(255), nullable=False)
    resume_content_type = Column(String(120), nullable=False)

    parser_status = Column(String(20), nullable=False, server_default="parsed")
    submission_status = Column(String(20), nullable=False, server_default="submitted")
    parsed_payload = Column(Text, nullable=True)
    confirmed_payload = Column(Text, nullable=True)
    parser_error = Column(Text, nullable=True)

    created_at = Column(TIMESTAMP, server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now(), nullable=False)
