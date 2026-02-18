from sqlalchemy import Column, Integer, String, Date, ForeignKey
from db.base import Base


class EmployeeAssignment(Base):
    __tablename__ = "employee_assignments"

    assignment_id = Column(Integer, primary_key=True)

    emp_id = Column(
        String(20),
        ForeignKey("employees.emp_id"),
        nullable=False
    )

    department_id = Column(
        Integer,
        ForeignKey("departments.department_id"),
        nullable=False
    )

    manager_id = Column(
        String(20),
        ForeignKey("employees.emp_id"),
        nullable=True
    )

    location_id = Column(
        Integer,
        ForeignKey("locations.location_id"),
        nullable=True
    )

    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=True)
