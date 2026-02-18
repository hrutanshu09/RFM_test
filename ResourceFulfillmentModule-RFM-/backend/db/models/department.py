from sqlalchemy import Column, Integer, String
from db.base import Base


class Department(Base):
    __tablename__ = "departments"

    department_id = Column(Integer, primary_key=True)
    department_name = Column(String(50), nullable=False, unique=True)
