from sqlalchemy import (
    Column,
    Integer,
    String,
    TIMESTAMP,
    ForeignKey,
    Text
)
from sqlalchemy.sql import func
from db.base import Base


class AuditLog(Base):
    __tablename__ = "audit_log"

    audit_id = Column(Integer, primary_key=True)

    entity_name = Column(String(50), nullable=False)
    entity_id = Column(String(50), nullable=True)

    action = Column(String(20), nullable=False)

    performed_by = Column(
        Integer,
        ForeignKey("users.user_id"),
        nullable=True
    )

    target_user_id = Column(
        Integer,
        ForeignKey("users.user_id"),
        nullable=True
    )

    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)

    performed_at = Column(
        TIMESTAMP,
        server_default=func.now()
    )
