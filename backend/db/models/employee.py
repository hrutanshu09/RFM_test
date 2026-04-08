from sqlalchemy import Column, String, Date, TIMESTAMP, CheckConstraint, Integer, ForeignKey
from sqlalchemy.sql import func

from db.base import Base


class Employee(Base):
    __tablename__ = "employees"

    emp_id = Column(String(20), primary_key=True)
    full_name = Column(String(100), nullable=False)
    rbm_email = Column(String(100), nullable=False, unique=True)

    dob = Column(Date, nullable=True)
    gender = Column(String(10), nullable=True)
    doj = Column(Date, nullable=True)

    emp_status = Column(
        String(20),
        nullable=False,
        server_default="Onboarding"
    )

    company_role_id = Column(
        Integer,
        ForeignKey("company_roles.role_id"),
        nullable=True,
    )

    created_at = Column(
        TIMESTAMP,
        server_default=func.now(),
        nullable=False
    )

    __table_args__ = (
        CheckConstraint(
            "emp_status IN ('Onboarding', 'Active', 'On Leave', 'Exited')",
            name="chk_emp_status"
        ),
    )

