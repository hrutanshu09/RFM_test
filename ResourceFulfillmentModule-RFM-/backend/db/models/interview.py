from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    TIMESTAMP,
    ForeignKey,
    CheckConstraint,
)
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from db.base import Base


class Interview(Base):
    """
    Interview Model — Tracks every interview round for a candidate.

    Follows the Status History Logging pattern: one Candidate has many Interviews.
    """
    __tablename__ = "interviews"

    id = Column(Integer, primary_key=True)

    # ---- Parent candidate ----
    candidate_id = Column(
        Integer,
        ForeignKey("candidates.candidate_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # ---- Round details ----
    round_number = Column(Integer, nullable=False)
    interviewer_name = Column(String(150), nullable=False)
    scheduled_at = Column(TIMESTAMP, nullable=False)

    # ---- Outcome ----
    status = Column(
        String(20),
        nullable=False,
        default="Scheduled",
        server_default="Scheduled",
    )
    result = Column(String(20), nullable=True)   # Pass / Fail / Hold
    feedback = Column(Text, nullable=True)

    # ---- Tracking ----
    conducted_by = Column(
        Integer,
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())

    # ---- Relationships ----
    candidate = relationship("Candidate", back_populates="interviews")

    # ---- Constraints ----
    __table_args__ = (
        CheckConstraint(
            "status IN ('Scheduled','Completed','Cancelled')",
            name="chk_interview_status",
        ),
        CheckConstraint(
            "result IS NULL OR result IN ('Pass','Fail','Hold')",
            name="chk_interview_result",
        ),
    )
