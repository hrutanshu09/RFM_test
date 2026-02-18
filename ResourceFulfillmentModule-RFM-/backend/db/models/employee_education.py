from sqlalchemy import Column, Integer, String, ForeignKey
from db.base import Base


class EmployeeEducation(Base):
    __tablename__ = "employee_education"

    edu_id = Column(Integer, primary_key=True)

    emp_id = Column(
        String(20),
        ForeignKey("employees.emp_id"),
        nullable=False
    )

    qualification = Column(String(100), nullable=True)
    specialization = Column(String(100), nullable=True)
    institution = Column(String(100), nullable=True)
    year_completed = Column(Integer, nullable=True)
