from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    TIMESTAMP,
    ForeignKey
)
from sqlalchemy.sql import func
from db.base import Base


class RequisitionStatusHistory(Base):
    __tablename__ = "requisition_status_history"

    history_id = Column(Integer, primary_key=True)

    req_id = Column(
        Integer,
        ForeignKey("requisitions.req_id"),
        nullable=False
    )

    old_status = Column(String(50), nullable=False)
    new_status = Column(String(50), nullable=False)
    justification = Column(Text, nullable=True)

    changed_by = Column(
        Integer,
        ForeignKey("users.user_id"),
        nullable=True
    )

    changed_at = Column(
        TIMESTAMP,
        server_default=func.now()
    )
