from sqlalchemy import Column, String, Text, CheckConstraint, ForeignKey
from db.base import Base


class EmployeeContact(Base):
    __tablename__ = "employee_contacts"

    emp_id = Column(
        String(20),
        ForeignKey("employees.emp_id"),
        primary_key=True
    )

    contact_type = Column(
        String(20),
        primary_key=True
    )

    email = Column(String(100), nullable=True)
    phone = Column(String(15), nullable=True)
    address = Column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint(
            "contact_type IN ('Work', 'Personal', 'Emergency')",
            name="chk_contact_type"
        ),
    )
