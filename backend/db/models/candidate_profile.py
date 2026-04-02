from sqlalchemy import Column, Integer, String, TIMESTAMP
from sqlalchemy.sql import func

from db.base import Base


class CandidateProfile(Base):
    __tablename__ = "candidate_profiles"

    profile_id = Column(Integer, primary_key=True)
    full_name = Column(String(150), nullable=False)
    email = Column(String(255), nullable=False, unique=True, index=True)
    phone = Column(String(30), nullable=True)

    created_at = Column(TIMESTAMP, server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now(), nullable=False)
