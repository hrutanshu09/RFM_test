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


class Candidate(Base):
    """
    Candidate Model — Tracks applicants for specific requisition items.

    One RequisitionItem can have many Candidates.
    Each Candidate progresses through stages:
        Sourced → Shortlisted → Interviewing → Offered → Hired / Rejected
    """
    __tablename__ = "candidates"

    candidate_id = Column(Integer, primary_key=True)

    # ---- Parent references ----
    requisition_item_id = Column(
        Integer,
        ForeignKey("requisition_items.item_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    requisition_id = Column(
        Integer,
        ForeignKey("requisitions.req_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # ---- Candidate profile ----
    full_name = Column(String(150), nullable=False)
    email = Column(String(255), nullable=False)
    phone = Column(String(30), nullable=True)
    resume_path = Column(Text, nullable=True)

    # ---- Pipeline stage ----
    current_stage = Column(
        String(20),
        nullable=False,
        default="Sourced",
        server_default="Sourced",
        index=True,
    )

    # ---- Tracking ----
    added_by = Column(
        Integer,
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())

    # ---- Relationships ----
    interviews = relationship(
        "Interview",
        back_populates="candidate",
        cascade="all, delete-orphan",
        order_by="Interview.round_number",
    )

    # ---- Constraints ----
    __table_args__ = (
        CheckConstraint(
            "current_stage IN ('Sourced','Shortlisted','Interviewing','Offered','Hired','Rejected')",
            name="chk_candidate_stage",
        ),
    )
