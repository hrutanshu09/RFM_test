from sqlalchemy import Boolean, Column, ForeignKey, Integer, String
from db.base import Base


class Skill(Base):
    __tablename__ = "skills"

    skill_id = Column(Integer, primary_key=True, index=True)
    skill_name = Column(String(50), unique=True, nullable=False)
    normalized_name = Column(String(50), unique=True, nullable=False)
    is_verified = Column(Boolean, nullable=False, default=False)
    created_by = Column(
        Integer,
        ForeignKey("users.user_id", ondelete="RESTRICT"),
        nullable=True
    )
