from sqlalchemy import Column, Integer, String, Text, Boolean, TIMESTAMP, UniqueConstraint
from sqlalchemy.sql import func

from db.base import Base


class CompanyRole(Base):
    __tablename__ = "company_roles"

    role_id = Column(Integer, primary_key=True, index=True)
    role_name = Column(String(100), nullable=False, unique=True)
    role_description = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, server_default="true")
    created_at = Column(TIMESTAMP, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("role_name", name="uq_company_roles_role_name"),
    )
