from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func

from db.base import Base


class UserEmployeeMap(Base):
    __tablename__ = "user_employee_map"

    user_id = Column(
        Integer,
        ForeignKey("users.user_id", ondelete="CASCADE"),
        primary_key=True,
        unique=True
    )

    emp_id = Column(
        String(20),
        ForeignKey("employees.emp_id", ondelete="CASCADE"),
        primary_key=True,
        unique=True
    )

    linked_at = Column(
        DateTime,
        server_default=func.now(),
        nullable=False
    )
