from sqlalchemy import Column, String, Integer, Date, CheckConstraint, ForeignKey
from db.base import Base


class EmployeeAvailability(Base):
    __tablename__ = "employee_availability"

    emp_id = Column(
        String(20),
        ForeignKey("employees.emp_id"),
        primary_key=True
    )

    effective_from = Column(
        Date,
        primary_key=True
    )

    availability_pct = Column(
        Integer,
        nullable=False
    )

    __table_args__ = (
        CheckConstraint(
            "availability_pct BETWEEN 0 AND 100",
            name="chk_availability_pct"
        ),
    )


